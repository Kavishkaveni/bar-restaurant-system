"""The stock ledger: the only place that writes stock movements.

Rules
- Quantities are stored in the item's base unit (ml, g, piece), signed:
  positive adds stock, negative removes it.
- Current stock = SUM(qty) of the item's movements.
- Incoming stock with a cost updates the item's weighted average cost.
- Callers own the transaction: these functions add rows; the caller commits.
"""

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item, StockMovement, User

ZERO = Decimal(0)


async def on_hand(db: AsyncSession, item_ids: Iterable[int]) -> dict[int, Decimal]:
    ids = list(item_ids)
    if not ids:
        return {}
    rows = await db.execute(
        select(StockMovement.item_id, func.coalesce(func.sum(StockMovement.qty), 0))
        .where(StockMovement.item_id.in_(ids))
        .group_by(StockMovement.item_id)
    )
    totals = {item_id: Decimal(total) for item_id, total in rows}
    return {i: totals.get(i, ZERO) for i in ids}


async def has_movements(db: AsyncSession, item_id: int) -> bool:
    return bool(await db.scalar(select(StockMovement.id).where(StockMovement.item_id == item_id).limit(1)))


async def lock_item(db: AsyncSession, item_id: int) -> Item | None:
    """Lock the item row so two purchases can't update its average cost at once."""
    return await db.scalar(select(Item).where(Item.id == item_id).with_for_update())


def add_movement(
    db: AsyncSession,
    *,
    item: Item,
    qty: Decimal,
    type: str,
    user: User | None,
    unit_cost: Decimal | None = None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    reason: str = "",
) -> StockMovement:
    movement = StockMovement(
        item_id=item.id,
        qty=qty,
        unit_cost=item.avg_cost if unit_cost is None else unit_cost,
        type=type,
        ref_type=ref_type,
        ref_id=ref_id,
        reason=reason,
        user_id=user.id if user else None,
    )
    db.add(movement)
    return movement


async def receive(
    db: AsyncSession,
    *,
    item: Item,
    qty: Decimal,
    cost_per_base: Decimal,
    type: str,
    user: User | None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    reason: str = "",
) -> StockMovement:
    """Add stock that has a cost (opening stock, purchases) and update the
    weighted average cost. `item` must have been locked with lock_item()."""
    current = (await on_hand(db, [item.id]))[item.id]
    if current > 0 and item.avg_cost > 0:
        item.avg_cost = (current * item.avg_cost + qty * cost_per_base) / (current + qty)
    else:
        # No stock (or negative stock from earlier sales): the new cost is the cost.
        item.avg_cost = cost_per_base
    return add_movement(
        db, item=item, qty=qty, type=type, user=user, unit_cost=cost_per_base,
        ref_type=ref_type, ref_id=ref_id, reason=reason,
    )


async def unreceive(
    db: AsyncSession,
    *,
    item: Item,
    qty: Decimal,
    cost_per_base: Decimal,
    type: str,
    user: User | None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    reason: str = "",
) -> StockMovement:
    """Take back stock that was received at a known cost (a cancelled purchase)
    and undo its effect on the average cost where possible. `item` must be locked."""
    current = (await on_hand(db, [item.id]))[item.id]
    remaining = current - qty
    if remaining > 0:
        backed_out = (current * item.avg_cost - qty * cost_per_base) / remaining
        # If some of that stock was already used, the maths can go negative;
        # then keep the current average rather than invent a cost.
        if backed_out > 0:
            item.avg_cost = backed_out
    return add_movement(
        db, item=item, qty=-qty, type=type, user=user, unit_cost=cost_per_base,
        ref_type=ref_type, ref_id=ref_id, reason=reason,
    )


def to_base(item: Item, qty_in_stock_units: Decimal) -> Decimal:
    return qty_in_stock_units * item.unit_size


def _trim(value: Decimal, places: int = 3) -> str:
    q = value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP).normalize()
    text = f"{q:f}"
    return text


def _plural(word: str, n: Decimal) -> str:
    return word if n == 1 else (word + "es" if word.endswith(("ch", "sh", "s", "x")) else word + "s")


BASE_LABEL = {"ml": "ml", "g": "g", "piece": "pcs"}


def format_qty(item: Item, qty: Decimal) -> str:
    """Human-readable stock, e.g. '12 bottles + 300 ml', '3 packs + 7 pcs', '8.25 kg'."""
    sign = "-" if qty < 0 else ""
    q = abs(qty)
    size = item.unit_size
    unit = item.stock_unit

    if size == 1:
        return f"{sign}{_trim(q)} {_plural(unit, q) if unit != BASE_LABEL[item.base_unit] else unit}"

    # Measured goods (kg of rice, litres of oil) read best as a decimal.
    if unit in ("kg", "litre", "l"):
        n = q / size
        return f"{sign}{_trim(n, 3)} {unit if unit == 'kg' else _plural(unit, n)}"

    whole = (q // size)
    rest = q - whole * size
    parts = []
    if whole:
        parts.append(f"{_trim(whole)} {_plural(unit, whole)}")
    if rest:
        parts.append(f"{_trim(rest)} {BASE_LABEL[item.base_unit]}")
    return sign + (" + ".join(parts) if parts else f"0 {_plural(unit, ZERO)}")
