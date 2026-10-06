from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import DB, require
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import AuditLog, User
from app.schemas.audit import AuditPage

router = APIRouter(prefix="/audit-log", tags=["audit"])


@router.get("", response_model=AuditPage)
async def list_audit(
    _: Annotated[User, Depends(require("audit.view"))],
    db: DB,
    user_id: int | None = None,
    entity: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    filters = []
    if user_id:
        filters.append(AuditLog.user_id == user_id)
    if entity:
        filters.append(AuditLog.entity == entity)
    if action:
        filters.append(AuditLog.action == action)
    # Dates are the business's local days, not UTC days.
    tz = business_tz((await load_settings(db))["timezone"])
    if date_from:
        filters.append(AuditLog.created_at >= datetime.combine(date_from, time.min, tz))
    if date_to:
        filters.append(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tz))

    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*filters))
    rows = await db.scalars(
        select(AuditLog)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return AuditPage(items=list(rows), total=total or 0, page=page, page_size=page_size)
