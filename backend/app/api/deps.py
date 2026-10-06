from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import OWNER_ROLE, PERMISSIONS
from app.core.security import decode_token
from app.db import get_db
from app.models import User

DB = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not logged in or session expired",
    headers={"WWW-Authenticate": "Bearer"},
)


def permissions_of(user: User) -> list[str]:
    if user.role.name == OWNER_ROLE:
        return sorted(PERMISSIONS)
    return user.role.permission_names


async def get_current_user(
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if creds is None:
        raise _UNAUTHORIZED
    try:
        payload = decode_token(creds.credentials, "access")
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _UNAUTHORIZED
    user = await db.get(User, user_id)
    if user is None or not user.is_active or user.token_version != payload.get("ver"):
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require(*needed: str) -> Callable:
    """Dependency: the current user must hold every listed permission."""

    async def checker(user: CurrentUser) -> User:
        held = set(permissions_of(user))
        missing = [p for p in needed if p not in held]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {', '.join(missing)}",
            )
        return user

    return checker
