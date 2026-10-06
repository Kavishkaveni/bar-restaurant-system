"""Phase 6: expenses, the cash drawer (shifts) and reports."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from tests.conftest import bearer, login, make_user

TODAY = datetime.now(ZoneInfo("Asia/Colombo")).date()


async def call(client, h, method, path, body=None, code=(200, 201)):
    r = await client.request(method, path, json=body, headers=h)
    assert r.status_code in (code if isinstance(code, tuple) else (code,)), (path, r.status_code, r.text)
    return r.json() if r.content else None


async def cat_id(client, h, name):
    cats = await call(client, h, "GET", "/api/expense-categories")
    return next(c["id"] for c in cats if c["name"] == name)


@pytest.fixture
async def shop(client, owner):
    """A beer (bar) and a dish (kitchen) to sell."""
    h = owner
    bar = (await call(client, h, "POST", "/api/categories", {"name": "Beer", "module": "bar"}))["id"]
    food = (await call(client, h, "POST", "/api/categories", {"name": "Mains", "module": "food"}))["id"]
    raw = (await call(client, h, "POST", "/api/categories", {"name": "Raw", "module": "other"}))["id"]
    beer = await call(client, h, "POST", "/api/items", {
        "name": "Lion Lager", "category_id": bar, "base_unit": "piece", "unit_size": 1, "stock_unit": "bottle",
        "cost_price": 400, "selling_price": 1000, "reorder_level": 30})
    await call(client, h, "POST", f"/api/items/{beer['id']}/opening", {"qty": 24, "cost_per_unit": 400})
    chicken = await call(client, h, "POST", "/api/items", {
        "name": "Chicken", "category_id": raw, "base_unit": "g", "unit_size": 1000, "stock_unit": "kg",
        "cost_price": 1500})
    await call(client, h, "POST", f"/api/items/{chicken['id']}/opening", {"qty": 5000, "cost_per_unit": 1500})
    dish = await call(client, h, "POST", "/api/items", {
        "name": "Devilled Chicken", "category_id": food, "base_unit": "piece", "unit_size": 1, "stock_unit": "plate",
        "cost_price": 0, "selling_price": 1500, "kind": "build_assembly"})
    await call(client, h, "PUT", f"/api/items/{dish['id']}/recipe",
               {"lines": [{"component_id": chicken["id"], "qty": 200}]})
    return {"beer": beer, "dish": dish, "chicken": chicken}


async def sell(client, h, lines, method="cash", **pay):
    o = await call(client, h, "POST", "/api/orders", {"type": "bar"})
    for item_id, qty in lines:
        o = await call(client, h, "POST", f"/api/orders/{o['id']}/lines", {"item_id": item_id, "qty": qty})
    return await call(client, h, "POST", f"/api/orders/{o['id']}/payments",
                      {"method": method, "amount": o["due"], **pay})


# ---- Expenses -------------------------------------------------------------------------

async def test_expense_categories_and_expenses(client, owner):
    h = owner
    cats = await call(client, h, "GET", "/api/expense-categories")
    assert len(cats) == 13 and cats[0]["name"] == "Salaries and wages"
    await call(client, h, "POST", "/api/expense-categories", {"name": "rent"}, code=409)
    new = await call(client, h, "POST", "/api/expense-categories", {"name": "Generator fuel"})
    assert new["sort_order"] == 13

    rent = await cat_id(client, h, "Rent")
    power = await cat_id(client, h, "Electricity")
    await call(client, h, "POST", "/api/expenses", {"category_id": rent, "date": str(TODAY), "amount": 75000,
                                                   "method": "bank_transfer", "payee": "Landlord"})
    e = await call(client, h, "POST", "/api/expenses", {"category_id": power, "date": str(TODAY), "amount": 18500})
    await call(client, h, "POST", "/api/expenses",
               {"category_id": power, "date": str(TODAY + timedelta(days=1)), "amount": 1}, code=400)
    page = await call(client, h, "GET", f"/api/expenses?start={TODAY}&end={TODAY}")
    assert page["total"] == 93500 and [c["name"] for c in page["by_category"]] == ["Rent", "Electricity"]

    e = await call(client, h, "PUT", f"/api/expenses/{e['id']}",
                   {"category_id": power, "date": str(TODAY), "amount": 18000, "payee": "CEB"})
    assert e["amount"] == 18000 and e["payee"] == "CEB"
    await call(client, h, "POST", f"/api/expenses/{e['id']}/void", {"reason": "Entered twice"})
    page = await call(client, h, "GET", f"/api/expenses?start={TODAY}&end={TODAY}")
    assert page["total"] == 75000 and len(page["items"]) == 1


# ---- Cash drawer ------------------------------------------------------------------------

async def test_drawer_expected_cash(client, owner, shop):
    h = owner
    assert await call(client, h, "GET", "/api/shifts/current") is None
    shift = await call(client, h, "POST", "/api/shifts", {"opening_float": 5000})
    await call(client, h, "POST", "/api/shifts", {"opening_float": 1}, code=409)

    await sell(client, h, [(shop["beer"]["id"], 1)], tendered=2000, tip=100)  # 1000 + 100 tip in cash
    await sell(client, h, [(shop["beer"]["id"], 2)], method="card")             # card isn't in the drawer
    voided = await sell(client, h, [(shop["beer"]["id"], 1)])                    # 1000 cash, then voided
    await call(client, h, "POST", f"/api/orders/{voided['id']}/void", {"reason": "Wrong bill"})

    # Room advance in cash goes into the drawer too.
    rt = await call(client, h, "POST", "/api/room-types", {"name": "Std", "nightly_rate": 8000})
    room = await call(client, h, "POST", "/api/rooms", {"number": "1", "room_type_id": rt["id"]})
    start = datetime.now(timezone.utc) + timedelta(days=2)
    await call(client, h, "POST", "/api/bookings", {
        "guest_name": "A", "room_id": room["id"], "arrival": start.isoformat(),
        "departure": (start + timedelta(days=1)).isoformat(), "advance": {"method": "cash", "amount": 2000}})

    other = await cat_id(client, h, "Transport")
    await call(client, h, "POST", "/api/expenses", {"category_id": other, "date": str(TODAY), "amount": 500,
                                                   "from_drawer": True, "payee": "Tuk tuk"})
    s = await call(client, h, "POST", f"/api/shifts/{shift['id']}/cash", {"kind": "out", "amount": 3000,
                                                                          "reason": "To the safe"})
    d = s["drawer"]
    assert (d["cash_sales"], d["cash_refunds"], d["room_cash"], d["paid_out"], d["cash_out"]) == \
        (2100, 1000, 2000, 500, 3000)
    assert d["expected"] == 5000 + 2100 - 1000 + 2000 - 500 - 3000 == 4600
    await call(client, h, "POST", f"/api/shifts/{shift['id']}/cash", {"kind": "out", "amount": 99999,
                                                                      "reason": "Too much"}, code=400)

    s = await call(client, h, "POST", f"/api/shifts/{shift['id']}/close", {"counted_cash": 4500})
    assert s["status"] == "closed" and s["difference"] == -100 and len(s["payouts"]) == 1
    assert await call(client, h, "GET", "/api/shifts/current") is None
    # No open drawer: can't pay from it, and its pay-out can't be changed any more.
    await call(client, h, "POST", "/api/expenses", {"category_id": other, "date": str(TODAY), "amount": 100,
                                                   "from_drawer": True}, code=400)
    paid_out = s["payouts"][0]["id"]
    await call(client, h, "POST", f"/api/expenses/{paid_out}/void", {"reason": "oops"}, code=400)
    history = await call(client, h, "GET", "/api/shifts")
    assert history[0]["id"] == shift["id"] and history[0]["drawer"]["expected"] == 4600


async def test_cashier_pays_out_but_cannot_manage_expenses(client, owner, shop):
    await make_user(client, owner, "bar1", "bartender")
    bar = bearer(await login(client, "bar1", "Password123"))
    transport = await cat_id(client, owner, "Transport")
    await call(client, bar, "POST", "/api/shifts", {"opening_float": 2000})
    e = await call(client, bar, "POST", "/api/expenses", {"category_id": transport, "date": str(TODAY),
                                                        "amount": 300, "from_drawer": True})
    assert e["method"] == "cash" and e["shift_id"]
    await call(client, bar, "POST", "/api/expenses", {"category_id": transport, "date": str(TODAY),
                                                    "amount": 300}, code=403)
    await call(client, bar, "GET", "/api/expenses", code=403)
    await call(client, bar, "GET", "/api/reports/summary", code=403)


# ---- Reports ------------------------------------------------------------------------------

async def test_summary_report(client, owner, shop):
    h = owner
    s = await call(client, h, "GET", "/api/settings")
    await call(client, h, "PUT", "/api/settings", {**s, "service_charge_percent": 10})

    await sell(client, h, [(shop["beer"]["id"], 3), (shop["dish"]["id"], 2)])  # 3000 bar + 3000 kitchen
    v = await sell(client, h, [(shop["beer"]["id"], 1)])
    await call(client, h, "POST", f"/api/orders/{v['id']}/void", {"reason": "test"})
    await call(client, h, "POST", f"/api/items/{shop['beer']['id']}/wastage", {"qty": 1, "reason": "Broken"})
    rent = await cat_id(client, h, "Rent")
    await call(client, h, "POST", "/api/expenses", {"category_id": rent, "date": str(TODAY), "amount": 2000})

    r = await call(client, h, "GET", "/api/reports/summary")
    assert r["start"] == r["end"] == str(TODAY)
    assert (r["bills"], r["gross_sales"], r["sales_net"], r["voids"]) == (1, 6000, 6000, 1)
    assert {x["key"]: x["amount"] for x in r["by_section"]} == {"bar": 3000, "food": 3000}
    # Cost: 3 beers x 400 + 2 plates x 200 g chicken at 1.5/g = 1200 + 600
    assert r["cost_of_sales"] == 1800 and r["wastage"] == 400 and r["expenses"] == 2000
    assert r["gross_profit"] == 4200 and r["net_profit"] == 4200 - 400 - 2000
    assert r["payments"] == [{"key": "cash", "label": "Cash", "amount": 6000, "count": 0}]
    assert r["top_items"][0]["name"] in ("Lion Lager", "Devilled Chicken")
    assert len(r["daily"]) == 1 and r["daily"][0]["profit"] == 1800

    # A manager sees sales but not profit.
    await make_user(client, h, "mgr", "manager")
    mgr = bearer(await login(client, "mgr", "Password123"))
    r = await call(client, mgr, "GET", f"/api/reports/summary?start={TODAY - timedelta(days=6)}&end={TODAY}")
    assert r["gross_sales"] == 6000 and r["net_profit"] is None and r["cost_of_sales"] is None
    assert len(r["daily"]) == 7


async def test_stock_report(client, owner, shop):
    h = owner
    await sell(client, h, [(shop["beer"]["id"], 2), (shop["dish"]["id"], 1)])
    await call(client, h, "POST", f"/api/items/{shop['beer']['id']}/wastage", {"qty": 1, "reason": "Broken"})
    rows = await call(client, h, "GET", "/api/reports/stock")
    beer = next(x for x in rows if x["name"] == "Lion Lager")
    assert (beer["opening"], beer["received"], beer["sold"], beer["wasted"]) == \
        ("0 bottles", "24 bottles", "2 bottles", "1 bottle")
    assert beer["closing_qty"] == 21 and beer["closing_value"] == 8400 and beer["low"]
    chicken = next(x for x in rows if x["name"] == "Chicken")
    assert chicken["sold"] == "0.2 kg" and chicken["closing_qty"] == 4800
    assert not any(x["name"] == "Devilled Chicken" for x in rows)  # dishes aren't stock

    # Tomorrow's report starts from today's closing.
    later = TODAY + timedelta(days=1)
    rows = await call(client, h, "GET", f"/api/reports/stock?start={later}&end={later}")
    beer = next(x for x in rows if x["name"] == "Lion Lager")
    assert beer["opening"] == beer["closing"] and beer["sold"] == "—"
    await call(client, h, "GET", f"/api/reports/stock?start={TODAY}&end={TODAY - timedelta(days=1)}", code=400)


def test_dates_import():
    assert isinstance(TODAY, date)
