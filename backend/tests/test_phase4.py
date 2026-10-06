"""Phase 4: dishes with recipes, batch items, pegs from open bottles, kitchen."""

import pytest

from tests.conftest import bearer, login, make_user


async def post(client, h, path, body=None, code=(200, 201)):
    r = await client.post(path, json=body or {}, headers=h)
    assert r.status_code in code, (path, r.status_code, r.text)
    return r.json()


async def put(client, h, path, body, code=(200,)):
    r = await client.put(path, json=body, headers=h)
    assert r.status_code in code, (path, r.status_code, r.text)
    return r.json()


async def get(client, h, path):
    r = await client.get(path, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def item(client, h, cat, name, base, size, unit, cost, sell=None, track=True, kind="final_product"):
    return await post(client, h, "/api/items", {
        "name": name, "category_id": cat, "base_unit": base, "unit_size": size, "stock_unit": unit,
        "cost_price": cost, "selling_price": sell, "track_stock": track, "kind": kind})


async def stock_of(client, h, item_id):
    return (await get(client, h, f"/api/items/{item_id}"))["on_hand_display"]


async def sell(client, h, item_id, qty=1, option_id=None, pay=True):
    o = await post(client, h, "/api/orders", {"type": "bar"})
    o = await post(client, h, f"/api/orders/{o['id']}/lines", {"item_id": item_id, "qty": qty, "option_id": option_id})
    if pay:
        o = await post(client, h, f"/api/orders/{o['id']}/payments", {"method": "cash", "amount": o["due"]})
    return o


@pytest.fixture
async def kitchen(client, owner):
    h = owner
    food = (await post(client, h, "/api/categories", {"name": "Rice dishes", "module": "food"}))["id"]
    raw = (await post(client, h, "/api/categories", {"name": "Raw", "module": "food"}))["id"]
    rice = await item(client, h, raw, "Rice", "g", 1000, "kg", 280)
    chicken = await item(client, h, raw, "Chicken", "g", 1000, "kg", 1500)
    salt = await item(client, h, raw, "Salt", "g", 1000, "kg", 100, track=False)
    await post(client, h, f"/api/items/{rice['id']}/opening", {"qty": 10000, "cost_per_unit": 280})
    await post(client, h, f"/api/items/{chicken['id']}/opening", {"qty": 2000, "cost_per_unit": 1500})
    dish = await item(client, h, food, "Chicken Fried Rice", "piece", 1, "plate", 0, sell=1500, kind="build_assembly")
    return {"food": food, "raw": raw, "rice": rice, "chicken": chicken, "salt": salt, "dish": dish}


# ---- Dishes and recipes ------------------------------------------------------------

async def test_dish_is_made_to_order(client, owner, kitchen):
    d = kitchen["dish"]
    assert d["kind"] == "build_assembly" and d["track_stock"] is False
    assert d["on_hand_display"] == "Made to order"


async def test_recipe_cost_and_margin(client, owner, kitchen):
    k = kitchen
    s = await get(client, owner, "/api/settings")
    s["overhead_percent"] = 10
    await put(client, owner, "/api/settings", s)
    r = await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [
        {"component_id": k["rice"]["id"], "qty": 250},     # 250 g x 0.28 = 70
        {"component_id": k["chicken"]["id"], "qty": 75},   # 75 g x 1.5 = 112.5
        {"component_id": k["salt"]["id"], "qty": 2},       # 2 g x 0.1 = 0.2 (not tracked)
    ]})
    assert [line["qty_display"] for line in r["lines"]] == ["0.25 kg", "0.075 kg", "0.002 kg"]
    assert r["ingredient_cost"] == 182.7
    assert r["total_cost"] == 200.97  # + 10% overhead
    assert r["margin"] == 1299.03
    assert r["portions_available"] == 26  # chicken: 2000 g / 75 g


