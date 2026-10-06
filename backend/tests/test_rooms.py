"""Phase 5: room types, rooms, bookings, check-in/out, room bill and room service."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services import rooms as folio_math
from tests.conftest import bearer, login, make_user

NOW = datetime.now(timezone.utc)


async def call(client, h, method, path, body=None, code=(200, 201)):
    r = await client.request(method, path, json=body, headers=h)
    assert r.status_code in (code if isinstance(code, tuple) else (code,)), (path, r.status_code, r.text)
    return r.json() if r.content else None


def iso(d: datetime) -> str:
    return d.isoformat()


@pytest.fixture
async def hotel(client, owner):
    h = owner
    std = await call(client, h, "POST", "/api/room-types", {
        "name": "Standard AC", "nightly_rate": 8000, "short_stay_rate": 3000, "short_stay_hours": 3,
        "extra_hour_rate": 800, "max_guests": 2})
    r101 = await call(client, h, "POST", "/api/rooms", {"number": "101", "room_type_id": std["id"], "floor": "1"})
    r102 = await call(client, h, "POST", "/api/rooms", {"number": "102", "room_type_id": std["id"], "floor": "1"})
    return SimpleNamespace(std=std, r101=r101, r102=r102)


def guest(**extra):
    return {"guest_name": "Nuwan Perera", "phone": "0771234567", "id_type": "nic", "id_number": "901234567V",
            **extra}


async def book(client, h, room_id, days=2, start=None, **extra):
    start = start or NOW + timedelta(days=1)
    return await call(client, h, "POST", "/api/bookings", {
        **guest(), "room_id": room_id, "arrival": iso(start), "departure": iso(start + timedelta(days=days)), **extra})


# ---- Setup ----------------------------------------------------------------------------

async def test_room_types_and_rooms(client, owner, hotel):
    h = owner
    types = await call(client, h, "GET", "/api/room-types")
    assert types[0]["room_count"] == 2 and types[0]["nightly_rate"] == 8000
    await call(client, h, "POST", "/api/rooms", {"number": "101", "room_type_id": hotel.std["id"]}, code=409)
    await call(client, h, "DELETE", f"/api/room-types/{hotel.std['id']}", code=409)
    deluxe = await call(client, h, "POST", "/api/room-types", {"name": "Deluxe", "nightly_rate": 15000})
    moved = await call(client, h, "PUT", f"/api/rooms/{hotel.r102['id']}",
                       {"number": "102", "room_type_id": deluxe["id"], "floor": "1"})
    assert moved["room_type"]["name"] == "Deluxe"
    await call(client, h, "POST", f"/api/rooms/{hotel.r102['id']}/housekeeping", {"housekeeping": "maintenance"})
    board = await call(client, h, "GET", "/api/rooms/board")
    assert [r["housekeeping"] for r in board["rooms"]] == ["clean", "maintenance"]


# ---- Booking ------------------------------------------------------------------------------

async def test_booking_with_advance_and_clash(client, owner, hotel):
    h = owner
    b = await book(client, h, hotel.r101["id"], advance={"method": "cash", "amount": 5000})
    assert b["status"] == "booked" and b["rate"] == 8000
    assert b["folio"]["units"] == 2 and b["folio"]["room_charge"] == 16000 and b["folio"]["estimated"]
    assert b["folio"]["paid"] == 5000 and b["folio"]["balance"] == 11000

    # Overlapping dates on the same room are refused; another room is fine.
    start = NOW + timedelta(days=2)
    r = await client.post("/api/bookings", headers=h, json={
        **guest(guest_name="Other"), "room_id": hotel.r101["id"], "arrival": iso(start),
        "departure": iso(start + timedelta(days=1))})
    assert r.status_code == 409 and "Nuwan Perera" in r.json()["detail"]
    free = await call(client, h, "GET",
                      f"/api/rooms/available?arrival={start.isoformat().replace('+', '%2B')}"
                      f"&departure={(start + timedelta(days=1)).isoformat().replace('+', '%2B')}")
    assert [x["number"] for x in free] == ["102"]
    # Back-to-back stays (leave the day the next one arrives) don't clash.
    after = NOW + timedelta(days=3)
    await book(client, h, hotel.r101["id"], days=1, start=after)


async def test_check_in_needs_id_and_free_room(client, owner, hotel):
    h = owner
    start = NOW - timedelta(hours=1)
    b = await call(client, h, "POST", "/api/bookings", {
        "guest_name": "Walk In", "room_id": hotel.r101["id"], "arrival": iso(start),
        "departure": iso(start + timedelta(days=1))})
    r = await client.post(f"/api/bookings/{b['id']}/check-in", json={}, headers=h)
    assert r.status_code == 400 and "phone" in r.json()["detail"] and "NIC number" in r.json()["detail"]
    b = await call(client, h, "POST", f"/api/bookings/{b['id']}/check-in",
                   {"phone": "0711111111", "id_type": "passport", "id_number": "N1234567"})
    assert b["status"] == "checked_in" and b["checked_in_at"]
    board = await call(client, h, "GET", "/api/rooms/board")
    room = next(r for r in board["rooms"] if r["number"] == "101")
    assert room["state"] == "occupied" and room["stay"]["guest_name"] == "Walk In"
    assert board["in_house"] == 1


async def test_walk_in_check_in_now(client, owner, hotel):
    h = owner
    b = await book(client, h, hotel.r102["id"], days=1, start=NOW, check_in_now=True)
    assert b["status"] == "checked_in"
    inhouse = await call(client, h, "GET", "/api/bookings/in-house")
    assert [x["room"]["number"] for x in inhouse] == ["102"]


# ---- Room service and the room bill ------------------------------------------------------------

@pytest.fixture
async def beer(client, owner):
    cat = (await call(client, owner, "POST", "/api/categories", {"name": "Beer", "module": "bar"}))["id"]
    it = await call(client, owner, "POST", "/api/items", {
        "name": "Lion Lager", "category_id": cat, "base_unit": "piece", "unit_size": 1, "stock_unit": "bottle",
        "cost_price": 400, "selling_price": 1000})
    await call(client, owner, "POST", f"/api/items/{it['id']}/opening", {"qty": 24, "cost_per_unit": 400})
    return it


async def test_room_service_charged_to_room_then_checkout(client, owner, hotel, beer):
    h = owner
    s = await call(client, h, "GET", "/api/settings")
    await call(client, h, "PUT", "/api/settings", {**s, "service_charge_percent": 10, "room_tax_percent": 5})
    b = await book(client, h, hotel.r101["id"], days=1, start=NOW, check_in_now=True,
                   advance={"method": "card", "amount": 5000})

    o = await call(client, h, "POST", "/api/orders", {"type": "room", "booking_id": b["id"]})
    assert o["label"] == "Room 101 · Nuwan Perera"
    o = await call(client, h, "POST", f"/api/orders/{o['id']}/lines", {"item_id": beer["id"], "qty": 2})
    assert o["total"] == 2200  # 2000 + 10% service

    # Check-out is blocked while room service is unpaid.
    r = await client.post(f"/api/bookings/{b['id']}/check-out", json={}, headers=h)
    assert r.status_code == 400 and f"#{o['id']}" in r.json()["detail"]

    o = await call(client, h, "POST", f"/api/orders/{o['id']}/payments",
                   {"method": "room", "amount": o["due"]})
    assert o["status"] == "paid" and o["payments"][0]["reference"] == "Room 101"
    assert (await call(client, h, "GET", f"/api/items/{beer['id']}"))["on_hand"] == 22

    await call(client, h, "POST", f"/api/bookings/{b['id']}/charges",
               {"kind": "extra", "description": "Laundry", "amount": 1000})
    b = await call(client, h, "POST", f"/api/bookings/{b['id']}/charges",
                   {"kind": "discount", "description": "Regular guest", "amount": 500})
    f = b["folio"]
    # Room 8000 + laundry 1000 - discount 500 = 8500, tax 5% = 425, + room service 2200
    assert (f["room_charge"], f["extras"], f["discounts"], f["tax"]) == (8000, 1000, -500, 425)
    assert f["room_service"] == 2200 and f["total"] == 11125 and f["balance"] == 6125

    r = await client.post(f"/api/bookings/{b['id']}/check-out",
                          json={"payments": [{"method": "cash", "amount": 6000}]}, headers=h)
    assert r.status_code == 400 and "125.00 is still to pay" in r.json()["detail"]
    b = await call(client, h, "POST", f"/api/bookings/{b['id']}/check-out",
                   {"payments": [{"method": "cash", "amount": 6125}]})
    assert b["status"] == "checked_out" and b["folio"]["balance"] == 0 and not b["folio"]["estimated"]
    board = await call(client, h, "GET", "/api/rooms/board")
    room = next(r for r in board["rooms"] if r["number"] == "101")
    assert room["state"] == "free" and room["housekeeping"] == "dirty"

    # The room service bill was settled at check-out, so it can't be voided now.
    r = await client.post(f"/api/orders/{o['id']}/void", json={"reason": "wrong room"}, headers=h)
    assert r.status_code == 400 and "checked out" in r.json()["detail"]


async def test_void_room_service_takes_it_off_the_room_bill(client, owner, hotel, beer):
    h = owner
    b = await book(client, h, hotel.r101["id"], days=1, start=NOW, check_in_now=True)
    o = await call(client, h, "POST", "/api/orders", {"type": "bar"})
    o = await call(client, h, "POST", f"/api/orders/{o['id']}/lines", {"item_id": beer["id"]})
    # A bar bill can be charged to a room too, by choosing the room.
    r = await client.post(f"/api/orders/{o['id']}/payments", headers=h,
                          json={"method": "room", "amount": 500, "booking_id": b["id"]})
    assert r.status_code == 400 and "full" in r.json()["detail"]  # the whole bill goes to the room
    o = await call(client, h, "POST", f"/api/orders/{o['id']}/payments",
                   {"method": "room", "amount": o["due"], "booking_id": b["id"]})
    b = await call(client, h, "GET", f"/api/bookings/{b['id']}")
    assert b["folio"]["room_service"] == 1000
    await call(client, h, "POST", f"/api/orders/{o['id']}/void", {"reason": "charged wrong room"})
    b = await call(client, h, "GET", f"/api/bookings/{b['id']}")
    assert b["folio"]["room_service"] == 0 and b["charges"] == []
    assert (await call(client, h, "GET", f"/api/items/{beer['id']}"))["on_hand"] == 24


async def test_overpaid_advance_is_refunded_at_checkout(client, owner, hotel):
    h = owner
    b = await book(client, h, hotel.r101["id"], days=1, start=NOW, check_in_now=True,
                   advance={"method": "cash", "amount": 10000})
    r = await client.post(f"/api/bookings/{b['id']}/check-out", json={}, headers=h)
    assert r.status_code == 400 and "2,000.00 more" in r.json()["detail"]
    b = await call(client, h, "POST", f"/api/bookings/{b['id']}/check-out", {"refund_method": "cash"})
    assert b["payments"][-1]["kind"] == "refund" and b["payments"][-1]["amount"] == 2000
    assert b["folio"]["paid"] == 8000 and b["folio"]["balance"] == 0


async def test_fewer_nights_needs_manager(client, owner, hotel, sessionmaker):
    h = owner
    await make_user(client, h, "desk", "receptionist")
    boss = await make_user(client, h, "boss", "manager", pin="4321")
    desk = bearer(await login(client, "desk", "Password123"))
    b = await book(client, desk, hotel.r101["id"], days=3, start=NOW, check_in_now=True)
    # Pretend the guest checked in two days ago.
    from app.models import Booking

    async with sessionmaker() as s:
        row = await s.get(Booking, b["id"])
        row.checked_in_at = NOW - timedelta(days=2)
        await s.commit()
    r = await client.post(f"/api/bookings/{b['id']}/check-out", headers=desk,
                          json={"units": 1, "payments": [{"method": "cash", "amount": 8000}]})
    assert r.status_code == 428
    b = await call(client, desk, "POST", f"/api/bookings/{b['id']}/check-out", {
        "units": 1, "payments": [{"method": "cash", "amount": 8000}],
        "approval": {"user_id": boss["id"], "pin": "4321"}})
    assert b["folio"]["units"] == 1 and b["folio"]["room_charge"] == 8000


# ---- Short stays and night counting ---------------------------------------------------------------

def _b(stay_type, start, end, rate, block=3, extra=Decimal(800), status="checked_out"):
    return SimpleNamespace(stay_type=stay_type, checked_in_at=start, checked_out_at=end, arrival=start,
                           departure=end, status=status, block_hours=block, rate=Decimal(rate),
                           extra_hour_rate=extra)


def test_short_stay_charge():
    t0 = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)
    within = _b("short", t0, t0 + timedelta(hours=3, minutes=10), 3000)
    assert folio_math.default_units(within, t0, "Asia/Colombo") == 3  # 10 minutes over is in the grace
    over = _b("short", t0, t0 + timedelta(hours=4, minutes=40), 3000)
    units = folio_math.default_units(over, t0, "Asia/Colombo")
    assert units == 5 and folio_math.charge_for(over, units) == Decimal("4600.00")


def test_nights_count_by_local_date():
    # 2pm Colombo on the 6th to 11am on the 8th = 2 nights.
    start = datetime(2026, 10, 6, 8, 30, tzinfo=timezone.utc)
    end = datetime(2026, 10, 8, 5, 30, tzinfo=timezone.utc)
    assert folio_math.default_units(_b("night", start, end, 8000), end, "Asia/Colombo") == 2
    # Same-day day use still counts one night.
    assert folio_math.default_units(_b("night", start, start + timedelta(hours=5), 8000), end, "Asia/Colombo") == 1


# ---- Cancel ----------------------------------------------------------------------------------

async def test_cancel_refund_or_keep_advance(client, owner, hotel):
    h = owner
    b = await book(client, h, hotel.r101["id"], advance={"method": "cash", "amount": 3000})
    r = await client.post(f"/api/bookings/{b['id']}/cancel", json={"reason": "Plans changed"}, headers=h)
    assert r.status_code == 400 and "3,000.00" in r.json()["detail"]
    b = await call(client, h, "POST", f"/api/bookings/{b['id']}/cancel",
                   {"reason": "Plans changed", "advance": "refund", "refund_method": "cash"})
    assert b["status"] == "cancelled" and b["folio"]["paid"] == 0 and b["folio"]["total"] == 0

    b2 = await book(client, h, hotel.r101["id"], advance={"method": "card", "amount": 2000})
    b2 = await call(client, h, "POST", f"/api/bookings/{b2['id']}/cancel",
                    {"reason": "Did not come", "no_show": True, "advance": "keep"})
    assert b2["status"] == "no_show" and b2["folio"]["total"] == 2000 and b2["folio"]["balance"] == 0
    # The room is free again for those dates.
    await book(client, h, hotel.r101["id"])


# ---- Permissions -------------------------------------------------------------------------------

async def test_receptionist_takes_room_service_only(client, owner, hotel, beer):
    h = owner
    await make_user(client, h, "desk", "receptionist")
    desk = bearer(await login(client, "desk", "Password123"))
    b = await book(client, desk, hotel.r101["id"], days=1, start=NOW, check_in_now=True)
    r = await client.post("/api/orders", json={"type": "bar"}, headers=desk)
    assert r.status_code == 403
    o = await call(client, desk, "POST", "/api/orders", {"type": "room", "booking_id": b["id"]})
    o = await call(client, desk, "POST", f"/api/orders/{o['id']}/lines", {"item_id": beer["id"]})
    o = await call(client, desk, "POST", f"/api/orders/{o['id']}/payments", {"method": "room", "amount": o["due"]})
    assert o["status"] == "paid"

    await make_user(client, h, "waiter1", "waiter")
    waiter = bearer(await login(client, "waiter1", "Password123"))
    r = await client.get("/api/bookings", headers=waiter)
    assert r.status_code == 403
    r = await client.get("/api/bookings/in-house", headers=waiter)
    assert r.status_code == 200 and len(r.json()) == 1
