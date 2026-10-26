"""Phase 8: database backups."""

import asyncio
import subprocess

import pytest
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.services import backup
from tests.conftest import bearer, login, make_user


@pytest.fixture
def backup_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "backup_dir", str(tmp_path))
    return tmp_path


async def test_back_up_now_list_and_download(client, owner, backup_dir):
    r = await client.post("/api/backups", headers=owner)
    assert r.status_code == 201, r.text
    name = r.json()["name"]
    assert backup.NAME.match(name) and (backup_dir / name).stat().st_size > 1000

    listing = (await client.get("/api/backups", headers=owner)).json()
    assert listing["items"][0]["name"] == name and listing["keep"] == 14 and listing["daily_at"] == "03:00"

    d = await client.get(f"/api/backups/{name}", headers=owner)
    assert d.status_code == 200 and d.content[:5] == b"PGDMP"  # pg_dump's custom format
    assert (await client.get("/api/backups/..%2F.env", headers=owner)).status_code == 404
    assert (await client.get("/api/backups/barpos-20990101-0000.dump", headers=owner)).status_code == 404


async def test_backup_can_be_restored(client, owner, backup_dir):
    await client.post("/api/users", headers=owner, json={
        "name": "Restore Check", "username": "restorecheck", "password": "Password123",
        "role_id": (await client.get("/api/roles", headers=owner)).json()[0]["id"]})
    name = (await client.post("/api/backups", headers=owner)).json()["name"]

    assert await asyncio.to_thread(restore_and_count, backup_dir / name) == "1"


def restore_and_count(dump) -> str:
    """Restore the backup into a scratch database and count the user made before it."""
    url = make_url(get_settings().database_url)
    env = {"PGPASSWORD": url.password or "", "PATH": "/usr/bin:/bin:/usr/local/bin"}
    conn = ["-h", url.host or "localhost", "-p", str(url.port or 5432), "-U", url.username]
    scratch = "barpos_restore_test"
    subprocess.run(["dropdb", *conn, "--if-exists", scratch], env=env, check=True)
    subprocess.run(["createdb", *conn, scratch], env=env, check=True)
    try:
        subprocess.run(["pg_restore", *conn, "--no-owner", "-d", scratch, str(dump)], env=env, check=True)
        return subprocess.run(["psql", *conn, "-d", scratch, "-tAc",
                               "select count(*) from users where username = 'restorecheck'"],
                              env=env, check=True, capture_output=True, text=True).stdout.strip()
    finally:
        subprocess.run(["dropdb", *conn, "--if-exists", scratch], env=env, check=True)


async def test_keeps_only_the_newest(client, owner, backup_dir, monkeypatch):
    monkeypatch.setattr(get_settings(), "backup_keep", 3)
    for day in ("20260101", "20260102", "20260103", "20260104"):
        (backup_dir / f"barpos-{day}-0300.dump").write_bytes(b"PGDMP old")
    (backup_dir / "notes.txt").write_text("not a backup")
    new = (await client.post("/api/backups", headers=owner)).json()["name"]
    left = sorted(p.name for p in backup_dir.iterdir())
    assert left == sorted(["barpos-20260103-0300.dump", "barpos-20260104-0300.dump", new, "notes.txt"])


async def test_daily_backup_runs_once(sessionmaker, backup_dir, monkeypatch):
    monkeypatch.setattr(get_settings(), "backup_time", "00:00")  # always "after the backup time"
    task = asyncio.create_task(backup.run_daily(sessionmaker))
    try:
        for _ in range(100):
            if backup.list_backups():
                break
            await asyncio.sleep(0.1)
    finally:
        task.cancel()
    assert len(backup.list_backups()) == 1


async def test_missing_pg_dump_and_permissions(client, owner, backup_dir, monkeypatch):
    monkeypatch.setattr(get_settings(), "pg_dump_path", "no-such-pg-dump")
    r = await client.post("/api/backups", headers=owner)
    assert r.status_code == 500 and "PG_DUMP_PATH" in r.json()["detail"]
    await make_user(client, owner, "mgr2", "manager")
    mgr = bearer(await login(client, "mgr2", "Password123"))
    assert (await client.get("/api/backups", headers=mgr)).status_code == 403
    assert (await client.post("/api/backups", headers=mgr)).status_code == 403
