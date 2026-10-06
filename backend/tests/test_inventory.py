"""Phase 2: categories, items, suppliers, purchases and the stock ledger."""

import pytest

from tests.conftest import bearer, login, make_user


async def category(client, h, name="Whisky", module="bar"):
    r = await client.post("/api/categories", json={"name": name, "module": module}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def supplier(client, h, name="Lanka Distributors"):
    r = await client.post("/api/suppliers", json={"name": name, "phone": "0771234567"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def item(client, h, cat_id, **over):
    body = {
        "name": "Johnnie Walker Black 750ml",
        "category_id": cat_id,
        "base_unit": "ml",
        "unit_size": 750,
        "stock_unit": "bottle",
        "cost_price": 9000,
        "selling_price": 15000,
        "reorder_level": 2,
    }
    body.update(over)
    r = await client.post("/api/items", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def purchase(client, h, sup_id, lines, paid=0, invoice="INV-1"):
    r = await client.post(
        "/api/purchases",
        json={"supplier_id": sup_id, "invoice_no": invoice, "invoice_date": "2026-10-06",
              "amount_paid": paid, "lines": lines},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def get_item(client, h, item_id):
    return (await client.get(f"/api/items/{item_id}", headers=h)).json()


# ---- Catalogue -----------------------------------------------------------------

async def test_catalogue_starts_empty(client, owner):
    assert (await client.get("/api/categories", headers=owner)).json() == []
    assert (await client.get("/api/items", headers=owner)).json() == []
    assert (await client.get("/api/suppliers", headers=owner)).json() == []


async def test_category_crud_and_duplicate_names(client, owner):
    cat = await category(client, owner)
    dup = await client.post("/api/categories", json={"name": "WHISKY", "module": "bar"}, headers=owner)
    assert dup.status_code == 409
    # Same name in another module is fine.
    await category(client, owner, "Whisky", "other")

    r = await client.patch(f"/api/categories/{cat['id']}", json={"name": "Scotch", "module": "bar"}, headers=owner)
    assert r.json()["name"] == "Scotch"
    assert (await client.delete(f"/api/categories/{cat['id']}", headers=owner)).status_code == 204
    names = [c["name"] for c in (await client.get("/api/categories", headers=owner)).json()]
    assert "Scotch" not in names


async def test_category_with_items_cannot_be_deleted(client, owner):
    cat = await category(client, owner)
    await item(client, owner, cat["id"])
    r = await client.delete(f"/api/categories/{cat['id']}", headers=owner)
    assert r.status_code == 409
    assert "1 item" in r.json()["detail"]
    cats = (await client.get("/api/categories", headers=owner)).json()
    assert cats[0]["item_count"] == 1


async def test_item_validation(client, owner):
    cat = await category(client, owner)
    await item(client, owner, cat["id"])
    r = await client.post("/api/items", json={
        "name": "johnnie walker black 750ml", "category_id": cat["id"], "base_unit": "ml",
        "unit_size": 750, "stock_unit": "bottle"}, headers=owner)
    assert r.status_code == 409
    r = await client.post("/api/items", json={
        "name": "Bad", "category_id": cat["id"], "base_unit": "litres", "unit_size": 1, "stock_unit": "x"},
        headers=owner)
    assert r.status_code == 422
    r = await client.post("/api/items", json={
        "name": "Half packs", "category_id": cat["id"], "base_unit": "piece", "unit_size": 2.5,
        "stock_unit": "pack"}, headers=owner)
    assert r.status_code == 400


async def test_new_item_has_no_stock(client, owner):
    cat = await category(client, owner)
    it = await item(client, owner, cat["id"])
    assert it["on_hand"] == 0
    assert it["on_hand_display"] == "0 bottles"
    assert it["is_low"] is True  # below reorder level of 2 bottles


async def test_delete_and_restore_item(client, owner):
    cat = await category(client, owner)
    it = await item(client, owner, cat["id"])
    assert (await client.delete(f"/api/items/{it['id']}", headers=owner)).status_code == 204
    assert (await client.get("/api/items", headers=owner)).json() == []
    everything = (await client.get("/api/items?include_inactive=true", headers=owner)).json()
    assert everything[0]["is_active"] is False
    r = await client.post(f"/api/items/{it['id']}/restore", headers=owner)
    assert r.json()["is_active"] is True


# ---- Purchases and the ledger ---------------------------------------------------

async def test_purchase_adds_stock_and_sets_average_cost(client, owner):
    cat = await category(client, owner)
    sup = await supplier(client, owner)
    it = await item(client, owner, cat["id"])

    await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 10, "unit_cost": 9000}])
    got = await get_item(client, owner, it["id"])
    assert got["on_hand"] == 7500  # 10 bottles x 750 ml
    assert got["on_hand_display"] == "10 bottles"
    assert got["stock_value"] == 90000
    assert got["is_low"] is False

    # 10 more at a higher price: average becomes (10x9000 + 10x10000)/20 = 9500 per bottle.
    await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 10, "unit_cost": 10000}], invoice="INV-2")
    got = await get_item(client, owner, it["id"])
    assert got["on_hand_display"] == "20 bottles"
    assert round(got["avg_cost"] * 750, 2) == 9500
    assert got["cost_price"] == 10000  # last purchase price
    assert got["stock_value"] == 190000


