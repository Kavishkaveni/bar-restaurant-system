"""Phase 7: the dashboard and live updates."""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import app
from app.services import live
from tests.conftest import bearer, login, make_user


async def call(client, h, method, path, body=None, code=(200, 201)):
    r = await client.request(method, path, json=body, headers=h)
    assert r.status_code in (code if isinstance(code, tuple) else (code,)), (path, r.status_code, r.text)
    return r.json() if r.content else None


# ---- Dashboard -----------------------------------------------------------------------

async def test_dashboard(client, owner):
    h = owner
    bar = (await call(client, h, "POST", "/api/categories", {"name": "Beer", "module": "bar"}))["id"]
    food = (await call(client, h, "POST", "/api/categories", {"name": "Mains", "module": "food"}))["id"]
    beer = await call(client, h, "POST", "/api/items", {
        "name": "Lion Lager", "category_id": bar, "base_unit": "piece", "unit_size": 1, "stock_unit": "bottle",
        "cost_price": 400, "selling_price": 1000, "reorder_level": 12})
    await call(client, h, "POST", f"/api/items/{beer['id']}/opening", {"qty": 10, "cost_per_unit": 400})
    dish = await call(client, h, "POST", "/api/items", {
        "name": "Kottu", "category_id": food, "base_unit": "piece", "unit_size": 1, "stock_unit": "plate",
        "cost_price": 0, "selling_price": 1500, "kind": "build_assembly"})

    o = await call(client, h, "POST", "/api/orders", {"type": "bar"})
    o = await call(client, h, "POST", f"/api/orders/{o['id']}/lines", {"item_id": beer["id"], "qty": 2})
    await call(client, h, "POST", f"/api/orders/{o['id']}/payments", {"method": "card", "amount": o["due"]})
    o2 = await call(client, h, "POST", "/api/orders", {"type": "takeaway"})
    await call(client, h, "POST", f"/api/orders/{o2['id']}/lines", {"item_id": dish["id"]})  # open, in the kitchen

    rt = await call(client, h, "POST", "/api/room-types", {"name": "Std", "nightly_rate": 8000})
    r1 = await call(client, h, "POST", "/api/rooms", {"number": "1", "room_type_id": rt["id"]})
    await call(client, h, "POST", "/api/rooms", {"number": "2", "room_type_id": rt["id"]})
    now = datetime.now(timezone.utc)
    await call(client, h, "POST", "/api/bookings", {
        "guest_name": "G", "phone": "077", "id_number": "1", "room_id": r1["id"], "arrival": now.isoformat(),
        "departure": (now + timedelta(days=1)).isoformat(), "check_in_now": True})
    await call(client, h, "POST", "/api/shifts", {"opening_float": 3000})

    d = await call(client, h, "GET", "/api/dashboard")
    t = d["today"]
    assert (t["sales"], t["bills"], t["average_bill"], t["money_in"]) == (2000, 1, 2000, 2000)
    assert t["cost"] == 800 and t["profit"] == 1200 and t["sales_yesterday"] == 0
    assert len(d["hourly"]) == 24 and sum(h["today"] or 0 for h in d["hourly"]) == 2000
    assert len(d["trend"]) == 30 and d["trend"][-1]["sales"] == 2000
    assert d["rooms"] == {"total": 2, "occupied": 1, "arriving": 0, "leaving": 0, "to_clean": 0, "maintenance": 0}
    assert d["open_bills"] == 1 and d["open_total"] == 1500 and d["kitchen"]["new"] == 1
    assert d["low_stock_count"] == 1 and d["low_stock"][0]["on_hand"] == "8 bottles"
    assert d["drawer_expected"] == 3000
    assert d["recent"][0]["methods"] == ["card"]

    await make_user(client, h, "mgr", "manager")
    mgr = bearer(await login(client, "mgr", "Password123"))
    d = await call(client, mgr, "GET", "/api/dashboard")
    assert d["today"]["sales"] == 2000 and d["today"]["profit"] is None and d["today"]["cost"] is None
    await make_user(client, h, "waiter1", "waiter")
    waiter = bearer(await login(client, "waiter1", "Password123"))
    await call(client, waiter, "GET", "/api/dashboard", code=403)


# ---- Live updates ------------------------------------------------------------------------

def test_topics():
    assert live.topic_for("/api/orders/12/payments") == "orders"
    assert live.topic_for("/api/bookings/3/check-out") == "rooms"
    assert live.topic_for("/api/shifts") == "money"
    assert live.topic_for("/api/auth/login") is None


async def test_hub_sends_through_postgres():
    hub = live.Hub()
    q = hub.subscribe()
    try:
        await hub.start()
        assert hub._conn is not None
        await hub.publish("orders", user_id=5)
        msg = json.loads(await asyncio.wait_for(q.get(), timeout=5))
        assert msg == {"topic": "orders", "by": 5}
    finally:
        await hub.stop()
    # With no database link, screens on this server still hear about changes.
    hub.deliver('{"topic": "rooms"}')
    assert json.loads(q.get_nowait())["topic"] == "rooms"
    hub.unsubscribe(q)


async def test_changes_are_announced(client, owner, monkeypatch):
    sent = []

    async def fake_publish(topic, user_id=None):
        sent.append(topic)

    monkeypatch.setattr(get_settings(), "live_updates", True)
    monkeypatch.setattr(live.hub, "publish", fake_publish)
    await call(client, owner, "POST", "/api/categories", {"name": "Beer", "module": "bar"})
    await call(client, owner, "POST", "/api/shifts", {"opening_float": 0})
    await call(client, owner, "POST", "/api/shifts", {"opening_float": 0}, code=409)  # failed: not announced
    await call(client, owner, "GET", "/api/dashboard")                                # reads: not announced
    assert sent == ["stock", "money"]


def test_websocket_needs_a_token():
    with TestClient(app) as tc:
        with pytest.raises(WebSocketDisconnect), tc.websocket_connect("/api/live?token=nope") as ws:
            ws.receive_text()
        token = create_access_token(1, 0)
        with tc.websocket_connect(f"/api/live?token={token}") as ws:
            tc.portal.call(live.hub.deliver, '{"topic": "kitchen"}')
            assert json.loads(ws.receive_text()) == {"topic": "kitchen"}
