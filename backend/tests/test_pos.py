"""Phase 3: tables, orders, bills, payments, approvals and stock deduction."""

import pytest

from tests.conftest import bearer, login, make_user


@pytest.fixture
async def shop(client, owner):
    """A bar with whisky (bottles), cigarettes (packs + singles), a table, and stock."""
    h = owner
    whisky_cat = (await client.post("/api/categories", json={"name": "Whisky", "module": "bar"}, headers=h)).json()
    cig_cat = (await client.post("/api/categories", json={"name": "Cigarettes", "module": "sundry"}, headers=h)).json()
    rice_cat = (await client.post("/api/categories", json={"name": "Rice", "module": "food"}, headers=h)).json()

    whisky = (await client.post("/api/items", json={
        "name": "Black Label 750ml", "category_id": whisky_cat["id"], "base_unit": "ml", "unit_size": 750,
        "stock_unit": "bottle", "cost_price": 9000, "selling_price": 15000}, headers=h)).json()
    gold = (await client.post("/api/items", json={
        "name": "Gold Leaf", "category_id": cig_cat["id"], "base_unit": "piece", "unit_size": 20,
        "stock_unit": "pack", "cost_price": 1400, "selling_price": 1700}, headers=h)).json()
    rice = (await client.post("/api/items", json={
        "name": "Samba rice", "category_id": rice_cat["id"], "base_unit": "g", "unit_size": 1000,
        "stock_unit": "kg", "cost_price": 280}, headers=h)).json()

    await client.post(f"/api/items/{whisky['id']}/opening", json={"qty": 7500, "cost_per_unit": 9000}, headers=h)
    await client.post(f"/api/items/{gold['id']}/opening", json={"qty": 200, "cost_per_unit": 1400}, headers=h)

    single = (await client.post(f"/api/items/{gold['id']}/options",
                                json={"name": "Single", "deduct_qty": 1, "price": 90}, headers=h)).json()
    table = (await client.post("/api/tables", json={"name": "T1", "area": "Indoor", "seats": 4}, headers=h)).json()

    settings = (await client.get("/api/settings", headers=h)).json()
    settings.update(service_charge_percent=10, tax_percent=0)
    await client.put("/api/settings", json=settings, headers=h)
    return {"whisky": whisky, "gold": gold, "single": single, "rice": rice, "table": table}


