"""Bookings: reserve, check in, add to the room bill, take payments, check out."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, select

from app.api.deps import DB, require, require_any
from app.api.rooms import active_room, brief, clashes
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import Booking, BookingCharge, BookingPayment, Order, User
from app.schemas.rooms import (
    AdvanceIn,
    BookingBrief,
    BookingCreate,
    BookingOut,
    BookingUpdate,
    CancelIn,
    ChargeIn,
    CheckInIn,
    CheckOutIn,
    FolioOut,
    GuestFields,
    OpenBillBrief,
    RemoveChargeIn,
)
from app.services import audit, billing
from app.services import rooms as folio_math
from app.services.pins import authorize

router = APIRouter(prefix="/bookings", tags=["bookings"])

RoomsManager = Annotated[User, Depends(require("rooms.manage"))]
APPROVE = "pos.discount_void"
ZERO = Decimal(0)
ID_WORDS = {"nic": "NIC", "passport": "Passport", "driving_licence": "Driving licence", "other": "ID"}


# ---- Helpers --------------------------------------------------------------------------

async def tz_name(db: DB) -> str:
    return (await load_settings(db))["timezone"]


def name_of(b: Booking) -> str:
    return f"Room {b.room.number} · {b.guest_name}"


async def load(db: DB, booking_id: int, lock: bool = False) -> Booking:
    stmt = select(Booking).where(Booking.id == booking_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update(of=Booking)
    b = await db.scalar(stmt)
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return b


async def open_bills(db: DB, booking_id: int) -> list[Order]:
    return list(await db.scalars(select(Order).where(Order.booking_id == booking_id, Order.status == "open")))


async def to_out(db: DB, b: Booking) -> BookingOut:
    f = folio_math.folio(b, await tz_name(db))
    bills = await open_bills(db, b.id)
    return BookingOut(
        id=b.id, room=b.room, status=b.status, stay_type=b.stay_type, guest_name=b.guest_name, phone=b.phone,
        id_type=b.id_type, id_number=b.id_number, address=b.address, adults=b.adults, children=b.children,
        vehicle_no=b.vehicle_no, note=b.note, arrival=b.arrival, departure=b.departure, rate=b.rate,
        extra_hour_rate=b.extra_hour_rate, block_hours=b.block_hours, checked_in_at=b.checked_in_at,
        checked_out_at=b.checked_out_at, cancel_reason=b.cancel_reason, creator=b.creator, created_at=b.created_at,
        folio=FolioOut(**f.__dict__), charges=b.charges, payments=b.payments,
        open_bills=[OpenBillBrief(id=o.id, total=billing.totals(o).total) for o in bills],
    )


async def respond(db: DB, booking_id: int) -> BookingOut:
    return await to_out(db, await load(db, booking_id))


def ensure_status(b: Booking, *allowed: str) -> None:
    if b.status not in allowed:
        words = {"booked": "not checked in yet", "checked_in": "checked in", "checked_out": "already checked out",
                 "cancelled": "cancelled", "no_show": "marked as a no-show"}
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This booking is {words[b.status]}")


async def ensure_free(db: DB, room_id: int, arrival: datetime, departure: datetime, exclude: int | None = None):
    other = await clashes(db, room_id, arrival, departure, exclude)
    if other:
        z = business_tz(await tz_name(db))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Room is taken by {other.guest_name} from {other.arrival.astimezone(z):%d %b %H:%M} "
            f"to {other.departure.astimezone(z):%d %b %H:%M}",
        )


def ensure_guest_details(b: Booking) -> None:
    missing = [label for label, v in (("guest name", b.guest_name), ("phone", b.phone), (ID_WORDS[b.id_type] + " number", b.id_number)) if not v]
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Enter the {', '.join(missing)} to check in")


def add_payment(b: Booking, p: AdvanceIn, actor: User, kind: str = "payment") -> None:
    b.payments.append(BookingPayment(kind=kind, method=p.method, amount=p.amount, reference=p.reference.strip(),
                                     created_by=actor.id))


# ---- Lists ------------------------------------------------------------------------------------

@router.get("", response_model=list[BookingBrief])
async def list_bookings(
    _: RoomsManager,
    db: DB,
    view: Annotated[Literal["upcoming", "in_house", "past", "all"], Query()] = "upcoming",
    q: str = "",
    limit: int = Query(default=100, ge=1, le=300),
):
    stmt = select(Booking)
    if view == "upcoming":
        stmt = stmt.where(Booking.status == "booked").order_by(Booking.arrival)
    elif view == "in_house":
        stmt = stmt.where(Booking.status == "checked_in").order_by(Booking.departure)
    elif view == "past":
        stmt = stmt.where(Booking.status.in_(["checked_out", "cancelled", "no_show"])).order_by(Booking.updated_at.desc())
    else:
        stmt = stmt.order_by(Booking.arrival.desc())
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Booking.guest_name.ilike(like), Booking.phone.ilike(like), Booking.id_number.ilike(like)))
    tz = await tz_name(db)
    return [brief(b, tz) for b in await db.scalars(stmt.limit(limit))]


@router.get("/in-house", response_model=list[BookingBrief])
async def in_house(_: Annotated[User, Depends(require_any("rooms.manage", "pos.room_service", "pos.payment"))], db: DB):
    """Guests staying now, for room service and "charge to room" on the POS."""
    tz = await tz_name(db)
    rows = await db.scalars(select(Booking).where(Booking.status == "checked_in"))
    return sorted((brief(b, tz) for b in rows), key=lambda x: x.room.number)


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(booking_id: int, _: RoomsManager, db: DB):
    return await respond(db, booking_id)


# ---- Create and edit ---------------------------------------------------------------------------

@router.post("", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
async def create_booking(body: BookingCreate, actor: RoomsManager, db: DB, request: Request):
    room = await active_room(db, body.room_id)
    rt = room.room_type
    now = datetime.now(timezone.utc)
    arrival = now if body.check_in_now else body.arrival
    departure = body.departure
    if departure <= arrival:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Departure must be after arrival")

    if body.stay_type == "short":
        if body.rate is None and rt.short_stay_rate is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"{rt.name} has no short-stay price. Set one in room types or enter a rate.")
        rate = body.rate if body.rate is not None else rt.short_stay_rate
    else:
        rate = body.rate if body.rate is not None else rt.nightly_rate

    await ensure_free(db, room.id, arrival, departure)
    settings = await load_settings(db)
    guest = body.model_dump(include=set(GuestFields.model_fields))
    b = Booking(
        room_id=room.id, stay_type=body.stay_type, arrival=arrival, departure=departure, rate=rate,
        extra_hour_rate=rt.extra_hour_rate or ZERO, block_hours=rt.short_stay_hours,
        room_tax_percent=Decimal(str(settings["room_tax_percent"])), created_by=actor.id,
        charges=[], payments=[], **guest,
    )
    b.room = room
    if body.check_in_now:
        if room.housekeeping == "maintenance":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Room {room.number} is under maintenance")
        ensure_guest_details(b)
        b.status, b.checked_in_at, b.checked_in_by = "checked_in", now, actor.id
    if body.advance:
        add_payment(b, body.advance, actor)
    db.add(b)
    await db.flush()
    audit.record(db, user=actor, action="check_in" if body.check_in_now else "create", entity="booking",
                 entity_id=b.id, after={"name": name_of(b), "arrival": arrival.isoformat(),
                                        "departure": departure.isoformat(), "rate": float(rate),
                                        "advance": float(body.advance.amount) if body.advance else 0},
                 request=request)
    await db.commit()
    return await respond(db, b.id)


@router.patch("/{booking_id}", response_model=BookingOut)
async def update_booking(booking_id: int, body: BookingUpdate, actor: RoomsManager, db: DB, request: Request):
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked", "checked_in")
    changes = body.model_dump(exclude_unset=True)
    for k in ("guest_name", "phone", "id_number", "address", "vehicle_no", "note"):
        if k in changes and changes[k] is not None:
            changes[k] = changes[k].strip()
    if changes.get("guest_name") == "":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter the guest's name")

    room_id = changes.get("room_id") or b.room_id
    arrival = changes.get("arrival") or b.arrival
    departure = changes.get("departure") or b.departure
    if b.status == "checked_in" and "arrival" in changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The guest is already checked in")
    if departure <= arrival:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Departure must be after arrival")
    if b.status == "checked_in" and departure <= datetime.now(timezone.utc) and "departure" in changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new departure is already in the past")
    if {"room_id", "arrival", "departure"} & changes.keys():
        new_room = await active_room(db, room_id)
        if new_room.housekeeping == "maintenance" and room_id != b.room_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Room {new_room.number} is under maintenance")
        await ensure_free(db, room_id, max(arrival, datetime.now(timezone.utc)) if b.status == "checked_in" else arrival,
                          departure, exclude=b.id)

    before = {k: getattr(b, k) for k in changes}
    old_room = b.room
    for k, v in changes.items():
        if v is not None:
            setattr(b, k, v)
    if "room_id" in changes and room_id != old_room.id:
        b.room = await active_room(db, room_id)
        if b.status == "checked_in":
            old_room.housekeeping = "dirty"  # guest moved out of it

    def fmt(v):
        return v.isoformat() if isinstance(v, datetime) else float(v) if isinstance(v, Decimal) else v

    audit.record(db, user=actor, action="update", entity="booking", entity_id=b.id,
                 before={"name": name_of(b), **{k: fmt(v) for k, v in before.items()}},
                 after={"name": name_of(b), **{k: fmt(v) for k, v in changes.items()}}, request=request)
    await db.commit()
    return await respond(db, b.id)


# ---- Check in -------------------------------------------------------------------------------------

@router.post("/{booking_id}/check-in", response_model=BookingOut)
async def check_in(booking_id: int, body: CheckInIn, actor: RoomsManager, db: DB, request: Request):
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(b, k, v.strip() if isinstance(v, str) else v)
    ensure_guest_details(b)
    if b.room.housekeeping == "maintenance":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Room {b.room.number} is under maintenance. Move the booking to another room.")
    now = datetime.now(timezone.utc)
    other = await db.scalar(
        select(Booking).where(Booking.room_id == b.room_id, Booking.status == "checked_in", Booking.id != b.id)
    )
    if other:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"{other.guest_name} is still in Room {b.room.number}. Check them out first.")
    if b.departure <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The departure time has passed. Change the dates first.")
    b.status, b.checked_in_at, b.checked_in_by = "checked_in", now, actor.id
    audit.record(db, user=actor, action="check_in", entity="booking", entity_id=b.id,
                 after={"name": name_of(b)}, request=request)
    await db.commit()
    return await respond(db, b.id)


# ---- Charges and payments ---------------------------------------------------------------------------

@router.post("/{booking_id}/charges", response_model=BookingOut)
async def add_charge(booking_id: int, body: ChargeIn, actor: RoomsManager, db: DB, request: Request):
    """Extras (laundry, extra bed, late check-out) or a discount, which needs a manager."""
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked", "checked_in")
    approver = actor
    amount = body.amount
    if body.kind == "discount":
        approver = await authorize(db, actor, APPROVE, body.approval, request)
        f = folio_math.folio(b, await tz_name(db))
        room_part = f.room_charge + f.extras + f.discounts
        if amount > room_part:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"The discount can't be more than the room and extras ({room_part:,.2f})")
        amount = -amount
    b.charges.append(BookingCharge(kind=body.kind, description=body.description.strip(), amount=amount,
                                   created_by=actor.id))
    audit.record(db, user=actor, action="add_charge", entity="booking", entity_id=b.id,
                 after={"name": name_of(b), "kind": body.kind, "description": body.description,
                        "amount": float(amount), "approved_by": approver.name}, request=request)
    await db.commit()
    return await respond(db, b.id)


@router.post("/{booking_id}/charges/{charge_id}/remove", response_model=BookingOut)
async def remove_charge(booking_id: int, charge_id: int, body: RemoveChargeIn, actor: RoomsManager, db: DB,
                        request: Request):
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked", "checked_in")
    charge = next((c for c in b.charges if c.id == charge_id), None)
    if not charge:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That charge isn't on this bill")
    if charge.kind == "room_service":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"This is POS bill #{charge.order_id}. Void that bill on the POS to take it off.")
    approver = await authorize(db, actor, APPROVE, body.approval, request) if charge.kind == "extra" else actor
    audit.record(db, user=actor, action="remove_charge", entity="booking", entity_id=b.id,
                 before={"name": name_of(b), "description": charge.description, "amount": float(charge.amount)},
                 after={"name": name_of(b), "reason": body.reason, "approved_by": approver.name}, request=request)
    b.charges.remove(charge)
    await db.commit()
    return await respond(db, b.id)


@router.post("/{booking_id}/payments", response_model=BookingOut)
async def take_payment(booking_id: int, body: AdvanceIn, actor: RoomsManager, db: DB, request: Request):
    """An advance when booking, or a part payment during the stay."""
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked", "checked_in")
    add_payment(b, body, actor)
    audit.record(db, user=actor, action="payment", entity="booking", entity_id=b.id,
                 after={"name": name_of(b), "method": body.method, "amount": float(body.amount)}, request=request)
    await db.commit()
    return await respond(db, b.id)


# ---- Check out --------------------------------------------------------------------------------------

@router.post("/{booking_id}/check-out", response_model=BookingOut)
async def check_out(booking_id: int, body: CheckOutIn, actor: RoomsManager, db: DB, request: Request):
    """Fix the room charge, take the balance (or give back extra advance), and free the room."""
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "checked_in")
    bills = await open_bills(db, b.id)
    if bills:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Room service bill #{bills[0].id} is still open. Charge it to the room or close it on the POS first.",
        )
    tz = await tz_name(db)
    now = datetime.now(timezone.utc)
    b.checked_out_at = now
    stayed = folio_math.default_units(b, now, tz)
    units = body.units if body.units is not None else stayed
    approver = actor
    if units < stayed:
        approver = await authorize(db, actor, APPROVE, body.approval, request)
    b.units_charged = units
    b.room_charge = folio_math.charge_for(b, units)

    for p in body.payments:
        add_payment(b, p, actor)
    f = folio_math.folio(b, tz, now)
    if f.balance > 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{f.balance:,.2f} is still to pay")
    if f.balance < 0:
        if not body.refund_method:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"The guest paid {-f.balance:,.2f} more than the bill. Choose how to give it back.")
        b.payments.append(BookingPayment(kind="refund", method=body.refund_method, amount=-f.balance,
                                         reference="Change at check-out", created_by=actor.id))
    b.status, b.checked_out_by = "checked_out", actor.id
    b.room.housekeeping = "dirty"
    f = folio_math.folio(b, tz, now)
    audit.record(db, user=actor, action="check_out", entity="booking", entity_id=b.id,
                 after={"name": name_of(b), f"{f.unit_label}s": float(units), "room_charge": float(f.room_charge),
                        "total": float(f.total), "approved_by": approver.name if approver is not actor else None},
                 request=request)
    await db.commit()
    return await respond(db, b.id)


# ---- Cancel and no-show -----------------------------------------------------------------------------

@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel(booking_id: int, body: CancelIn, actor: RoomsManager, db: DB, request: Request):
    """Cancel a booking (or mark a no-show). Any advance is refunded or kept as a cancellation charge."""
    b = await load(db, booking_id, lock=True)
    ensure_status(b, "booked")
    bills = await open_bills(db, b.id)
    if bills:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Room service bill #{bills[0].id} is still open")
    paid = folio_math.folio(b, await tz_name(db)).paid
    extras = sum((c.amount for c in b.charges), ZERO)
    advance = paid - extras  # money held beyond anything already charged
    if advance > 0:
        if body.advance is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"The guest paid {advance:,.2f} in advance. Choose to refund or keep it.")
        if body.advance == "refund":
            if not body.refund_method:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose how the advance is given back")
            b.payments.append(BookingPayment(kind="refund", method=body.refund_method, amount=advance,
                                             reference="Advance refunded", created_by=actor.id))
        else:
            b.charges.append(BookingCharge(kind="extra", description="Cancellation: advance kept", amount=advance,
                                           created_by=actor.id))
    b.status = "no_show" if body.no_show else "cancelled"
    b.cancel_reason = body.reason.strip()
    audit.record(db, user=actor, action="no_show" if body.no_show else "cancel", entity="booking", entity_id=b.id,
                 after={"name": name_of(b), "reason": body.reason,
                        "advance": f"{body.advance} {float(advance):,.2f}" if advance > 0 else None}, request=request)
    await db.commit()
    return await respond(db, b.id)
