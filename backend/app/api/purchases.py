from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, require
from app.models import Item, Purchase, PurchaseLine, Supplier, User
from app.schemas.inventory import (
    CancelIn,
    PaymentIn,
    PurchaseIn,
    PurchaseOut,
    PurchasePage,
)
from app.services import audit, stock

router = APIRouter(prefix="/purchases", tags=["purchases"])

Manager = Annotated[User, Depends(require("purchasing.manage"))]
CENT = Decimal("0.01")


def _money(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


async def _get(db: DB, purchase_id: int) -> Purchase:
    """Load a purchase with everything the response needs, fresh from the database."""
    purchase = await db.scalar(
        select(Purchase)
        .where(Purchase.id == purchase_id)
        .options(
            selectinload(Purchase.lines).selectinload(PurchaseLine.item),
            selectinload(Purchase.supplier),
            selectinload(Purchase.creator),
        )
        .execution_options(populate_existing=True)
    )
    if not purchase:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase not found")
    return purchase


@router.get("", response_model=PurchasePage)
async def list_purchases(
    _: Manager,
    db: DB,
    supplier_id: int | None = None,
    status_: Annotated[str | None, Query(alias="status")] = None,
    unpaid_only: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
):
    filters = []
    if supplier_id:
        filters.append(Purchase.supplier_id == supplier_id)
    if status_:
        filters.append(Purchase.status == status_)
    if unpaid_only:
        filters += [Purchase.status == "received", Purchase.amount_paid < Purchase.total]
    if date_from:
        filters.append(Purchase.invoice_date >= date_from)
    if date_to:
        filters.append(Purchase.invoice_date <= date_to)

    total = await db.scalar(select(func.count()).select_from(Purchase).where(*filters))
    rows = await db.scalars(
        select(Purchase)
        .where(*filters)
        .order_by(Purchase.invoice_date.desc(), Purchase.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return PurchasePage(items=list(rows), total=total or 0, page=page, page_size=page_size)


@router.post("", response_model=PurchaseOut, status_code=status.HTTP_201_CREATED)
async def create_purchase(body: PurchaseIn, actor: Manager, db: DB, request: Request):
    """Record goods received. Stock goes up and average costs update, all in one
    transaction: either the whole invoice is saved or none of it."""
    supplier = await db.get(Supplier, body.supplier_id)
    if not supplier or not supplier.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a supplier")

    # Lock items in id order so two purchases for the same items can't deadlock.
    items: dict[int, Item] = {}
    for item_id in sorted({line.item_id for line in body.lines}):
        item = await stock.lock_item(db, item_id)
        if not item or not item.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Item #{item_id} not found")
        items[item_id] = item

    lines = [
        PurchaseLine(
            item_id=line.item_id,
            qty=line.qty,
            unit_cost=line.unit_cost,
            line_total=_money(line.qty * line.unit_cost),
            expiry_date=line.expiry_date,
        )
        for line in body.lines
    ]
    total = sum((line.line_total for line in lines), Decimal(0))
    if body.amount_paid > total:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Amount paid can't be more than the total ({total:,.2f})")

    purchase = Purchase(
        supplier_id=supplier.id,
        invoice_no=body.invoice_no.strip(),
        invoice_date=body.invoice_date,
        notes=body.notes,
        total=total,
        amount_paid=body.amount_paid,
        created_by=actor.id,
        lines=lines,
    )
    db.add(purchase)
    await db.flush()

    for line in lines:
        item = items[line.item_id]
        item.cost_price = line.unit_cost
        if item.track_stock:
            await stock.receive(
                db, item=item, qty=stock.to_base(item, line.qty), cost_per_base=line.unit_cost / item.unit_size,
                type="purchase", user=actor, ref_type="purchase", ref_id=purchase.id,
                reason=f"{supplier.name}{' #' + purchase.invoice_no if purchase.invoice_no else ''}",
            )
            await db.flush()  # so the next line for the same item sees this stock

    audit.record(
        db, user=actor, action="create", entity="purchase", entity_id=purchase.id,
        after={"name": f"{supplier.name} {purchase.invoice_no}".strip(), "total": float(total),
               "lines": len(lines), "amount_paid": float(body.amount_paid)},
        request=request,
    )
    await db.commit()
    return await _get(db, purchase.id)


@router.get("/{purchase_id}", response_model=PurchaseOut)
async def get_purchase(purchase_id: int, _: Manager, db: DB):
    return await _get(db, purchase_id)


@router.post("/{purchase_id}/payment", response_model=PurchaseOut)
async def set_payment(purchase_id: int, body: PaymentIn, actor: Manager, db: DB, request: Request):
    purchase = await _get(db, purchase_id)
    if purchase.status != "received":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This purchase was cancelled")
    if body.amount_paid > purchase.total:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Amount paid can't be more than {purchase.total:,.2f}")
    before = float(purchase.amount_paid)
    purchase.amount_paid = body.amount_paid
    audit.record(
        db, user=actor, action="payment", entity="purchase", entity_id=purchase.id,
        before={"name": f"{purchase.supplier.name} {purchase.invoice_no}".strip(), "amount_paid": before},
        after={"name": f"{purchase.supplier.name} {purchase.invoice_no}".strip(), "amount_paid": float(body.amount_paid)},
        request=request,
    )
    await db.commit()
    return await _get(db, purchase.id)


@router.post("/{purchase_id}/cancel", response_model=PurchaseOut)
async def cancel_purchase(purchase_id: int, body: CancelIn, actor: Manager, db: DB, request: Request):
    """Undo a purchase entered by mistake: its stock is taken back out. Paid
    purchases can't be cancelled, so supplier balances stay correct."""
    purchase = await _get(db, purchase_id)
    if purchase.status == "cancelled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Already cancelled")
    if purchase.amount_paid > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This purchase has a payment recorded. Set the amount paid to 0 first.",
        )

    for item_id in sorted({line.item_id for line in purchase.lines}):
        await stock.lock_item(db, item_id)
    for line in purchase.lines:
        item = line.item
        if item.track_stock:
            await stock.unreceive(
                db, item=item, qty=stock.to_base(item, line.qty), cost_per_base=line.unit_cost / item.unit_size,
                type="purchase_void", user=actor, ref_type="purchase", ref_id=purchase.id,
                reason=f"Cancelled: {body.reason}",
            )
            await db.flush()

    purchase.status = "cancelled"
    purchase.cancel_reason = body.reason
    audit.record(
        db, user=actor, action="cancel", entity="purchase", entity_id=purchase.id,
        after={"name": f"{purchase.supplier.name} {purchase.invoice_no}".strip(), "reason": body.reason},
        request=request,
    )
    await db.commit()
    return await _get(db, purchase.id)
