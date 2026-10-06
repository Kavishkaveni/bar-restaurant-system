"""Create default roles, permissions, settings and the first owner account.

Safe to run on every start: it only adds what is missing and never changes
permissions the owner has edited.

    python -m app.seed
"""

import asyncio

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.permissions import DEFAULT_ROLES, DEFAULT_SETTINGS, OWNER_ROLE
from app.core.security import hash_secret
from app.db import SessionLocal
from app.models import ExpenseCategory, Role, RolePermission, Setting, User
from app.models.money import DEFAULT_EXPENSE_CATEGORIES


async def seed() -> None:
    cfg = get_settings()
    async with SessionLocal() as db:
        for name, (label, perms) in DEFAULT_ROLES.items():
            role = await db.scalar(select(Role).where(Role.name == name))
            if role is None:
                db.add(
                    Role(
                        name=name,
                        label=label,
                        is_system=True,
                        permissions=[RolePermission(permission=p) for p in perms],
                    )
                )
                print(f"Created role: {label}")

        for key, value in DEFAULT_SETTINGS.items():
            if await db.get(Setting, key) is None:
                db.add(Setting(key=key, value=value))

        if not await db.scalar(select(func.count()).select_from(ExpenseCategory)):
            for i, name in enumerate(DEFAULT_EXPENSE_CATEGORIES):
                db.add(ExpenseCategory(name=name, sort_order=i))

        await db.flush()

        if not await db.scalar(select(func.count()).select_from(User)):
            owner_role = await db.scalar(select(Role).where(Role.name == OWNER_ROLE))
            db.add(
                User(
                    name=cfg.owner_name,
                    username=cfg.owner_username.lower(),
                    password_hash=hash_secret(cfg.owner_password),
                    role_id=owner_role.id,
                )
            )
            print(f"Created owner account: {cfg.owner_username} (change the password after first login)")

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