async def test_selling_a_dish_takes_its_ingredients(client, owner, kitchen):
    k = kitchen
    await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [
        {"component_id": k["rice"]["id"], "qty": 250}, {"component_id": k["chicken"]["id"], "qty": 75},
        {"component_id": k["salt"]["id"], "qty": 2}]})
    await sell(client, owner, k["dish"]["id"], qty=2)
    assert await stock_of(client, owner, k["rice"]["id"]) == "9.5 kg"
    assert await stock_of(client, owner, k["chicken"]["id"]) == "1.85 kg"
    bills = await get(client, owner, "/api/orders/bills")
    assert bills["sales_total"] == 3000


async def test_void_dish_puts_ingredients_back(client, owner, kitchen):
    k = kitchen
    await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [
        {"component_id": k["chicken"]["id"], "qty": 100}]})
    o = await sell(client, owner, k["dish"]["id"], qty=3)
    assert await stock_of(client, owner, k["chicken"]["id"]) == "1.7 kg"
    await post(client, owner, f"/api/orders/{o['id']}/void", {"reason": "Wrong order"})
    assert await stock_of(client, owner, k["chicken"]["id"]) == "2 kg"


async def test_recipe_rules(client, owner, kitchen):
    k = kitchen
    path = f"/api/items/{k['dish']['id']}/recipe"
    other = await item(client, owner, k["food"], "Egg Rice", "piece", 1, "plate", 0, sell=900, kind="build_assembly")
    bad = [
        {"lines": [{"component_id": k["dish"]["id"], "qty": 1}]},                         # itself
        {"lines": [{"component_id": other["id"], "qty": 1}]},                             # another dish
        {"lines": [{"component_id": k["rice"]["id"], "qty": 1}, {"component_id": k["rice"]["id"], "qty": 2}]},
    ]
    for body in bad:
        assert (await client.put(path, json=body, headers=owner)).status_code == 400


async def test_ingredient_in_use_cannot_be_deleted(client, owner, kitchen):
    k = kitchen
    await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [{"component_id": k["rice"]["id"], "qty": 200}]})
    r = await client.delete(f"/api/items/{k['rice']['id']}", headers=owner)
    assert r.status_code == 409 and "Chicken Fried Rice" in r.json()["detail"]


async def test_dish_out_of_stock_on_menu(client, owner, kitchen):
    k = kitchen
    await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [{"component_id": k["chicken"]["id"], "qty": 2500}]})
    menu = await get(client, owner, "/api/pos/menu")
    dish = next(i for i in menu["items"] if i["id"] == k["dish"]["id"])
    assert dish["out_of_stock"] is True


# ---- Batch items ----------------------------------------------------------------------

async def test_spice_mix_batch(client, owner, kitchen):
    k = kitchen
    chilli = await item(client, owner, k["raw"], "Chilli powder", "g", 1000, "kg", 2000)
    turmeric = await item(client, owner, k["raw"], "Turmeric", "g", 1000, "kg", 3000)
    await post(client, owner, f"/api/items/{chilli['id']}/opening", {"qty": 2000, "cost_per_unit": 2000})
    await post(client, owner, f"/api/items/{turmeric['id']}/opening", {"qty": 1000, "cost_per_unit": 3000})
    mix = await item(client, owner, k["raw"], "Spice Mix", "g", 1000, "kg", 0)

    # One batch: 600 g chilli + 400 g turmeric makes 1 kg of mix.
    r = await client.put(f"/api/items/{mix['id']}/recipe", json={"lines": [
        {"component_id": chilli["id"], "qty": 600}]}, headers=owner)
    assert r.status_code == 400  # needs the batch size
    await put(client, owner, f"/api/items/{mix['id']}/recipe", {"batch_yield": 1000, "lines": [
        {"component_id": chilli["id"], "qty": 600}, {"component_id": turmeric["id"], "qty": 400}]})

    await post(client, owner, f"/api/items/{mix['id']}/produce", {"batches": 2})
    assert await stock_of(client, owner, mix["id"]) == "2 kg"
    assert await stock_of(client, owner, chilli["id"]) == "0.8 kg"
    assert await stock_of(client, owner, turmeric["id"]) == "0.2 kg"
    got = await get(client, owner, f"/api/items/{mix['id']}")
    assert round(got["avg_cost"] * 1000, 2) == 2400  # (600x2 + 400x3) per kg

    # A dish then uses one clean "Spice Mix" line.
    await put(client, owner, f"/api/items/{k['dish']['id']}/recipe", {"lines": [{"component_id": mix["id"], "qty": 5}]})
    await sell(client, owner, k["dish"]["id"], qty=4)
    assert await stock_of(client, owner, mix["id"]) == "1.98 kg"


