from tests.conftest import bearer, login, make_user, role_id


async def test_default_roles_exist(client, owner):
    names = [r["name"] for r in (await client.get("/api/roles", headers=owner)).json()]
    assert names == ["owner", "manager", "receptionist", "bartender", "waiter", "kitchen"]


async def test_owner_creates_and_edits_user(client, owner):
    user = await make_user(client, owner, "Sunil", "waiter", pin="1234")
    assert user["username"] == "sunil" and user["has_pin"]

    r = await client.patch(
        f"/api/users/{user['id']}",
        json={"name": "Sunil Perera", "role_id": await role_id(client, owner, "bartender")},
        headers=owner,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Sunil Perera"
    assert r.json()["role"]["name"] == "bartender"


async def test_duplicate_username_rejected(client, owner):
    await make_user(client, owner, "dup", "waiter")
    r = await client.post(
        "/api/users",
        json={"name": "x", "username": "DUP", "password": "Password123",
              "role_id": await role_id(client, owner, "waiter")},
        headers=owner,
    )
    assert r.status_code == 409


async def test_waiter_cannot_manage_users(client, owner):
    await make_user(client, owner, "waiter1", "waiter")
    waiter = bearer(await login(client, "waiter1", "Password123"))
    assert (await client.get("/api/users", headers=waiter)).status_code == 403
    assert (await client.put("/api/settings", json={"business_name": "x"}, headers=waiter)).status_code == 403
    assert (await client.get("/api/audit-log", headers=waiter)).status_code == 403


async def test_deactivated_user_is_logged_out(client, owner):
    user = await make_user(client, owner, "leaver", "waiter")
    session = bearer(await login(client, "leaver", "Password123"))
    assert (await client.delete(f"/api/users/{user['id']}", headers=owner)).status_code == 204
    assert (await client.get("/api/auth/me", headers=session)).status_code == 401
    r = await client.post("/api/auth/login", json={"username": "leaver", "password": "Password123"})
    assert r.status_code == 401
    # Hidden by default, shown with include_inactive.
    active = [u["username"] for u in (await client.get("/api/users", headers=owner)).json()]
    everyone = [u["username"] for u in
                (await client.get("/api/users?include_inactive=true", headers=owner)).json()]
    assert "leaver" not in active and "leaver" in everyone


async def test_cannot_remove_last_owner(client, owner):
    me = (await client.get("/api/auth/me", headers=owner)).json()["user"]
    manager_role = await role_id(client, owner, "manager")
    r = await client.patch(f"/api/users/{me['id']}", json={"role_id": manager_role}, headers=owner)
    assert r.status_code == 400
    r = await client.delete(f"/api/users/{me['id']}", headers=owner)
    assert r.status_code == 400


async def test_role_permission_change_applies_without_relogin(client, owner):
    await make_user(client, owner, "barman", "bartender")
    barman = bearer(await login(client, "barman", "Password123"))
    assert (await client.get("/api/audit-log", headers=barman)).status_code == 403

    bartender = await role_id(client, owner, "bartender")
    r = await client.put(
        f"/api/roles/{bartender}/permissions",
        json={"permissions": ["pos.order", "audit.view"]},
        headers=owner,
    )
    assert r.status_code == 200
    assert (await client.get("/api/audit-log", headers=barman)).status_code == 200


async def test_owner_role_and_unknown_permissions_are_protected(client, owner):
    owner_role = await role_id(client, owner, "owner")
    r = await client.put(f"/api/roles/{owner_role}/permissions", json={"permissions": []}, headers=owner)
    assert r.status_code == 400
    waiter = await role_id(client, owner, "waiter")
    r = await client.put(f"/api/roles/{waiter}/permissions", json={"permissions": ["fly.plane"]}, headers=owner)
    assert r.status_code == 400


async def test_settings_save_and_audit(client, owner):
    s = (await client.get("/api/settings", headers=owner)).json()
    assert s["currency"] == "LKR"
    s.update(business_name="Lake View Bar", tax_percent=2.5)
    r = await client.put("/api/settings", json=s, headers=owner)
    assert r.status_code == 200
    assert (await client.get("/api/settings", headers=owner)).json()["business_name"] == "Lake View Bar"

    log = (await client.get("/api/audit-log?entity=settings", headers=owner)).json()
    assert log["total"] == 1
    assert log["items"][0]["after"]["business_name"] == "Lake View Bar"


async def test_audit_log_never_stores_secrets(client, owner):
    user = await make_user(client, owner, "secretive", "waiter", pin="9999")
    await client.patch(f"/api/users/{user['id']}", json={"password": "Another123"}, headers=owner)
    log = (await client.get("/api/audit-log?entity=user", headers=owner)).json()
    text = str(log)
    assert "Another123" not in text and "9999" not in text
    assert "$2b$" not in text  # no bcrypt hashes either


async def test_audit_log_date_filter(client, owner):
    log = (await client.get("/api/audit-log?date_from=2000-01-01&date_to=2999-12-31", headers=owner)).json()
    assert log["total"] >= 1
    log = (await client.get("/api/audit-log?date_from=2000-01-01&date_to=2000-01-02", headers=owner)).json()
    assert log["total"] == 0
