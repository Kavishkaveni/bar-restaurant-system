from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select

from app.api.deps import DB, require
from app.core.permissions import OWNER_ROLE
from app.core.security import hash_secret
from app.models import Role, User
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(prefix="/users", tags=["users"])

Manager = Annotated[User, Depends(require("users.manage"))]


async def _get_role(db: DB, role_id: int) -> Role:
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Role not found")
    return role


async def _active_owner_count(db: DB) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(User)
        .join(Role)
        .where(Role.name == OWNER_ROLE, User.is_active.is_(True))
    )


@router.get("", response_model=list[UserOut])
async def list_users(
    _: Manager,
    db: DB,
    q: str | None = None,
    include_inactive: bool = Query(default=False),
):
    stmt = select(User).order_by(User.is_active.desc(), User.name)
    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.name).like(like), User.username.like(like)))
    return list(await db.scalars(stmt))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, actor: Manager, db: DB, request: Request):
    await _get_role(db, body.role_id)
    if await db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")

    user = User(
        name=body.name.strip(),
        username=body.username,
        password_hash=hash_secret(body.password),
        pin_hash=hash_secret(body.pin) if body.pin else None,
        role_id=body.role_id,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user, ["role"])
    audit.record(
        db, user=actor, action="create", entity="user", entity_id=user.id,
        after=audit.user_snapshot(user), request=request,
    )
    await db.commit()
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: int, _: Manager, db: DB):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, actor: Manager, db: DB, request: Request):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    before = audit.user_snapshot(user)
    was_owner = user.role.name == OWNER_ROLE and user.is_active

    if body.name is not None:
        user.name = body.name.strip()
    if body.role_id is not None and body.role_id != user.role_id:
        user.role = await _get_role(db, body.role_id)
    if body.is_active is not None and body.is_active != user.is_active:
        if user.id == actor.id and not body.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
        user.is_active = body.is_active
        user.token_version += 1
    if body.password:
        user.password_hash = hash_secret(body.password)
        user.token_version += 1
    if body.remove_pin:
        user.pin_hash = None
    elif body.pin:
        user.pin_hash = hash_secret(body.pin)
        user.failed_pin_attempts = 0
        user.pin_locked_until = None

    still_owner = user.role.name == OWNER_ROLE and user.is_active
    if was_owner and not still_owner:
        await db.flush()
        if await _active_owner_count(db) == 0:
            await db.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "There must be at least one active owner")

    after = audit.user_snapshot(user)
    if body.password:
        after["password"] = "changed"
    audit.record(
        db, user=actor, action="update", entity="user", entity_id=user.id,
        before=before, after=after, request=request,
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(user_id: int, actor: Manager, db: DB, request: Request):
    """Users are never hard-deleted: old bills and audit rows still point to them."""
    await update_user(user_id, UserUpdate(is_active=False), actor, db, request)
