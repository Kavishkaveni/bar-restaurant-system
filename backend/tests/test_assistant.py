"""Phase 8: the AI assistant, tested against a fake AI service that calls our tools."""

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.api import assistant as assistant_api
from app.services import assistant
from tests.conftest import bearer, login, make_user


async def call(client, h, method, path, body=None, code=(200, 201)):
    r = await client.request(method, path, json=body, headers=h)
    assert r.status_code in (code if isinstance(code, tuple) else (code,)), (path, r.status_code, r.text)
    return r.json() if r.content else None


REAL_CLIENT = httpx.AsyncClient


class FakeAI:
    """Behaves like an OpenAI-style API: asks for one tool, then answers from its result."""

    def __init__(self, tool: str, args: dict, status: int = 200):
        self.tool, self.args, self.status = tool, args, status
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": body})
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "nope"})
        last = body["messages"][-1]
        if last["role"] == "tool":
            data = json.loads(last["content"])
            return httpx.Response(200, json={"choices": [{"message": {
                "role": "assistant", "content": f"RESULT {json.dumps(data, sort_keys=True)}"}}]})
        return httpx.Response(200, json={"choices": [{"message": {
            "role": "assistant", "content": None,
            "tool_calls": [{"id": "call_1", "type": "function",
                            "function": {"name": self.tool, "arguments": json.dumps(self.args)}}]}}]})


@pytest.fixture
def fake_ai(monkeypatch):
    holder = {}

    def use(tool, args=None, status=200):
        fake = FakeAI(tool, args or {}, status)
        monkeypatch.setattr(assistant.httpx, "AsyncClient",
                            lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(fake.handler), **kw))
        holder["fake"] = fake
        return fake

    assistant_api._recent.clear()
    return use


@pytest.fixture
async def shop(client, owner):
    h = owner
    bar = (await call(client, h, "POST", "/api/categories", {"name": "Arrack", "module": "bar"}))["id"]
    arrack = await call(client, h, "POST", "/api/items", {
        "name": "Rockland Arrack 750ml", "category_id": bar, "base_unit": "ml", "unit_size": 750,
        "stock_unit": "bottle", "cost_price": 2800, "selling_price": 4500, "reorder_level": 10})
    await call(client, h, "POST", f"/api/items/{arrack['id']}/opening", {"qty": 3750, "cost_per_unit": 2800})
    o = await call(client, h, "POST", "/api/orders", {"type": "bar"})
    o = await call(client, h, "POST", f"/api/orders/{o['id']}/lines", {"item_id": arrack["id"], "qty": 2})
    await call(client, h, "POST", f"/api/orders/{o['id']}/payments", {"method": "cash", "amount": o["due"]})
    rt = await call(client, h, "POST", "/api/room-types", {"name": "Std", "nightly_rate": 8000})
    room = await call(client, h, "POST", "/api/rooms", {"number": "7", "room_type_id": rt["id"]})
    now = datetime.now(timezone.utc)
    await call(client, h, "POST", "/api/bookings", {
        "guest_name": "Secret Guest", "phone": "0771234567", "id_number": "991234567V", "room_id": room["id"],
        "arrival": now.isoformat(), "departure": (now + timedelta(days=1)).isoformat(), "check_in_now": True})
    return {"arrack": arrack}


async def configure(client, h, key="test-key-12345678"):
    return await call(client, h, "PUT", "/api/ai/config", {"provider": "gemini", "api_key": key})


async def test_config_keeps_the_key_secret(client, owner):
    cfg = await call(client, owner, "GET", "/api/ai/config")
    assert cfg["provider"] == "gemini" and not cfg["key_set"] and cfg["model"]
    cfg = await configure(client, owner)
    assert cfg["key_set"] and cfg["key_hint"] == "…5678" and "test-key" not in json.dumps(cfg)
    # Changing the model keeps the key when no new key is sent.
    cfg = await call(client, owner, "PUT", "/api/ai/config", {"provider": "groq", "model": "llama-x"})
    assert cfg["provider"] == "groq" and cfg["model"] == "llama-x" and cfg["key_set"]
    assert cfg["base_url"].startswith("https://api.groq.com")
    s = await call(client, owner, "GET", "/api/settings")
    assert not any(k.startswith("ai_") for k in s)
    await call(client, owner, "PUT", "/api/ai/config", {"provider": "custom"}, code=400)


