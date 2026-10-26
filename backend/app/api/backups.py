"""Database backups: list, back up now, download. Owner only."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import DB, require
from app.api.settings import load_settings
from app.core.config import get_settings
from app.models import User
from app.services import audit, backup

router = APIRouter(prefix="/backups", tags=["backups"])
Owner = Annotated[User, Depends(require("settings.manage"))]


class BackupOut(BaseModel):
    name: str
    size: int
    created_at: datetime


class BackupList(BaseModel):
    items: list[BackupOut]
    keep: int
    daily_at: str
    automatic: bool


@router.get("", response_model=BackupList)
async def list_backups(_: Owner):
    cfg = get_settings()
    return BackupList(items=[BackupOut(**b.__dict__) for b in backup.list_backups()], keep=cfg.backup_keep,
                      daily_at=cfg.backup_time, automatic=cfg.backups_enabled)


@router.post("", response_model=BackupOut, status_code=status.HTTP_201_CREATED)
async def back_up_now(actor: Owner, db: DB, request: Request):
    try:
        b = await backup.create((await load_settings(db))["timezone"])
    except backup.BackupError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e)) from None
    audit.record(db, user=actor, action="backup", entity="settings", after={"file": b.name}, request=request)
    await db.commit()
    return BackupOut(**b.__dict__)


@router.get("/{name}")
async def download(name: str, _: Owner):
    try:
        path = backup.path_of(name)
    except backup.BackupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from None
    return FileResponse(path, media_type="application/octet-stream", filename=name)
