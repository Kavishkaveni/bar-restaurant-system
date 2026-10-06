from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, require
from app.core.permissions import DEFAULT_SETTINGS
from app.models import Setting, User
from app.services import audit

router = APIRouter(prefix="/settings", tags=["settings"])


class BusinessSettings(BaseModel):
    business_name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=300)
    phone: str = Field(default="", max_length=40)
    currency: str = Field(default="LKR", max_length=8)
    currency_symbol: str = Field(default="Rs.", max_length=8)
    timezone: str = "Asia/Colombo"
    tax_percent: float = Field(default=0, ge=0, le=100)
    service_charge_percent: float = Field(default=0, ge=0, le=100)
    receipt_footer: str = Field(default="", max_length=300)
    overhead_percent: float = Field(default=0, ge=0, le=100)


async def load_settings(db: DB) -> dict[str, Any]:
    rows = await db.scalars(select(Setting))
    values = dict(DEFAULT_SETTINGS)
    values.update({row.key: row.value for row in rows})
    return values


@router.get("", response_model=BusinessSettings)
async def get_settings(_: CurrentUser, db: DB):
    return await load_settings(db)


@router.put("", response_model=BusinessSettings)
async def save_settings(
    body: BusinessSettings,
    actor: Annotated[User, Depends(require("settings.manage"))],
    db: DB,
    request: Request,
):
    current = await load_settings(db)
    new = body.model_dump()
    changed = {k: v for k, v in new.items() if current.get(k) != v}
    if not changed:
        return new
    for key, value in changed.items():
        row = await db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    audit.record(
        db, user=actor, action="update", entity="settings",
        before={k: current.get(k) for k in changed}, after=changed, request=request,
    )
    await db.commit()
    return new