async def test_not_set_up(client, owner):
    r = await client.post("/api/ai/ask", json={"question": "How much today?"}, headers=owner)
    assert r.status_code == 400 and "isn't set up" in r.json()["detail"]
    assert (await call(client, owner, "GET", "/api/ai/status"))["ready"] is False


async def test_answers_from_sales_tool(client, owner, shop, fake_ai):
    await configure(client, owner)
    today = (await call(client, owner, "GET", "/api/reports/summary"))["start"]
    fake = fake_ai("sales_summary", {"start": today, "end": today})
    r = await call(client, owner, "POST", "/api/ai/ask", {
        "question": "How much did we sell today?",
        "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello!"}]})
    assert r["used"] == ["sales_summary"]
    data = json.loads(r["answer"].removeprefix("RESULT "))
    assert data["sales_total"] == 9000 and data["net_profit"] == 9000 - 5600
    first = fake.requests[0]
    assert first["url"].startswith("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")
    assert first["auth"] == "Bearer test-key-12345678"
    msgs = first["body"]["messages"]
    assert msgs[0]["role"] == "system" and today in msgs[0]["content"]
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user"]
    assert {t["function"]["name"] for t in first["body"]["tools"]} >= {"sales_summary", "stock_levels", "rooms_now"}


async def test_tools_never_send_guest_details(client, owner, shop, fake_ai):
    await configure(client, owner)
    fake = fake_ai("rooms_now")
    r = await call(client, owner, "POST", "/api/ai/ask", {"question": "How many rooms are occupied?"})
    data = json.loads(r["answer"].removeprefix("RESULT "))
    assert data["occupied"] == 1 and data["total_rooms"] == 1
    sent = json.dumps(fake.requests)
    assert "Secret Guest" not in sent and "0771234567" not in sent and "991234567V" not in sent


async def test_stock_tool(client, owner, shop, fake_ai):
    await configure(client, owner)
    fake_ai("stock_levels", {"low_only": True})
    r = await call(client, owner, "POST", "/api/ai/ask", {"question": "What is running low?"})
    data = json.loads(r["answer"].removeprefix("RESULT "))
    assert data["items"] == [{"name": "Rockland Arrack 750ml", "in_stock": "3 bottles", "low": True,
                              "reorder_level": "10 bottles"}]
    fake_ai("stock_levels", {"search": "arrack"})
    r = await call(client, owner, "POST", "/api/ai/ask", {"question": "How much arrack?"})
    assert "3 bottles" in r["answer"]


async def test_manager_gets_no_profit(client, owner, shop, fake_ai):
    await configure(client, owner)
    await make_user(client, owner, "mgr1", "manager")
    mgr = bearer(await login(client, "mgr1", "Password123"))
    today = (await call(client, owner, "GET", "/api/reports/summary"))["start"]
    fake = fake_ai("sales_summary", {"start": today, "end": today})
    r = await call(client, mgr, "POST", "/api/ai/ask", {"question": "What was profit today?"})
    data = json.loads(r["answer"].removeprefix("RESULT "))
    assert "net_profit" not in data and "cost_of_sales" not in data and data["sales_total"] == 9000
    assert "not allowed to see cost or profit" in fake.requests[0]["body"]["messages"][0]["content"]
    # Managers can't change the AI settings or see the key.
    await call(client, mgr, "GET", "/api/ai/config", code=403)


async def test_errors_and_limits(client, owner, shop, fake_ai):
    await configure(client, owner)
    fake_ai("sales_summary", status=401)
    r = await client.post("/api/ai/ask", json={"question": "Sales?"}, headers=owner)
    assert r.status_code == 400 and "didn't accept the key" in r.json()["detail"]
    fake_ai("sales_summary", status=429)
    r = await client.post("/api/ai/ask", json={"question": "Sales?"}, headers=owner)
    assert "free AI limit" in r.json()["detail"]
    for _ in range(6):
        await client.post("/api/ai/ask", json={"question": "Sales?"}, headers=owner)
    r = await client.post("/api/ai/ask", json={"question": "Sales?"}, headers=owner)
    assert r.status_code == 429

    await make_user(client, owner, "waiter9", "waiter")
    waiter = bearer(await login(client, "waiter9", "Password123"))
    await call(client, waiter, "POST", "/api/ai/ask", {"question": "Sales?"}, code=403)