# ---- Pegs and open bottles ----------------------------------------------------------------

@pytest.fixture
async def arrack(client, owner):
    cat = (await post(client, owner, "/api/categories", {"name": "Arrack", "module": "bar"}))["id"]
    a = await item(client, owner, cat, "Rockland 750ml", "ml", 750, "bottle", 3000, sell=4500)
    await post(client, owner, f"/api/items/{a['id']}/opening", {"qty": 1500, "cost_per_unit": 3000})  # 2 bottles
    peg = await post(client, owner, f"/api/items/{a['id']}/options", {"name": "60 ml peg", "deduct_qty": 60, "price": 450})
    return {"item": a, "peg": peg}


async def bottles_of(client, h, item_id):
    return next(b for b in await get(client, h, "/api/open-bottles") if b["item_id"] == item_id)


async def test_peg_opens_a_bottle_automatically(client, owner, arrack):
    a = arrack["item"]
    b = await bottles_of(client, owner, a["id"])
    assert b["sealed"] == 2 and b["open"] == []

    await sell(client, owner, a["id"], qty=3, option_id=arrack["peg"]["id"])
    b = await bottles_of(client, owner, a["id"])
    assert b["sealed"] == 1
    assert [x["remaining_ml"] for x in b["open"]] == [570]
    assert await stock_of(client, owner, a["id"]) == "1 bottle + 570 ml"


async def test_pegs_roll_over_to_the_next_bottle(client, owner, arrack):
    a = arrack["item"]
    await sell(client, owner, a["id"], qty=12, option_id=arrack["peg"]["id"])  # 720 ml: 30 ml left
    await sell(client, owner, a["id"], qty=1, option_id=arrack["peg"]["id"])   # 30 from it + 30 from a new one
    b = await bottles_of(client, owner, a["id"])
    assert b["sealed"] == 0
    assert [x["remaining_ml"] for x in b["open"]] == [720]  # first finished, second opened


async def test_finish_bottle_records_unaccounted_ml(client, owner, arrack):
    a = arrack["item"]
    await sell(client, owner, a["id"], qty=11, option_id=arrack["peg"]["id"])  # 660 ml, 90 left on record
    b = await bottles_of(client, owner, a["id"])
    bottle_id = b["open"][0]["id"]
    b = await post(client, owner, f"/api/open-bottles/{bottle_id}/finish", {"reason": "Bottle is empty"})
    assert b["open"] == [] and b["sealed"] == 1
    assert await stock_of(client, owner, a["id"]) == "1 bottle"
    hist = await get(client, owner, f"/api/items/{a['id']}/movements")
    assert hist["items"][0]["type"] == "wastage" and "90 ml unaccounted" in hist["items"][0]["reason"]


async def test_open_bottle_by_hand_needs_sealed_stock(client, owner, arrack):
    a = arrack["item"]
    await post(client, owner, f"/api/items/{a['id']}/bottles/open")
    await post(client, owner, f"/api/items/{a['id']}/bottles/open")
    r = await client.post(f"/api/items/{a['id']}/bottles/open", headers=owner)
    assert r.status_code == 400


