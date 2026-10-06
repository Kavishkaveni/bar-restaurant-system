"""Bill maths and the two moments that touch stock: closing and voiding."""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item, Order, StockMovement, User
from app.services import bottles, recipes, stock

CENT = Decimal("0.01")
ZERO = Decimal(0)


def money(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class Totals:
    subtotal: Decimal
    discount: Decimal
    service_charge: Decimal
    tax: Decimal
    total: Decimal
    paid: Decimal
    due: Decimal
    tips: Decimal


def totals(order: Order) -> Totals:
    """Discount comes off first, service charge is on the discounted amount,
    and tax is on the discounted amount plus service charge."""
    subtotal = money(sum((line.line_total for line in order.lines), ZERO))
    if order.discount_type == "percent":
        discount = money(subtotal * order.discount_value / 100)
    elif order.discount_type == "amount":
        discount = min(order.discount_value, subtotal)
    else:
        discount = ZERO
    after = subtotal - discount
    service = money(after * order.service_charge_percent / 100)
    tax = money((after + service) * order.tax_percent / 100)
    total = after + service + tax
    paid = sum((p.amount for p in order.payments), ZERO)
    tips = sum((p.tip for p in order.payments), ZERO)
    return Totals(subtotal, discount, service, tax, total, paid, max(total - paid, ZERO), tips)


async def close(db: AsyncSession, order: Order, user: User) -> None:
    """Mark a fully paid bill as paid, store its totals and take its stock out.

    - A stocked item sold whole or by option: its own stock goes down.
    - A peg (part of a bottle): poured from open bottles, then stock goes down.
    - A dish (recipe): each tracked ingredient goes down by recipe x qty.
    Cost is recorded per line at today's average cost, for profit reports."""
    t = totals(order)

    # Work out every base-unit deduction first, grouped per item, so pegs of
    # the same liquor on several lines are poured from bottles in one go.
    takes: dict[int, tuple[Item, Decimal]] = {}
    pours: dict[int, tuple[Item, Decimal]] = {}
    cost_total = ZERO
    for line in order.lines:
        item = line.item
        if item.kind == "build_assembly":
            lines = await recipes.lines_of(db, item.id)
            line.cost_total = money(line.qty * recipes.cost_of(lines))
            for r in lines:
                if r.component.track_stock:
                    prev = takes.get(r.component_id, (r.component, ZERO))[1]
                    takes[r.component_id] = (r.component, prev + line.qty * r.qty)
        else:
            qty_base = line.qty * line.deduct_per_unit
            line.cost_total = money(qty_base * recipes.unit_cost(item))
            if item.track_stock:
                prev = takes.get(item.id, (item, ZERO))[1]
                takes[item.id] = (item, prev + qty_base)
                if bottles.pours_from_bottle(item, line.deduct_per_unit):
                    prev = pours.get(item.id, (item, ZERO))[1]
                    pours[item.id] = (item, prev + qty_base)
        cost_total += line.cost_total

    for item, ml in pours.values():
        await bottles.pour(db, item, ml, user)
    for item, qty in takes.values():
        stock.add_movement(
            db, item=item, qty=-qty, type="sale", user=user, unit_cost=recipes.unit_cost(item),
            ref_type="order", ref_id=order.id, reason=f"Bill #{order.id}",
        )

    order.subtotal = t.subtotal
    order.discount_amount = t.discount
    order.service_charge = t.service_charge
    order.tax = t.tax
    order.total = t.total
    order.cost_total = cost_total
    order.status = "paid"
    order.closed_by = user.id
    order.closed_at = datetime.now(timezone.utc)


async def reverse_stock(db: AsyncSession, order: Order, user: User, reason: str) -> None:
    """Put back the stock a paid bill took out (items and recipe ingredients),
    at the same cost, and pour pegs back into the open bottle."""
    sales = list(
        await db.scalars(
            select(StockMovement).where(
                StockMovement.ref_type == "order", StockMovement.ref_id == order.id, StockMovement.type == "sale"
            )
        )
    )
    for m in sales:
        item = await db.get(Item, m.item_id)
        stock.add_movement(
            db, item=item, qty=-m.qty, type="void_reversal", user=user, unit_cost=m.unit_cost,
            ref_type="order", ref_id=order.id, reason=f"Bill #{order.id} voided: {reason}",
        )
    for line in order.lines:
        if line.item.kind != "build_assembly" and bottles.pours_from_bottle(line.item, line.deduct_per_unit):
            await bottles.put_back(db, line.item, line.qty * line.deduct_per_unit)
