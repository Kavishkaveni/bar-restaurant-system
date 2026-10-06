"""Room types, rooms, housekeeping and the room board."""

from datetime import datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import DB, require, require_any
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import Booking, Room, RoomType, User
from app.schemas.rooms import (
    BoardOut,
    BoardRoom,
    BookingBrief,
    HousekeepingIn,
    RoomIn,
    RoomOut,
    RoomTypeIn,
    RoomTypeOut,
)
from app.services import audit
from app.services import rooms as folio_math

router = APIRouter(tags=["rooms"])

RoomsManager = Annotated[User, Depends(require("rooms.manage"))]
RoomViewer = Annotated[User, Depends(require_any("rooms.manage", "pos.room_service"))]
LIVE = ("booked", "checked_in")


def brief(b: Booking, tz_name: str) -> BookingBrief:
    f = folio_math.folio(b, tz_name)
    return BookingBrief(
        id=b.id, room=b.room, status=b.status, stay_type=b.stay_type, guest_name=b.guest_name, phone=b.phone,
        arrival=b.arrival, departure=b.departure, checked_in_at=b.checked_in_at, checked_out_at=b.checked_out_at,
        total=f.total, balance=f.balance,
    )


# ---- Room types ------------------------------------------------------------------------

@router.get("/room-types", response_model=list[RoomTypeOut])
async def list_room_types(_: RoomViewer, db: DB):
    types = list(
        await db.scalars(select(RoomType).where(RoomType.is_active.is_(True)).order_by(RoomType.sort_order, RoomType.name))
    )
    counts = dict(
        (
            await db.execute(
                select(Room.room_type_id, func.count()).where(Room.is_active.is_(True)).group_by(Room.room_type_id)
            )
        ).all()
    )
    return [RoomTypeOut.model_validate(t).model_copy(update={"room_count": counts.get(t.id, 0)}) for t in types]


async def _type_name_taken(db: DB, name: str, exclude: int | None = None) -> bool:
    stmt = select(RoomType.id).where(func.lower(RoomType.name) == name.lower(), RoomType.is_active.is_(True))
    if exclude:
        stmt = stmt.where(RoomType.id != exclude)
    return bool(await db.scalar(stmt))


def _type_dump(body: RoomTypeIn) -> dict:
    d = body.model_dump()
    return {k: (float(v) if hasattr(v, "as_tuple") else v) for k, v in d.items()}


@router.post("/room-types", response_model=RoomTypeOut, status_code=status.HTTP_201_CREATED)
async def create_room_type(body: RoomTypeIn, actor: RoomsManager, db: DB, request: Request):
    if await _type_name_taken(db, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a room type called "{body.name}"')
    rt = RoomType(**body.model_dump())
    db.add(rt)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="room_type", entity_id=rt.id, after=_type_dump(body),
                 request=request)
    await db.commit()
    return rt