async def test_void_peg_pours_back(client, owner, arrack):
    a = arrack["item"]
    o = await sell(client, owner, a["id"], qty=2, option_id=arrack["peg"]["id"])
    await post(client, owner, f"/api/orders/{o['id']}/void", {"reason": "Spilled on customer, redone"})
    b = await bottles_of(client, owner, a["id"])
    assert [x["remaining_ml"] for x in b["open"]] == [750]
    assert await stock_of(client, owner, a["id"]) == "2 bottles"


async def test_full_bottle_sale_does_not_touch_open_bottles(client, owner, arrack):
    a = arrack["item"]
    await sell(client, owner, a["id"], qty=1, option_id=arrack["peg"]["id"])
    await sell(client, owner, a["id"], qty=1)  # whole bottle
    b = await bottles_of(client, owner, a["id"])
    assert [x["remaining_ml"] for x in b["open"]] == [690] and b["sealed"] == 0


# ---- Kitchen -----------------------------------------------------------------------------

async def test_food_goes_to_the_kitchen_and_drinks_do_not(client, owner, kitchen, arrack):
    o = await post(client, owner, "/api/orders", {"type": "bar"})
    await post(client, owner, f"/api/orders/{o['id']}/lines", {"item_id": kitchen["dish"]["id"], "qty": 2, "note": "No chilli"})
    o = await post(client, owner, f"/api/orders/{o['id']}/lines", {"item_id": arrack["item"]["id"]})
    statuses = {line["name"]: line["kitchen_status"] for line in o["lines"]}
    assert statuses == {"Chicken Fried Rice": "new", "Rockland 750ml": None}

    tickets = await get(client, owner, "/api/kitchen/tickets")
    assert len(tickets) == 1 and tickets[0]["lines"][0]["note"] == "No chilli"
    line_id = tickets[0]["lines"][0]["id"]
    for step in ("preparing", "ready", "served"):
        r = await post(client, owner, f"/api/kitchen/lines/{line_id}/status", {"status": step})
        assert r["kitchen_status"] == step
    assert await get(client, owner, "/api/kitchen/tickets") == []


async def test_second_portion_after_cooking_is_a_new_ticket_line(client, owner, kitchen):
    o = await post(client, owner, "/api/orders", {"type": "bar"})
    o = await post(client, owner, f"/api/orders/{o['id']}/lines", {"item_id": kitchen["dish"]["id"]})
    await post(client, owner, f"/api/kitchen/lines/{o['lines'][0]['id']}/status", {"status": "preparing"})
    o = await post(client, owner, f"/api/orders/{o['id']}/lines", {"item_id": kitchen["dish"]["id"]})
    assert [(x["qty"], x["kitchen_status"]) for x in o["lines"]] == [(1, "preparing"), (1, "new")]


async def test_removing_cooked_food_needs_a_manager(client, owner, kitchen):
    await make_user(client, owner, "waiter9", "waiter")
    waiter = bearer(await login(client, "waiter9", "Password123"))
    o = await post(client, waiter, "/api/orders", {"type": "bar"})
    o = await post(client, waiter, f"/api/orders/{o['id']}/lines", {"item_id": kitchen["dish"]["id"]})
    line = o["lines"][0]["id"]
    await post(client, waiter, f"/api/kitchen/lines/{line}/status", {"status": "preparing"})
    r = await client.post(f"/api/orders/{o['id']}/lines/{line}/remove", json={"reason": "x"}, headers=waiter)
    assert r.status_code == 428


async def test_cook_can_use_kitchen_but_not_bills(client, owner, kitchen):
    await make_user(client, owner, "cook2", "kitchen")
    cook = bearer(await login(client, "cook2", "Password123"))
    assert (await client.get("/api/kitchen/tickets", headers=cook)).status_code == 200
    assert (await client.post("/api/orders", json={"type": "bar"}, headers=cook)).status_code == 403
