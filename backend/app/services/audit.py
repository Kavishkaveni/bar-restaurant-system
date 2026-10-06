from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User

# Never write secrets into the audit log.
_HIDDEN = {"password", "password_hash", "pin", "pin_hash"}


def _clean(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None
    return {k: ("***" if k in _HIDDEN else v) for k, v in data.items()}


def record(
    db: AsyncSession,
    *,
    user: User | None,
    action: str,
    entity: str,
    entity_id: Any = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Add an audit row to the current transaction; the caller commits."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            before=_clean(before),
            after=_clean(after),
            ip=request.client.host if request and request.client else None,
        )
    )


def user_snapshot(user: User) -> dict[str, Any]:
    return {
        "name": user.name,
        "username": user.username,
        "role": user.role.label,
        "is_active": user.is_active,
        "has_pin": user.has_pin,
    }
