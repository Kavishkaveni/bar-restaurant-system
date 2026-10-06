"""Recipes: what a dish uses per portion, or what a batch item uses per batch."""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item, RecipeLine

ZERO = Decimal(0)


def unit_cost(item: Item) -> Decimal:
    """Cost of one base unit (1 g, 1 ml, 1 piece). Tracked items use the
    average purchase cost; untracked ones (salt, spices) the last price."""
    if item.track_stock and item.avg_cost > 0:
        return item.avg_cost
    return item.cost_price / item.unit_size


async def lines_of(db: AsyncSession, item_id: int) -> list[RecipeLine]:
    return list(
        await db.scalars(
            select(RecipeLine).where(RecipeLine.item_id == item_id).order_by(RecipeLine.sort_order, RecipeLine.id)
        )
    )


def cost_of(lines: list[RecipeLine]) -> Decimal:
    return sum((line.qty * unit_cost(line.component) for line in lines), ZERO)


def portions_available(lines: list[RecipeLine], on_hand: dict[int, Decimal]) -> Decimal | None:
    """How many portions the tracked ingredients allow; None if nothing is tracked."""
    counts = [
        on_hand.get(line.component_id, ZERO) / line.qty
        for line in lines
        if line.component.track_stock
    ]
    return min(counts) if counts else None
