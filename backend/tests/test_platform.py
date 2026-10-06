"""Things that differ between Linux and Windows."""

from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfoNotFoundError

from app.core import timeutil


def test_business_tz_works_without_tzdata():
    # On Windows without the tzdata package, ZoneInfo raises; we fall back.
    with mock.patch.object(timeutil, "ZoneInfo", side_effect=ZoneInfoNotFoundError("no tzdata")):
        tz = timeutil.business_tz("Asia/Colombo")
    assert datetime(2026, 10, 6, 12, 0, tzinfo=tz).utcoffset() == timedelta(hours=5, minutes=30)


def test_business_tz_with_tzdata():
    tz = timeutil.business_tz("Asia/Colombo")
    assert datetime(2026, 1, 1, tzinfo=tz).utcoffset() == timedelta(hours=5, minutes=30)


async def test_unexpected_error_returns_json_with_cors(client):
    from app.main import app

    @app.get("/api/__test_crash")
    async def crash():
        raise RuntimeError("boom")

    r = await client.get("/api/__test_crash", headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 500
    assert "Something went wrong" in r.json()["detail"]
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
