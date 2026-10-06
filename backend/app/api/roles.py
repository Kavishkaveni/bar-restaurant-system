from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select

from app.api.deps import DB, CurrentUser, require
from app.core.permissions import OWNER_ROLE, PERMISSIONS
from app.models import Role, RolePermission, User
from app.schemas.user import RoleOut, RolePermissionsUpdate
from app.services import audit

router = APIRouter(tags=["roles"])

Manager = Annotated[User, Depends(require("users.manage"))]


@router.get("/permissions")
async def list_permissions(_: CurrentUser) -> dict[str, str]:
    return PERMISSIONS


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(_: CurrentUser, db: DB):
    return list(await db.scalars(select(Role).order_by(Role.id)))


@router.put("/roles/{role_id}/permissions", response_model=RoleOut)
async def set_role_permissions(
    role_id: int, body: RolePermissionsUpdate, actor: Manager, db: DB, request: Request
):
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if role.name == OWNER_ROLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The Owner role always has every permission")
    unknown = sorted(set(body.permissions) - set(PERMISSIONS))
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown permissions: {', '.join(unknown)}")

    before = {"permissions": role.permission_names}
    # Permissions are read from the database on every request, so users of
    # this role get the change on their next request without logging out.
    await db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    for p in sorted(set(body.permissions)):
        db.add(RolePermission(role_id=role.id, permission=p))
    audit.record(
        db, user=actor, action="update_permissions", entity="role", entity_id=role.id,
        before=before, after={"permissions": sorted(set(body.permissions))}, request=request,
    )
    await db.commit()
    await db.refresh(role, ["permissions"])
    return role
