from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, permissions_of
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_secret,
    verify_secret,
)
from app.models import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    Me,
    PinLoginRequest,
    RefreshRequest,
    TokenPair,
)
from app.schemas.user import StaffTile, UserOut
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])

# Checked when the username does not exist, so a wrong username takes as long
# as a wrong password and usernames cannot be discovered by timing.
_DUMMY_HASH = hash_secret("not-a-real-password")


def _login_response(user: User, via_pin: bool) -> LoginResponse:
    return LoginResponse(
        access_token=create_access_token(user.id, user.token_version),
        refresh_token=create_refresh_token(user.id, user.token_version, via_pin),
        user=UserOut.model_validate(user),
        permissions=permissions_of(user),
    )


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: DB, request: Request):
    user = await db.scalar(select(User).where(User.username == body.username.lower().strip()))
    ok = verify_secret(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")

    user.last_login_at = datetime.now(timezone.utc)
    audit.record(db, user=user, action="login", entity="user", entity_id=user.id, request=request)
    await db.commit()
    return _login_response(user, via_pin=False)


@router.post("/pin-login", response_model=LoginResponse)
async def pin_login(body: PinLoginRequest, db: DB, request: Request):
    settings = get_settings()
    user = await db.get(User, body.user_id)
    if not user or not user.is_active or not user.has_pin:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong PIN")

    now = datetime.now(timezone.utc)
    if user.pin_locked_until and user.pin_locked_until > now:
        minutes = int((user.pin_locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Too many wrong PINs. Try again in {minutes} min or log in with your password.",
        )

    if not verify_secret(body.pin, user.pin_hash):
        user.failed_pin_attempts += 1
        if user.failed_pin_attempts >= settings.pin_max_attempts:
            user.pin_locked_until = now + timedelta(minutes=settings.pin_lock_minutes)
            user.failed_pin_attempts = 0
            audit.record(
                db, user=user, action="pin_locked", entity="user", entity_id=user.id,
                request=request,
            )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong PIN")

    user.failed_pin_attempts = 0
    user.pin_locked_until = None
    user.last_login_at = now
    audit.record(db, user=user, action="pin_login", entity="user", entity_id=user.id, request=request)
    await db.commit()
    return _login_response(user, via_pin=True)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, db: DB):
    try:
        payload = decode_token(body.refresh_token, "refresh")
        user = await db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        user = None
        payload = {}
    if not user or not user.is_active or user.token_version != payload.get("ver"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please log in again")
    return TokenPair(
        access_token=create_access_token(user.id, user.token_version),
        refresh_token=create_refresh_token(user.id, user.token_version, bool(payload.get("pin"))),
    )


@router.get("/me", response_model=Me)
async def me(user: CurrentUser):
    return Me(user=UserOut.model_validate(user), permissions=permissions_of(user))


@router.post("/change-password", response_model=LoginResponse)
async def change_password(body: ChangePasswordRequest, user: CurrentUser, db: DB, request: Request):
    if not verify_secret(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_secret(body.new_password)
    user.token_version += 1  # logs out every other device
    audit.record(
        db, user=user, action="change_password", entity="user", entity_id=user.id, request=request
    )
    await db.commit()
    return _login_response(user, via_pin=False)


@router.get("/staff", response_model=list[StaffTile])
async def staff_for_pin_screen(_: CurrentUser, db: DB):
    """Active staff who have a PIN. The counter screen caches this list so
    staff can switch by tapping their name and entering their PIN."""
    users = await db.scalars(
        select(User)
        .where(User.is_active.is_(True), User.pin_hash.is_not(None))
        .order_by(User.name)
    )
    return list(users)