async def new_order(client, h, **body):
    r = await client.post("/api/orders", json=body or {"type": "bar"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def add(client, h, order_id, item_id, qty=1, option_id=None, note=""):
    r = await client.post(f"/api/orders/{order_id}/lines",
                          json={"item_id": item_id, "qty": qty, "option_id": option_id, "note": note}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def on_hand(client, h, item_id):
    return (await client.get(f"/api/items/{item_id}", headers=h)).json()["on_hand_display"]


async def manager_with_pin(client, owner, username="mgr", pin="7777"):
    user = await make_user(client, owner, username, "manager", pin=pin)
    return user


# ---- Menu and tables ------------------------------------------------------------------

async def test_menu_lists_sellable_items_and_options(client, owner, shop):
    menu = (await client.get("/api/pos/menu", headers=owner)).json()
    names = {i["name"]: i for i in menu["items"]}
    assert "Samba rice" not in names  # no selling price: an ingredient
    assert [o["name"] for o in names["Gold Leaf"]["options"]] == ["1 pack", "Single"]
    assert names["Black Label 750ml"]["on_hand_display"] == "10 bottles"
    assert [c["name"] for c in menu["categories"]] == ["Whisky", "Cigarettes"]


async def test_table_shows_open_bill(client, owner, shop):
    order = await new_order(client, owner, type="table", table_id=shop["table"]["id"])
    await add(client, owner, order["id"], shop["whisky"]["id"])
    tables = (await client.get("/api/tables", headers=owner)).json()
    assert tables[0]["open_orders"][0]["id"] == order["id"]
    assert tables[0]["open_orders"][0]["total"] == 16500  # 15000 + 10% service
    r = await client.delete(f"/api/tables/{shop['table']['id']}", headers=owner)
    assert r.status_code == 409


async def test_order_type_rules(client, owner, shop):
    assert (await client.post("/api/orders", json={"type": "table"}, headers=owner)).status_code == 400
    assert (await client.post("/api/orders", json={"type": "tab"}, headers=owner)).status_code == 400
    tab = await new_order(client, owner, type="tab", customer_name="Ravi")
    assert tab["label"] == "Tab: Ravi"
    bar = await new_order(client, owner, type="bar")
    assert bar["service_charge_percent"] == 0  # no service charge at the bar counter


# ---- Bills -----------------------------------------------------------------------------

async def test_same_item_adds_up_on_one_line(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["gold"]["id"], option_id=shop["single"]["id"])
    o = await add(client, owner, o["id"], shop["gold"]["id"], option_id=shop["single"]["id"], qty=2)
    assert len(o["lines"]) == 1 and o["lines"][0]["qty"] == 3
    assert o["lines"][0]["name"] == "Gold Leaf (Single)"
    assert o["total"] == 270


async def test_totals_with_discount_service_and_tax(client, owner, shop):
    s = (await client.get("/api/settings", headers=owner)).json()
    s["tax_percent"] = 5
    await client.put("/api/settings", json=s, headers=owner)

    o = await new_order(client, owner, type="table", table_id=shop["table"]["id"])
    await add(client, owner, o["id"], shop["whisky"]["id"], qty=2)  # 30,000
    r = await client.post(f"/api/orders/{o['id']}/discount",
                          json={"type": "percent", "value": 10, "reason": "Regular"}, headers=owner)
    o = r.json()
    # 30000 - 3000 = 27000; +10% service = 2700; tax 5% of 29700 = 1485
    assert (o["subtotal"], o["discount"], o["service_charge"], o["tax"], o["total"]) == (30000, 3000, 2700, 1485, 31185)


async def test_ingredient_without_price_cannot_be_sold(client, owner, shop):
    o = await new_order(client, owner)
    r = await client.post(f"/api/orders/{o['id']}/lines", json={"item_id": shop["rice"]["id"]}, headers=owner)
    assert r.status_code == 400


# ---- Payment and stock --------------------------------------------------------------------

async def test_paying_closes_bill_and_deducts_stock(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["whisky"]["id"], qty=2)
    await add(client, owner, o["id"], shop["gold"]["id"], option_id=shop["single"]["id"], qty=3)
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "10 bottles"  # nothing taken until paid

    r = await client.post(f"/api/orders/{o['id']}/payments",
                          json={"method": "cash", "amount": 30270, "tendered": 31000}, headers=owner)
    paid = r.json()
    assert paid["status"] == "paid" and paid["due"] == 0
    assert paid["payments"][0]["change"] == 730
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "8 bottles"
    assert await on_hand(client, owner, shop["gold"]["id"]) == "9 packs + 17 pcs"

    hist = (await client.get(f"/api/items/{shop['gold']['id']}/movements", headers=owner)).json()
    assert hist["items"][0]["type"] == "sale" and hist["items"][0]["reason"] == f"Bill #{o['id']}"

    # Closed bills can't change.
    r = await client.post(f"/api/orders/{o['id']}/lines", json={"item_id": shop["whisky"]["id"]}, headers=owner)
    assert r.status_code == 400


async def test_split_payment_card_and_cash(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["whisky"]["id"])
    r = await client.post(f"/api/orders/{o['id']}/payments", json={"method": "card", "amount": 10000}, headers=owner)
    assert r.json()["status"] == "open" and r.json()["due"] == 5000
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "10 bottles"
    r = await client.post(f"/api/orders/{o['id']}/payments", json={"method": "card", "amount": 6000}, headers=owner)
    assert r.status_code == 400  # more than due
    r = await client.post(f"/api/orders/{o['id']}/payments", json={"method": "cash", "amount": 5000}, headers=owner)
    assert r.json()["status"] == "paid"
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "9 bottles"


async def test_cost_is_recorded_for_profit(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["whisky"]["id"], qty=2)
    await client.post(f"/api/orders/{o['id']}/payments", json={"method": "cash", "amount": 30000}, headers=owner)
    bills = (await client.get("/api/orders/bills", headers=owner)).json()
    assert bills["sales_total"] == 30000 and bills["bill_count"] == 1
    assert bills["by_method"] == [{"method": "cash", "amount": 30000, "count": 1}]


async def test_fully_discounted_bill_completes(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["gold"]["id"])
    await client.post(f"/api/orders/{o['id']}/discount", json={"type": "percent", "value": 100, "reason": "Owner"},
                      headers=owner)
    r = await client.post(f"/api/orders/{o['id']}/complete", headers=owner)
    assert r.json()["status"] == "paid" and r.json()["total"] == 0
    assert await on_hand(client, owner, shop["gold"]["id"]) == "9 packs"


# ---- Manager approval ------------------------------------------------------------------------

async def test_waiter_can_fix_before_printing_but_needs_manager_after(client, owner, shop):
    await make_user(client, owner, "waiter1", "waiter")
    waiter = bearer(await login(client, "waiter1", "Password123"))
    mgr = await manager_with_pin(client, owner)

    o = await new_order(client, waiter, type="table", table_id=shop["table"]["id"])
    o = await add(client, waiter, o["id"], shop["whisky"]["id"], qty=2)
    line = o["lines"][0]["id"]
    # Before printing: free to fix.
    r = await client.patch(f"/api/orders/{o['id']}/lines/{line}", json={"qty": 1}, headers=waiter)
    assert r.status_code == 200

    await client.post(f"/api/orders/{o['id']}/print", headers=waiter)
    r = await client.post(f"/api/orders/{o['id']}/lines/{line}/remove", json={"reason": "Wrong"}, headers=waiter)
    assert r.status_code == 428  # ask for a manager

    bad = {"reason": "Wrong", "approval": {"user_id": mgr["id"], "pin": "0000"}}
    assert (await client.post(f"/api/orders/{o['id']}/lines/{line}/remove", json=bad, headers=waiter)).status_code == 401

    ok = {"reason": "Customer changed mind", "approval": {"user_id": mgr["id"], "pin": "7777"}}
    r = await client.post(f"/api/orders/{o['id']}/lines/{line}/remove", json=ok, headers=waiter)
    assert r.status_code == 200 and r.json()["lines"] == []

    log = (await client.get("/api/audit-log?entity=order&action=remove_line", headers=owner)).json()
    assert log["items"][0]["after"]["approved_by"] == "Mgr"
    assert log["items"][0]["user"]["name"] == "Waiter1"


async def test_waiter_cannot_approve_for_themself(client, owner, shop):
    waiter_user = await make_user(client, owner, "waiter2", "waiter", pin="1111")
    waiter = bearer(await login(client, "waiter2", "Password123"))
    o = await new_order(client, waiter)
    await add(client, waiter, o["id"], shop["whisky"]["id"])
    body = {"type": "amount", "value": 500, "reason": "friend",
            "approval": {"user_id": waiter_user["id"], "pin": "1111"}}
    r = await client.post(f"/api/orders/{o['id']}/discount", json=body, headers=waiter)
    assert r.status_code == 403


async def test_void_paid_bill_returns_stock(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["whisky"]["id"], qty=3)
    await client.post(f"/api/orders/{o['id']}/payments", json={"method": "cash", "amount": 45000}, headers=owner)
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "7 bottles"

    r = await client.post(f"/api/orders/{o['id']}/void", json={"reason": "Charged the wrong table"}, headers=owner)
    assert r.json()["status"] == "void"
    assert await on_hand(client, owner, shop["whisky"]["id"]) == "10 bottles"
    bills = (await client.get("/api/orders/bills", headers=owner)).json()
    assert bills["sales_total"] == 0 and bills["void_count"] == 1
    again = await client.post(f"/api/orders/{o['id']}/void", json={"reason": "again"}, headers=owner)
    assert again.status_code == 400


async def test_cannot_reduce_below_paid(client, owner, shop):
    o = await new_order(client, owner)
    o = await add(client, owner, o["id"], shop["whisky"]["id"], qty=2)
    await client.post(f"/api/orders/{o['id']}/payments", json={"method": "card", "amount": 20000}, headers=owner)
    line = o["lines"][0]["id"]
    r = await client.patch(f"/api/orders/{o['id']}/lines/{line}", json={"qty": 1}, headers=owner)
    assert r.status_code == 400


# ---- Split, merge, move ------------------------------------------------------------------------

async def test_split_moves_items_to_new_bill(client, owner, shop):
    o = await new_order(client, owner, type="table", table_id=shop["table"]["id"])
    await add(client, owner, o["id"], shop["whisky"]["id"], qty=2)
    o = await add(client, owner, o["id"], shop["gold"]["id"])
    whisky_line = next(x for x in o["lines"] if x["name"] == "Black Label 750ml")

    r = await client.post(f"/api/orders/{o['id']}/split",
                          json={"lines": [{"line_id": whisky_line["id"], "qty": 1}]}, headers=owner)
    assert r.status_code == 201
    new = r.json()
    assert new["table"]["id"] == shop["table"]["id"]
    assert [(x["name"], x["qty"]) for x in new["lines"]] == [("Black Label 750ml", 1)]
    old = (await client.get(f"/api/orders/{o['id']}", headers=owner)).json()
    assert sorted((x["name"], x["qty"]) for x in old["lines"]) == [("Black Label 750ml", 1), ("Gold Leaf", 1)]

    r = await client.post(f"/api/orders/{o['id']}/split", json={"lines": [
        {"line_id": x["id"], "qty": x["qty"]} for x in old["lines"]]}, headers=owner)
    assert r.status_code == 400  # can't move everything


async def test_merge_and_move_table(client, owner, shop):
    t2 = (await client.post("/api/tables", json={"name": "T2"}, headers=owner)).json()
    a = await new_order(client, owner, type="table", table_id=shop["table"]["id"])
    b = await new_order(client, owner, type="tab", customer_name="Nimal")
    await add(client, owner, a["id"], shop["whisky"]["id"])
    await add(client, owner, b["id"], shop["gold"]["id"], qty=2)

    merged = (await client.post(f"/api/orders/{a['id']}/merge", json={"from_order_id": b["id"]}, headers=owner)).json()
    assert merged["subtotal"] == 18400
    gone = (await client.get(f"/api/orders/{b['id']}", headers=owner)).json()
    assert gone["status"] == "merged" and gone["merged_into"] == a["id"]

    moved = (await client.patch(f"/api/orders/{a['id']}", json={"table_id": t2["id"]}, headers=owner)).json()
    assert moved["label"] == "T2"


async def test_empty_bill_can_be_deleted_but_not_one_with_items(client, owner, shop):
    o = await new_order(client, owner)
    assert (await client.delete(f"/api/orders/{o['id']}", headers=owner)).status_code == 204
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["gold"]["id"])
    assert (await client.delete(f"/api/orders/{o['id']}", headers=owner)).status_code == 400


async def test_turning_off_service_charge_needs_approval(client, owner, shop):
    await make_user(client, owner, "waiter3", "waiter")
    waiter = bearer(await login(client, "waiter3", "Password123"))
    o = await new_order(client, waiter, type="table", table_id=shop["table"]["id"])
    r = await client.patch(f"/api/orders/{o['id']}", json={"service_charge_on": False}, headers=waiter)
    assert r.status_code == 428
    r = await client.patch(f"/api/orders/{o['id']}", json={"service_charge_on": False}, headers=owner)
    assert r.json()["service_charge_percent"] == 0


async def test_kitchen_cannot_take_orders(client, owner, shop):
    await make_user(client, owner, "cook", "kitchen")
    cook = bearer(await login(client, "cook", "Password123"))
    assert (await client.post("/api/orders", json={"type": "bar"}, headers=cook)).status_code == 403
    assert (await client.get("/api/pos/menu", headers=cook)).status_code == 403


async def test_reprint_is_audited(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["gold"]["id"])
    await client.post(f"/api/orders/{o['id']}/print", headers=owner)
    r = await client.post(f"/api/orders/{o['id']}/print", headers=owner)
    assert r.json()["printed_count"] == 2
    log = (await client.get("/api/audit-log?action=reprint", headers=owner)).json()
    assert log["total"] == 1


async def test_first_receipt_after_printed_bill_is_not_a_copy(client, owner, shop):
    o = await new_order(client, owner)
    await add(client, owner, o["id"], shop["gold"]["id"])
    await client.post(f"/api/orders/{o['id']}/print", headers=owner)  # bill
    await client.post(f"/api/orders/{o['id']}/payments", json={"method": "cash", "amount": 1700}, headers=owner)
    r = (await client.post(f"/api/orders/{o['id']}/print", headers=owner)).json()  # receipt
    assert (r["printed_count"], r["receipt_count"]) == (1, 1)
    r = (await client.post(f"/api/orders/{o['id']}/print", headers=owner)).json()
    assert r["receipt_count"] == 2  # this one is a copy
