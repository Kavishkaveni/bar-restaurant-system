"""Open bottles for pegs: see what's open, open a bottle, finish one."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.models import Category, Item, OpenBottle, SellOption, User
from app.schemas.inventory import BottleItemOut, FinishBottleIn, OpenBottleOut
from app.services import audit, bottles, stock

router = APIRouter(tags=["bottles"])

Bartender = Annotated[User, Depends(require("bar.open_bottle"))]


async def _summary(db: DB, items: list[Item]) -> list[BottleItemOut]:
    on_hand = await stock.on_hand(db, [i.id for i in items])
    options = list(
        await db.scalars(select(SellOption).where(SellOption.item_id.in_([i.id for i in items]), SellOption.is_active.is_(True)))
    ) if items else []
    out = []
    for item in items:
        pours = [o.deduct_qty for o in options if o.item_id == item.id and o.deduct_qty < item.unit_size]
        smallest = min(pours) if pours else None
        open_list = await bottles.open_bottles(db, item.id)
        sealed = await bottles.sealed_count(db, item, on_hand[item.id])
        left_in_open = sum((b.remaining_ml for b in open_list), Decimal(0))
        out.append(
            BottleItemOut(
                item_id=item.id,
                name=item.name,
                category=item.category.name,
                unit_size=item.unit_size,
                sealed=sealed,
                on_hand_display=stock.format_qty(item, on_hand[item.id]),
                smallest_pour=smallest,
                running_low=bool(smallest is not None and open_list and left_in_open < smallest and sealed == 0),
                open=[OpenBottleOut.model_validate(b) for b in open_list],
            )
        )
    return out


@router.get("/open-bottles", response_model=list[BottleItemOut])
async def list_open_bottles(_: Annotated[User, Depends(require_any(*STOCK_VIEWERS))], db: DB):
    """Every bottle-measured liquor, with its open bottles and sealed count."""
    items = list(
        await db.scalars(
            select(Item).join(Category)
            .where(Item.is_active.is_(True), Item.base_unit == "ml", Item.unit_size > 1, Item.track_stock.is_(True),
                   Item.kind == "final_product")
            .order_by(Category.name, Item.name)
        )
    )
    # Bring the open bottles in line with the stock if it went down another way.
    changed = [await bottles.fit_to_stock(db, item) for item in items]
    if any(changed):
        await db.commit()
    return await _summary(db, items)


@router.post("/items/{item_id}/bottles/open", response_model=BottleItemOut)
async def open_bottle(item_id: int, actor: Bartender, db: DB, request: Request):
    item = await stock.lock_item(db, item_id)
    if not item or not item.is_active or item.base_unit != "ml" or item.unit_size <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only bottle-measured items can be opened")
    await bottles.fit_to_stock(db, item)
    if await bottles.sealed_count(db, item) < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No sealed bottles of {item.name} left in stock")
    await bottles.open_new(db, item, actor, note="Opened by hand")
    audit.record(db, user=actor, action="open_bottle", entity="item", entity_id=item.id,
                 after={"name": item.name}, request=request)
    await db.commit()
    return (await _summary(db, [item]))[0]


@router.post("/open-bottles/{bottle_id}/finish", response_model=BottleItemOut)
async def finish_bottle(bottle_id: int, body: FinishBottleIn, actor: Bartender, db: DB, request: Request):
    """The bottle is empty. If the record says ml are still left, that liquor
    was poured without being sold (over-pouring, spillage, free drinks), so it's
    recorded as wastage and shows up in reports."""
    bottle = await db.get(OpenBottle, bottle_id)
    if not bottle or bottle.status != "open":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That bottle isn't open")
    item = await stock.lock_item(db, bottle.item_id)
    # A bottle the stock no longer covers is closed here, not counted as wastage.
    await bottles.fit_to_stock(db, item)
    if bottle.status != "open":
        await db.commit()
        return (await _summary(db, [item]))[0]
    unaccounted = bottle.remaining_ml
    if unaccounted > 0:
        stock.add_movement(db, item=item, qty=-unaccounted, type="wastage", user=actor,
                           reason=f"Open bottle empty with {stock.format_qty(item, unaccounted)} unaccounted: {body.reason}")
    bottle.remaining_ml = Decimal(0)
    bottle.status = "finished"
    bottle.finished_by = actor.id
    bottle.finished_at = datetime.now(timezone.utc)
    audit.record(db, user=actor, action="finish_bottle", entity="item", entity_id=item.id,
                 after={"name": item.name, "unaccounted": stock.format_qty(item, unaccounted), "reason": body.reason},
                 request=request)
    await db.commit()
    return (await _summary(db, [item]))[0]
