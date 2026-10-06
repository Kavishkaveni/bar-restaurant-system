from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.models import Purchase, Supplier, User
from app.schemas.inventory import SupplierIn, SupplierOut
from app.services import audit

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

Manager = Annotated[User, Depends(require("purchasing.manage"))]


async def _with_balance(db: DB, suppliers: list[Supplier]) -> list[SupplierOut]:
    ids = [s.id for s in suppliers]
    rows = (
        await db.execute(
            select(
                Purchase.supplier_id,
                func.coalesce(func.sum(Purchase.total - Purchase.amount_paid), 0),
                func.count(),
            )
            .where(Purchase.supplier_id.in_(ids), Purchase.status == "received")
            .group_by(Purchase.supplier_id)
        )
        if ids
        else []
    )
    stats = {sid: (Decimal(bal), n) for sid, bal, n in rows}
    return [
        SupplierOut.model_validate(s).model_copy(
            update={"balance_due": stats.get(s.id, (Decimal(0), 0))[0], "purchase_count": stats.get(s.id, (0, 0))[1]}
        )
        for s in suppliers
    ]


async def _name_taken(db: DB, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(Supplier.id).where(func.lower(Supplier.name) == name.lower(), Supplier.is_active.is_(True))
    if exclude_id:
        stmt = stmt.where(Supplier.id != exclude_id)
    return bool(await db.scalar(stmt))


@router.get("", response_model=list[SupplierOut])
async def list_suppliers(_: Annotated[User, Depends(require_any(*STOCK_VIEWERS))], db: DB, q: str | None = None):
    stmt = select(Supplier).where(Supplier.is_active.is_(True)).order_by(Supplier.name)
    if q:
        stmt = stmt.where(func.lower(Supplier.name).like(f"%{q.lower().strip()}%"))
    return await _with_balance(db, list(await db.scalars(stmt)))


@router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
async def create_supplier(body: SupplierIn, actor: Manager, db: DB, request: Request):
    if await _name_taken(db, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'A supplier called "{body.name}" already exists')
    supplier = Supplier(**body.model_dump())
    db.add(supplier)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="supplier", entity_id=supplier.id,
                 after=body.model_dump(), request=request)
    await db.commit()
    return (await _with_balance(db, [supplier]))[0]


@router.get("/{supplier_id}", response_model=SupplierOut)
async def get_supplier(supplier_id: int, _: Manager, db: DB):
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    return (await _with_balance(db, [supplier]))[0]


@router.put("/{supplier_id}", response_model=SupplierOut)
async def update_supplier(supplier_id: int, body: SupplierIn, actor: Manager, db: DB, request: Request):
    supplier = await db.get(Supplier, supplier_id)
    if not supplier or not supplier.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    if await _name_taken(db, body.name, exclude_id=supplier.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'A supplier called "{body.name}" already exists')
    before = {k: getattr(supplier, k) for k in body.model_dump()}
    for key, value in body.model_dump().items():
        setattr(supplier, key, value)
    audit.record(db, user=actor, action="update", entity="supplier", entity_id=supplier.id,
                 before=before, after=body.model_dump(), request=request)
    await db.commit()
    return (await _with_balance(db, [supplier]))[0]


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(supplier_id: int, actor: Manager, db: DB, request: Request):
    supplier = await db.get(Supplier, supplier_id)
    if not supplier or not supplier.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    balance = (await _with_balance(db, [supplier]))[0].balance_due
    if balance > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You still owe this supplier {balance:,.2f}. Record the payments before deleting.",
        )
    supplier.is_active = False
    audit.record(db, user=actor, action="delete", entity="supplier", entity_id=supplier.id,
                 before={"name": supplier.name}, request=request)
    await db.commit()