@router.put("/room-types/{type_id}", response_model=RoomTypeOut)
async def update_room_type(type_id: int, body: RoomTypeIn, actor: RoomsManager, db: DB, request: Request):
    rt = await db.get(RoomType, type_id)
    if not rt or not rt.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room type not found")
    if await _type_name_taken(db, body.name, rt.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a room type called "{body.name}"')
    before = {k: (float(v) if hasattr(v, "as_tuple") else v) for k, v in
              ((k, getattr(rt, k)) for k in body.model_dump())}
    for k, v in body.model_dump().items():
        setattr(rt, k, v)
    audit.record(db, user=actor, action="update", entity="room_type", entity_id=rt.id, before=before,
                 after=_type_dump(body), request=request)
    await db.commit()
    return rt


@router.delete("/room-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room_type(type_id: int, actor: RoomsManager, db: DB, request: Request):
    rt = await db.get(RoomType, type_id)
    if not rt or not rt.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room type not found")
    if await db.scalar(select(Room.id).where(Room.room_type_id == rt.id, Room.is_active.is_(True)).limit(1)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Rooms still use this type. Change or delete those rooms first.")
    rt.is_active = False
    audit.record(db, user=actor, action="delete", entity="room_type", entity_id=rt.id, before={"name": rt.name},
                 request=request)
    await db.commit()


# ---- Rooms --------------------------------------------------------------------------------

@router.get("/rooms", response_model=list[RoomOut])
async def list_rooms(_: RoomViewer, db: DB):
    return list(await db.scalars(select(Room).where(Room.is_active.is_(True)).order_by(Room.sort_order, Room.number)))


async def _room_number_taken(db: DB, number: str, exclude: int | None = None) -> bool:
    stmt = select(Room.id).where(func.lower(Room.number) == number.lower(), Room.is_active.is_(True))
    if exclude:
        stmt = stmt.where(Room.id != exclude)
    return bool(await db.scalar(stmt))


async def _active_type(db: DB, type_id: int) -> RoomType:
    rt = await db.get(RoomType, type_id)
    if not rt or not rt.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a room type")
    return rt


async def active_room(db: DB, room_id: int) -> Room:
    room = await db.get(Room, room_id)
    if not room or not room.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room


@router.post("/rooms", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
async def create_room(body: RoomIn, actor: RoomsManager, db: DB, request: Request):
    await _active_type(db, body.room_type_id)
    if await _room_number_taken(db, body.number):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Room {body.number} already exists")
    room = Room(**body.model_dump())
    db.add(room)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="room", entity_id=room.id,
                 after={"name": f"Room {room.number}", **body.model_dump()}, request=request)
    await db.commit()
    await db.refresh(room, ["room_type"])
    return room


@router.put("/rooms/{room_id}", response_model=RoomOut)
async def update_room(room_id: int, body: RoomIn, actor: RoomsManager, db: DB, request: Request):
    room = await active_room(db, room_id)
    await _active_type(db, body.room_type_id)
    if await _room_number_taken(db, body.number, room.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Room {body.number} already exists")
    before = {k: getattr(room, k) for k in body.model_dump()}
    for k, v in body.model_dump().items():
        setattr(room, k, v)
    audit.record(db, user=actor, action="update", entity="room", entity_id=room.id, before=before,
                 after={"name": f"Room {room.number}", **body.model_dump()}, request=request)
    await db.commit()
    await db.refresh(room, ["room_type"])
    return room


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: int, actor: RoomsManager, db: DB, request: Request):
    room = await active_room(db, room_id)
    if await db.scalar(select(Booking.id).where(Booking.room_id == room.id, Booking.status.in_(LIVE)).limit(1)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This room has a guest or an upcoming booking. Move or cancel it first.")
    room.is_active = False
    audit.record(db, user=actor, action="delete", entity="room", entity_id=room.id,
                 before={"name": f"Room {room.number}"}, request=request)
    await db.commit()


@router.post("/rooms/{room_id}/housekeeping", response_model=RoomOut)
async def set_housekeeping(room_id: int, body: HousekeepingIn, actor: RoomsManager, db: DB, request: Request):
    room = await active_room(db, room_id)
    before = room.housekeeping
    room.housekeeping = body.housekeeping
    if body.note is not None:
        room.note = body.note.strip()
    if before != body.housekeeping:
        audit.record(db, user=actor, action="housekeeping", entity="room", entity_id=room.id,
                     before={"name": f"Room {room.number}", "status": before},
                     after={"name": f"Room {room.number}", "status": body.housekeeping}, request=request)
    await db.commit()
    return room


# ---- Board and availability ----------------------------------------------------------------

@router.get("/rooms/board", response_model=BoardOut)
async def board(_: RoomViewer, db: DB):
    """Every room right now: who is in it, who is arriving, and whether it's clean."""
    tz_name = (await load_settings(db))["timezone"]
    tz = business_tz(tz_name)
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date()
    day_end = datetime.combine(today + timedelta(days=1), time.min, tz)

    rooms = list(await db.scalars(select(Room).where(Room.is_active.is_(True)).order_by(Room.sort_order, Room.number)))
    live = list(await db.scalars(select(Booking).where(Booking.status.in_(LIVE)).order_by(Booking.arrival)))
    out: list[BoardRoom] = []
    for room in rooms:
        mine = [b for b in live if b.room_id == room.id]
        stay = next((b for b in mine if b.status == "checked_in"), None)
        upcoming = next((b for b in mine if b.status == "booked"), None)
        if stay:
            state = "overdue" if stay.departure < now else "occupied"
        elif upcoming and upcoming.arrival < day_end:
            state = "arriving"
        else:
            state = "free"
        out.append(BoardRoom(
            id=room.id, number=room.number, floor=room.floor, room_type=room.room_type,
            housekeeping=room.housekeeping, note=room.note, state=state,
            stay=brief(stay, tz_name) if stay else None,
            next=brief(upcoming, tz_name) if upcoming else None,
        ))
    return BoardOut(
        rooms=out,
        arrivals_today=sum(1 for b in live if b.status == "booked" and b.arrival < day_end),
        departures_today=sum(1 for b in live if b.status == "checked_in" and b.departure < day_end),
        in_house=sum(1 for b in live if b.status == "checked_in"),
    )


async def clashes(
    db: DB, room_id: int, arrival: datetime, departure: datetime, exclude: int | None = None
) -> Booking | None:
    """Another live booking for this room overlapping [arrival, departure)."""
    now = datetime.now(timezone.utc)
    stmt = select(Booking).where(Booking.room_id == room_id, Booking.status.in_(LIVE), Booking.arrival < departure)
    if exclude:
        stmt = stmt.where(Booking.id != exclude)
    for b in await db.scalars(stmt):
        end = max(b.departure, now) if b.status == "checked_in" else b.departure
        if arrival < end:
            return b
    return None


@router.get("/rooms/available", response_model=list[RoomOut])
async def available(_: RoomsManager, db: DB, arrival: datetime, departure: datetime, exclude_booking: int | None = None):
    if departure <= arrival:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Departure must be after arrival")
    rooms = list(await db.scalars(select(Room).where(Room.is_active.is_(True)).order_by(Room.sort_order, Room.number)))
    return [r for r in rooms if not await clashes(db, r.id, arrival, departure, exclude_booking)]
