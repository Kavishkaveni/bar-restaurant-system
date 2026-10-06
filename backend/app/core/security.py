from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings


def hash_secret(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_secret(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


def _encode(payload: dict[str, Any], expires: timedelta) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    body = {**payload, "iat": now, "exp": now + expires}
    return jwt.encode(body, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, token_version: int) -> str:
    settings = get_settings()
    return _encode(
        {"sub": str(user_id), "ver": token_version, "type": "access"},
        timedelta(minutes=settings.access_token_minutes),
    )


def create_refresh_token(user_id: int, token_version: int, via_pin: bool) -> str:
    settings = get_settings()
    expires = (
        timedelta(hours=settings.pin_refresh_token_hours)
        if via_pin
        else timedelta(days=settings.refresh_token_days)
    )
    return _encode(
        {"sub": str(user_id), "ver": token_version, "type": "refresh", "pin": via_pin},
        expires,
    )


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload
