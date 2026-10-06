"""PIN checks with lockout, shared by PIN login and manager approvals."""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.permissions import OWNER_ROLE, PERMISSIONS
from app.core.security import verify_secret
from app.models import User
from app.services import audit


async def check_pin(db: AsyncSession, user: User | None, pin: str, request: Request | None = None) -> User:
    """Return the user if the PIN is right. Wrong PINs count towards a lock;
    the counter is committed even though the request fails."""
    cfg = get_settings()
    if not user or not user.is_active or not user.has_pin:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong PIN")

    now = datetime.now(timezone.utc)
    if user.pin_locked_until and user.pin_locked_until > now:
        minutes = int((user.pin_locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Too many wrong PINs for {user.name}. Try again in {minutes} min or log in with the password.",
        )

    if not verify_secret(pin, user.pin_hash):
        user.failed_pin_attempts += 1
        if user.failed_pin_attempts >= cfg.pin_max_attempts:
            user.pin_locked_until = now + timedelta(minutes=cfg.pin_lock_minutes)
            user.failed_pin_attempts = 0
            audit.record(db, user=user, action="pin_locked", entity="user", entity_id=user.id, request=request)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong PIN")

    user.failed_pin_attempts = 0
    user.pin_locked_until = None
    return user


def has_permission(user: User, permission: str) -> bool:
    if user.role.name == OWNER_ROLE:
        return permission in PERMISSIONS
    return permission in user.role.permission_names


class Approval(BaseModel):
    """A manager standing at the counter approves with their PIN."""

    user_id: int
    pin: str = Field(pattern=r"^\d{4}$")


async def authorize(
    db: AsyncSession,
    actor: User,
    permission: str,
    approval: Approval | None,
    request: Request | None = None,
) -> User:
    """Return who allowed this action: the actor if they hold the permission,
    otherwise a manager who approved with their PIN.

    Raises 428 when approval is needed, so the screen can ask for a PIN."""
    if has_permission(actor, permission):
        return actor
    if approval is None:
        raise HTTPException(status.HTTP_428_PRECONDITION_REQUIRED, "A manager needs to approve this")
    approver = await check_pin(db, await db.get(User, approval.user_id), approval.pin, request)
    if not has_permission(approver, permission):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{approver.name} can't approve this")
    return approver
