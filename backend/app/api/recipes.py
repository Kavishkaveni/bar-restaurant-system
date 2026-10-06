"""Recipes for dishes and batch items, and making batches."""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete

from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.api.pos import POS_USERS
from app.api.settings import load_settings
from app.models import Item, RecipeLine, User
from app.schemas.inventory import ProduceIn, RecipeIn, RecipeLineOut, RecipeOut
from app.services import audit, recipes, stock

router = APIRouter(prefix="/items/{item_id}", tags=["recipes"])

Manager = Annotated[User, Depends(require("catalogue.manage"))]


async def _item(db: DB, item_id: int) -> Item:
    item = await db.get(Item, item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return item


async def build(db: DB, item: Item) -> RecipeOut:
    lines = await recipes.lines_of(db, item.id)
    on_hand = await stock.on_hand(db, [r.component_id for r in lines])
    overhead = Decimal(str((await load_settings(db)).get("overhead_percent", 0)))
    ingredient_cost = recipes.cost_of(lines)

    if item.kind == "build_assembly":
        total = (ingredient_cost * (1 + overhead / 100)).quantize(Decimal("0.01"))
        price = item.selling_price
        margin = (price - total) if price is not None else None
        pct = (margin / price * 100).quantize(Decimal("0.1")) if price else None
        portions = recipes.portions_available(lines, on_hand)
    else:
        total, price, margin, pct, portions = ingredient_cost.quantize(Decimal("0.01")), None, None, None, None

    return RecipeOut(
        item_id=item.id,
        kind=item.kind,
        lines=[
            RecipeLineOut(
                id=r.id,
                component=r.component,
                qty=r.qty,
                qty_display=stock.format_qty(r.component, r.qty),
                cost=(r.qty * recipes.unit_cost(r.component)).quantize(Decimal("0.01")),
                on_hand_display=(
                    stock.format_qty(r.component, on_hand[r.component_id]) if r.component.track_stock else "Not tracked"
                ),
            )
            for r in lines
        ],
        ingredient_cost=ingredient_cost.quantize(Decimal("0.01")),
        overhead_percent=overhead if item.kind == "build_assembly" else Decimal(0),
        total_cost=total,
        selling_price=price,
        margin=margin,
        margin_percent=pct,
        batch_yield=item.batch_yield,
        batch_yield_display=stock.format_qty(item, item.batch_yield) if item.batch_yield else None,
        portions_available=portions.quantize(Decimal("1."), rounding="ROUND_FLOOR") if portions is not None else None,
    )


@router.get("/recipe", response_model=RecipeOut)
async def get_recipe(item_id: int, _: Annotated[User, Depends(require_any(*STOCK_VIEWERS, *POS_USERS, "kitchen.view"))], db: DB):
    return await build(db, await _item(db, item_id))


@router.put("/recipe", response_model=RecipeOut)
async def save_recipe(item_id: int, body: RecipeIn, actor: Manager, db: DB, request: Request):
    item = await _item(db, item_id)
    if item.kind == "final_product" and body.lines and not body.batch_yield:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say how much one batch makes")
    if item.kind == "final_product" and body.lines and not item.track_stock:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Batch items must track stock")

    seen: set[int] = set()
    lines: list[RecipeLine] = []
    for i, line in enumerate(body.lines):
        if line.component_id == item.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "An item can't be an ingredient of itself")
        if line.component_id in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Each ingredient can only appear once; add the amounts together")
        seen.add(line.component_id)
        comp = await db.get(Item, line.component_id)
        if not comp or not comp.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ingredient #{line.component_id} not found")
        if comp.kind == "build_assembly":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{comp.name} is a dish. Use stocked ingredients; for a shared mix, make it a batch item.",
            )
        lines.append(RecipeLine(item_id=item.id, component_id=comp.id, qty=line.qty, sort_order=i))

    before = [f"{r.component.name} {stock.format_qty(r.component, r.qty)}" for r in await recipes.lines_of(db, item.id)]
    await db.execute(delete(RecipeLine).where(RecipeLine.item_id == item.id))
    db.add_all(lines)
    if item.kind == "final_product":
        item.batch_yield = body.batch_yield if body.lines else None
    await db.flush()
    after = [f"{r.component.name} {stock.format_qty(r.component, r.qty)}" for r in await recipes.lines_of(db, item.id)]
    audit.record(db, user=actor, action="recipe", entity="item", entity_id=item.id,
                 before={"name": item.name, "recipe": before}, after={"name": item.name, "recipe": after},
                 request=request)
    await db.commit()
    return await build(db, item)


@router.post("/produce", response_model=RecipeOut)
async def produce(item_id: int, body: ProduceIn, actor: Manager, db: DB, request: Request):
    """Make batches of an in-house item (e.g. Spice Mix): the ingredients go
    down and the item goes up, valued at what the ingredients cost."""
    item = await stock.lock_item(db, item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    lines = await recipes.lines_of(db, item.id)
    if item.kind != "final_product" or not lines or not item.batch_yield:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{item.name} has no batch recipe")

    reason = f"Made {body.batches} batch{'es' if body.batches != 1 else ''} of {item.name}"
    if body.note:
        reason += f": {body.note}"
    total_cost = Decimal(0)
    for r in lines:
        used = r.qty * body.batches
        cost = recipes.unit_cost(r.component)
        total_cost += used * cost
        if r.component.track_stock:
            stock.add_movement(db, item=r.component, qty=-used, type="production", user=actor, unit_cost=cost,
                               ref_type="production", ref_id=item.id, reason=reason)
    made = item.batch_yield * body.batches
    await stock.receive(db, item=item, qty=made, cost_per_base=total_cost / made, type="production", user=actor,
                        ref_type="production", ref_id=item.id, reason=reason)
    audit.record(db, user=actor, action="produce", entity="item", entity_id=item.id,
                 after={"name": item.name, "made": stock.format_qty(item, made), "cost": float(total_cost)},
                 request=request)
    await db.commit()
    return await build(db, item)