async def test_purchase_total_and_supplier_balance(client, owner):
    cat = await category(client, owner, "Soft drinks", "sundry")
    sup = await supplier(client, owner)
    coke = await item(client, owner, cat["id"], name="Coca-Cola 400ml", base_unit="piece", unit_size=1,
                      stock_unit="bottle", cost_price=120, selling_price=200)
    p = await purchase(client, owner, sup["id"], [{"item_id": coke["id"], "qty": 24, "unit_cost": 120.5}], paid=1000)
    assert p["total"] == 2892
    sups = (await client.get("/api/suppliers", headers=owner)).json()
    assert sups[0]["balance_due"] == 1892

    r = await client.post(f"/api/purchases/{p['id']}/payment", json={"amount_paid": 2892}, headers=owner)
    assert r.status_code == 200
    assert (await client.get("/api/suppliers", headers=owner)).json()[0]["balance_due"] == 0

    r = await client.post(f"/api/purchases/{p['id']}/payment", json={"amount_paid": 5000}, headers=owner)
    assert r.status_code == 400


async def test_overpaying_a_new_purchase_is_rejected(client, owner):
    cat = await category(client, owner)
    sup = await supplier(client, owner)
    it = await item(client, owner, cat["id"])
    r = await client.post("/api/purchases", json={
        "supplier_id": sup["id"], "invoice_date": "2026-10-06", "amount_paid": 999999,
        "lines": [{"item_id": it["id"], "qty": 1, "unit_cost": 100}]}, headers=owner)
    assert r.status_code == 400


async def test_cancel_purchase_reverses_stock(client, owner):
    cat = await category(client, owner)
    sup = await supplier(client, owner)
    it = await item(client, owner, cat["id"])
    await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 10, "unit_cost": 9000}])
    p2 = await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 5, "unit_cost": 12000}], invoice="X")

    r = await client.post(f"/api/purchases/{p2['id']}/cancel", json={"reason": "Wrong invoice"}, headers=owner)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    got = await get_item(client, owner, it["id"])
    assert got["on_hand_display"] == "10 bottles"
    assert round(got["avg_cost"] * 750, 2) == 9000  # back to the original average

    again = await client.post(f"/api/purchases/{p2['id']}/cancel", json={"reason": "again"}, headers=owner)
    assert again.status_code == 400
    # Cancelled purchases don't count towards what you owe.
    assert (await client.get("/api/suppliers", headers=owner)).json()[0]["balance_due"] == 90000


