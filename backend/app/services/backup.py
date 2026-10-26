"""Daily database backups with pg_dump.

Once a day after the backup time (03:00 by default) the server writes a
compressed copy of the whole database to the backups folder and keeps the
newest 14. The owner can also back up now and download any copy from
Settings. With several server processes, a database lock makes sure only
one of them runs the backup.

To restore a copy (this replaces everything in the database):
    pg_restore --clean --if-exists -d <database url> barpos-YYYYMMDD-HHMM.dump
"""

import asyncio
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, time, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.core.timeutil import business_tz

log = logging.getLogger("app.backup")
NAME = re.compile(r"^barpos-(\d{8})-(\d{4})\.dump$")
LOCK_ID = 7_202_610  # any fixed number; shared by every server process


class BackupError(Exception):
    pass


@dataclass
class BackupFile:
    name: str
    size: int
    created_at: datetime


def folder() -> Path:
    path = Path(get_settings().backup_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_backups() -> list[BackupFile]:
    out = []
    for p in folder().glob("barpos-*.dump"):
        if NAME.match(p.name):
            st = p.stat()
            out.append(BackupFile(p.name, st.st_size, datetime.fromtimestamp(st.st_mtime, timezone.utc)))
    return sorted(out, key=lambda b: b.name, reverse=True)


def path_of(name: str) -> Path:
    if not NAME.match(name):
        raise BackupError("Backup not found")
    p = folder() / name
    if not p.is_file():
        raise BackupError("Backup not found")
    return p


def _pg_dump() -> str:
    exe = get_settings().pg_dump_path
    found = shutil.which(exe) or (exe if Path(exe).is_file() else None)
    if not found:
        raise BackupError(
            "pg_dump wasn't found. Set PG_DUMP_PATH in the backend .env file, for example "
            r"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
        )
    return found


async def create(tz_name: str) -> BackupFile:
    """Write a new backup now and remove the oldest beyond the number to keep."""
    url = make_url(get_settings().database_url)
    now = datetime.now(business_tz(tz_name))
    name = f"barpos-{now:%Y%m%d-%H%M}.dump"
    target = folder() / name
    tmp = target.with_suffix(".part")
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    args = [_pg_dump(), "--format=custom", "--no-owner", "--file", str(tmp),
            "--host", url.host or "localhost", "--port", str(url.port or 5432),
            "--username", url.username or "postgres", url.database or "barpos"]
    # Run pg_dump on a worker thread. (asyncio's own subprocess support isn't
    # available on Windows when the server runs with --reload.)
    proc = await asyncio.to_thread(subprocess.run, args, env=env, capture_output=True)
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace").strip()
        tmp.unlink(missing_ok=True)
        log.error("Backup failed: %s", err)
        raise BackupError(f"Backup failed: {err[:300]}")
    tmp.replace(target)
    keep = get_settings().backup_keep
    for old in list_backups()[keep:]:
        (folder() / old.name).unlink(missing_ok=True)
    log.info("Backup written: %s", name)
    st = target.stat()
    return BackupFile(name, st.st_size, datetime.fromtimestamp(st.st_mtime, timezone.utc))


async def run_daily(session_factory) -> None:
    """Background loop: back up once a day after the backup time."""
    from app.api.settings import load_settings

    while True:
        try:
            async with session_factory() as db:
                tz_name = (await load_settings(db))["timezone"]
                now = datetime.now(business_tz(tz_name))
                hh, mm = (int(x) for x in get_settings().backup_time.split(":"))
                done_today = any(b.name.startswith(f"barpos-{now:%Y%m%d}") for b in list_backups())
                if now.time() >= time(hh, mm) and not done_today:
                    # Only one server process does it; the others see the lock taken and skip.
                    got = await db.scalar(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID})
                    if got:
                        try:
                            if not any(b.name.startswith(f"barpos-{now:%Y%m%d}") for b in list_backups()):
                                await create(tz_name)
                        finally:
                            await db.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
        except asyncio.CancelledError:
            raise
        except BackupError as e:  # e.g. pg_dump not found: one short line, not a long error
            log.warning("Daily backup skipped: %s", e)
        except Exception:  # never let a failed backup stop the loop
            log.exception("Daily backup check failed")
        await asyncio.sleep(600)
