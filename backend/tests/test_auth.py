from tests.conftest import bearer, login, make_user


async def test_health(client):
    r = await client.get("/api/health")
    assert r.json() == {"status": "ok"}


async def test_owner_login_returns_all_permissions(client):
    tokens = await login(client, "owner", "OwnerPass123")
    assert tokens["user"]["role"]["name"] == "owner"
    assert "users.manage" in tokens["permissions"]
    me = await client.get("/api/auth/me", headers=bearer(tokens))
    assert me.status_code == 200
    assert me.json()["user"]["username"] == "owner"


async def test_wrong_password_and_unknown_user_give_same_error(client):
    a = await client.post("/api/auth/login", json={"username": "owner", "password": "nope"})
    b = await client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


async def test_username_is_case_insensitive(client):
    r = await client.post("/api/auth/login", json={"username": "OWNER", "password": "OwnerPass123"})
    assert r.status_code == 200


async def test_requests_without_token_are_rejected(client):
    assert (await client.get("/api/auth/me")).status_code == 401
    bad = {"Authorization": "Bearer not-a-token"}
    assert (await client.get("/api/auth/me", headers=bad)).status_code == 401


async def test_refresh_token_cannot_be_used_as_access_token(client):
    tokens = await login(client, "owner", "OwnerPass123")
    headers = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    assert (await client.get("/api/auth/me", headers=headers)).status_code == 401


async def test_refresh_issues_new_tokens(client):
    tokens = await login(client, "owner", "OwnerPass123")
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert (await client.get("/api/auth/me", headers=bearer(r.json()))).status_code == 200


async def test_pin_login_and_lockout(client, owner):
    staff = await make_user(client, owner, "nimal", "bartender", pin="4321")

    r = await client.post("/api/auth/pin-login", json={"user_id": staff["id"], "pin": "4321"})
    assert r.status_code == 200
    assert r.json()["user"]["role"]["name"] == "bartender"

    for _ in range(5):
        r = await client.post("/api/auth/pin-login", json={"user_id": staff["id"], "pin": "0000"})
        assert r.status_code == 401
    # Locked now, even with the right PIN.
    r = await client.post("/api/auth/pin-login", json={"user_id": staff["id"], "pin": "4321"})
    assert r.status_code == 423
    # Password login still works while the PIN is locked.
    await login(client, "nimal", "Password123")


async def test_pin_login_without_pin_set(client, owner):
    staff = await make_user(client, owner, "kamal", "waiter")
    r = await client.post("/api/auth/pin-login", json={"user_id": staff["id"], "pin": "1234"})
    assert r.status_code == 401


async def test_staff_list_only_shows_users_with_pin(client, owner):
    await make_user(client, owner, "withpin", "waiter", pin="1111")
    await make_user(client, owner, "nopin", "waiter")
    names = [s["name"] for s in (await client.get("/api/auth/staff", headers=owner)).json()]
    assert "Withpin" in names and "Nopin" not in names


async def test_change_password_logs_out_old_sessions(client):
    old = await login(client, "owner", "OwnerPass123")
    r = await client.post(
        "/api/auth/change-password",
        json={"current_password": "OwnerPass123", "new_password": "NewOwnerPass1"},
        headers=bearer(old),
    )
    assert r.status_code == 200
    assert (await client.get("/api/auth/me", headers=bearer(old))).status_code == 401
    assert (await client.get("/api/auth/me", headers=bearer(r.json()))).status_code == 200
    await login(client, "owner", "NewOwnerPass1")