async def test_paid_purchase_cannot_be_cancelled(client, owner):
    cat = await category(client, owner)
    sup = await supplier(client, owner)
    it = await item(client, owner, cat["id"])
    p = await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 1, "unit_cost": 100}], paid=50)
    r = await client.post(f"/api/purchases/{p['id']}/cancel", json={"reason": "mistake"}, headers=owner)
    assert r.status_code == 400


async def test_untracked_item_is_costed_but_not_stocked(client, owner):
    cat = await category(client, owner, "Spices", "food")
    sup = await supplier(client, owner)
    salt = await item(client, owner, cat["id"], name="Salt", base_unit="g", unit_size=1000, stock_unit="kg",
                      cost_price=150, selling_price=None, reorder_level=0, track_stock=False)
    await purchase(client, owner, sup["id"], [{"item_id": salt["id"], "qty": 2, "unit_cost": 160}])
    got = await get_item(client, owner, salt["id"])
    assert got["on_hand"] == 0 and got["on_hand_display"] == "Not tracked"
    assert got["cost_price"] == 160
    r = await client.post(f"/api/items/{salt['id']}/wastage", json={"qty": 10, "reason": "spilled"}, headers=owner)
    assert r.status_code == 400


# ---- Opening stock, wastage, counts ------------------------------------------------

async def test_opening_stock_only_once(client, owner):
    cat = await category(client, owner, "Cigarettes", "sundry")
    gl = await item(client, owner, cat["id"], name="Gold Leaf", base_unit="piece", unit_size=20, stock_unit="pack",
                    cost_price=1400, selling_price=1700, reorder_level=5)
    r = await client.post(f"/api/items/{gl['id']}/opening", json={"qty": 67, "cost_per_unit": 1400}, headers=owner)
    assert r.status_code == 200
    assert r.json()["on_hand"] == 67
    assert r.json()["on_hand_display"] == "3 packs + 7 pcs"
    r = await client.post(f"/api/items/{gl['id']}/opening", json={"qty": 20, "cost_per_unit": 1400}, headers=owner)
    assert r.status_code == 409


async def test_unit_is_locked_after_stock_is_recorded(client, owner):
    cat = await category(client, owner)
    it = await item(client, owner, cat["id"])
    body = {"name": it["name"], "category_id": cat["id"], "base_unit": "ml", "unit_size": 1000,
            "stock_unit": "bottle", "reorder_level": 2}
    # Before any stock: changing the size is fine.
    assert (await client.put(f"/api/items/{it['id']}", json=body, headers=owner)).status_code == 200
    await client.post(f"/api/items/{it['id']}/opening", json={"qty": 2000, "cost_per_unit": 9000}, headers=owner)
    body["unit_size"] = 750
    r = await client.put(f"/api/items/{it['id']}", json=body, headers=owner)
    assert r.status_code == 400
    # Other fields still editable.
    body["unit_size"] = 1000
    body["selling_price"] = 16000
    assert (await client.put(f"/api/items/{it['id']}", json=body, headers=owner)).status_code == 200


async def test_wastage_and_count(client, owner):
    cat = await category(client, owner, "Rice", "food")
    rice = await item(client, owner, cat["id"], name="Samba rice", base_unit="g", unit_size=1000, stock_unit="kg",
                      cost_price=280, selling_price=None, reorder_level=5)
    await client.post(f"/api/items/{rice['id']}/opening", json={"qty": 25000, "cost_per_unit": 280}, headers=owner)

    r = await client.post(f"/api/items/{rice['id']}/wastage", json={"qty": 750, "reason": "Got wet"}, headers=owner)
    assert r.json()["on_hand_display"] == "24.25 kg"

    r = await client.post(f"/api/items/{rice['id']}/count", json={"counted": 24000, "reason": "Weekly count"},
                          headers=owner)
    assert r.json()["on_hand"] == 24000

    page = (await client.get(f"/api/items/{rice['id']}/movements", headers=owner)).json()
    assert [m["type"] for m in page["items"]] == ["count_adjust", "wastage", "opening"]
    assert [m["balance_after"] for m in page["items"]] == [24000, 24250, 25000]
    assert page["items"][0]["qty_display"] == "-0.25 kg"
    assert page["items"][0]["user"]["name"] == "Owner"

    # Counting the same amount again records nothing.
    await client.post(f"/api/items/{rice['id']}/count", json={"counted": 24000}, headers=owner)
    assert (await client.get(f"/api/items/{rice['id']}/movements", headers=owner)).json()["total"] == 3


