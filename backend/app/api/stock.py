from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.api.catalogue import with_stock
from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.models import Item, StockMovement, User
from app.schemas.inventory import (
    CountIn,
    ItemOut,
    MovementOut,
    MovementPage,
    OpeningStockIn,
    WastageIn,
)
from app.services import audit, stock

router = APIRouter(prefix="/items/{item_id}", tags=["stock"])

Viewer = Annotated[User, Depends(require_any(*STOCK_VIEWERS))]


async def _tracked_item(db: DB, item_id: int, lock: bool = False) -> Item:
    item = await (stock.lock_item(db, item_id) if lock else db.get(Item, item_id))
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    if not item.track_stock:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Stock isn't tracked for {item.name}")
    return item


@router.get("/movements", response_model=MovementPage)
async def movements(
    item_id: int,
    _: Viewer,
    db: DB,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=200),
):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")

    # Running balance after each movement, oldest to newest; page newest first.
    balance = func.sum(StockMovement.qty).over(order_by=(StockMovement.created_at, StockMovement.id))
    inner = (
        select(StockMovement.id.label("id"), balance.label("balance"))
        .where(StockMovement.item_id == item_id)
        .subquery()
    )
    total = await db.scalar(select(func.count()).select_from(inner))
    rows = await db.execute(
        select(StockMovement, inner.c.balance)
        .join(inner, inner.c.id == StockMovement.id)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        MovementOut.model_validate(m).model_copy(
            update={"balance_after": Decimal(b), "qty_display": stock.format_qty(item, m.qty)}
        )
        for m, b in rows
    ]
    return MovementPage(items=items, total=total or 0, page=page, page_size=page_size)


@router.post("/opening", response_model=ItemOut)
async def set_opening_stock(
    item_id: int,
    body: OpeningStockIn,
    actor: Annotated[User, Depends(require("catalogue.manage"))],
    db: DB,
    request: Request,
):
    """Starting stock when the system goes live. Only once per item; after that,
    stock changes come from purchases, sales, wastage and counts."""
    item = await _tracked_item(db, item_id, lock=True)
    if await stock.has_movements(db, item.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This item already has stock records. Use a stock count to correct the quantity.",
        )
    if body.qty > 0:
        await stock.receive(
            db, item=item, qty=body.qty, cost_per_base=body.cost_per_unit / item.unit_size,
            type="opening", user=actor, reason="Opening stock",
        )
    if body.cost_per_unit > 0:
        item.cost_price = body.cost_per_unit
    audit.record(db, user=actor, action="opening_stock", entity="item", entity_id=item.id,
                 after={"name": item.name, "qty": stock.format_qty(item, body.qty),
                        "cost_per_unit": float(body.cost_per_unit)}, request=request)
    await db.commit()
    return (await with_stock(db, [item]))[0]


@router.post("/wastage", response_model=ItemOut)
async def record_wastage(
    item_id: int,
    body: WastageIn,
    actor: Annotated[User, Depends(require("stock.wastage"))],
    db: DB,
    request: Request,
):
    item = await _tracked_item(db, item_id, lock=True)
    stock.add_movement(db, item=item, qty=-body.qty, type="wastage", user=actor, reason=body.reason)
    audit.record(db, user=actor, action="wastage", entity="item", entity_id=item.id,
                 after={"name": item.name, "qty": stock.format_qty(item, body.qty), "reason": body.reason},
                 request=request)
    await db.commit()
    return (await with_stock(db, [item]))[0]


@router.post("/count", response_model=ItemOut)
async def record_count(
    item_id: int,
    body: CountIn,
    actor: Annotated[User, Depends(require("stock.count"))],
    db: DB,
    request: Request,
):
    """Set stock to what was physically counted. The difference is recorded
    as an adjustment, so nothing is lost from the history."""
    item = await _tracked_item(db, item_id, lock=True)
    current = (await stock.on_hand(db, [item.id]))[item.id]
    diff = body.counted - current
    if diff != 0:
        stock.add_movement(db, item=item, qty=diff, type="count_adjust", user=actor, reason=body.reason)
        audit.record(db, user=actor, action="stock_count", entity="item", entity_id=item.id,
                     before={"name": item.name, "system": stock.format_qty(item, current)},
                     after={"name": item.name, "counted": stock.format_qty(item, body.counted),
                            "difference": stock.format_qty(item, diff)},
                     request=request)
        await db.commit()
    return (await with_stock(db, [item]))[0]
