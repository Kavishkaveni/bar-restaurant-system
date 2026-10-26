"""Tests run against a real PostgreSQL database (TEST_DATABASE_URL).

Each test gets freshly created tables, the default roles and settings, and
an owner account `owner` / `OwnerPass123`.
"""

import os

# Tests drop and recreate every table, so they must never touch the real
# database: always use TEST_DATABASE_URL, and only a database named *_test.
_test_url = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://barpos:barpos@localhost:5432/barpos_test")
if not _test_url.rsplit("/", 1)[-1].split("?")[0].endswith("_test"):
    raise RuntimeError(f"Refusing to run tests: database name in TEST_DATABASE_URL must end in _test ({_test_url})")
os.environ["DATABASE_URL"] = _test_url
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256"
os.environ["OWNER_USERNAME"] = "owner"
os.environ["OWNER_PASSWORD"] = "OwnerPass123"
os.environ["LIVE_UPDATES"] = "false"
os.environ["BACKUPS_ENABLED"] = "false"  # the daily timer; test_backups.py makes backups directly  # tested on their own in test_live.py

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import seed as seed_module
from app.core.config import get_settings
from app.db import get_db
from app.main import app
from app.models import Base


@pytest.fixture
async def sessionmaker():
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    seed_module.SessionLocal = maker
    await seed_module.seed()
    yield maker
    await engine.dispose()


@pytest.fixture
async def client(sessionmaker):
    async def _db():
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def login(client: AsyncClient, username: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
async def owner(client):
    return bearer(await login(client, "owner", "OwnerPass123"))


async def role_id(client: AsyncClient, headers: dict, name: str) -> int:
    roles = (await client.get("/api/roles", headers=headers)).json()
    return next(r["id"] for r in roles if r["name"] == name)


async def make_user(client, headers, username, role, pin=None, password="Password123"):
    body = {
        "name": username.title(),
        "username": username,
        "password": password,
        "role_id": await role_id(client, headers, role),
    }
    if pin:
        body["pin"] = pin
    r = await client.post("/api/users", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()