async def test_low_stock_filter(client, owner):
    cat = await category(client, owner)
    low = await item(client, owner, cat["id"], name="Low one")
    ok = await item(client, owner, cat["id"], name="Plenty")
    await client.post(f"/api/items/{ok['id']}/opening", json={"qty": 7500, "cost_per_unit": 100}, headers=owner)
    names = [i["name"] for i in (await client.get("/api/items?low_only=true", headers=owner)).json()]
    assert names == ["Low one"]
    assert low["id"] != ok["id"]


# ---- Permissions -------------------------------------------------------------------

async def test_bartender_can_view_and_count_but_not_edit(client, owner):
    cat = await category(client, owner)
    it = await item(client, owner, cat["id"])
    await make_user(client, owner, "barman", "bartender")
    bar = bearer(await login(client, "barman", "Password123"))

    assert (await client.get("/api/items", headers=bar)).status_code == 200
    assert (await client.post(f"/api/items/{it['id']}/count", json={"counted": 750}, headers=bar)).status_code == 200
    assert (await client.post(f"/api/items/{it['id']}/wastage", json={"qty": 30, "reason": "spill"},
                              headers=bar)).status_code == 200
    assert (await client.delete(f"/api/items/{it['id']}", headers=bar)).status_code == 403
    assert (await client.post("/api/categories", json={"name": "x", "module": "bar"}, headers=bar)).status_code == 403
    assert (await client.get("/api/purchases", headers=bar)).status_code == 403


async def test_waiter_cannot_see_stock(client, owner):
    await make_user(client, owner, "waiter1", "waiter")
    waiter = bearer(await login(client, "waiter1", "Password123"))
    assert (await client.get("/api/items", headers=waiter)).status_code == 403


async def test_everything_is_audited(client, owner):
    cat = await category(client, owner)
    sup = await supplier(client, owner)
    it = await item(client, owner, cat["id"])
    await purchase(client, owner, sup["id"], [{"item_id": it["id"], "qty": 1, "unit_cost": 9000}])
    entities = {e["entity"] for e in (await client.get("/api/audit-log?page_size=100", headers=owner)).json()["items"]}
    assert {"category", "supplier", "item", "purchase"} <= entities


@pytest.mark.parametrize(
    "base_unit,size,unit,qty,expected",
    [
        ("ml", 750, "bottle", 9300, "12 bottles + 300 ml"),
        ("ml", 750, "bottle", 300, "300 ml"),
        ("ml", 1000, "litre", 2500, "2.5 litres"),
        ("g", 1000, "kg", 8250, "8.25 kg"),
        ("piece", 20, "pack", 47, "2 packs + 7 pcs"),
        ("piece", 1, "bottle", 1, "1 bottle"),
        ("piece", 1, "piece", 30, "30 pieces"),
        ("piece", 1, "box", 2, "2 boxes"),
        ("ml", 750, "bottle", -750, "-1 bottle"),
    ],
)
def test_format_qty(base_unit, size, unit, qty, expected):
    from decimal import Decimal

    from app.models import Item
    from app.services.stock import format_qty

    it = Item(base_unit=base_unit, unit_size=Decimal(size), stock_unit=unit)
    assert format_qty(it, Decimal(qty)) == expected
