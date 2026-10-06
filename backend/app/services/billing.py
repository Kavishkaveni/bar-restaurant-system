"""Bill maths and the two moments that touch stock: closing and voiding."""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, StockMovement, User
from app.services import stock

CENT = Decimal("0.01")
ZERO = Decimal("0")


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
    """Mark a fully paid bill as paid, store its totals and take its stock out."""
    t = totals(order)
    cost_total = ZERO
    for line in order.lines:
        item = line.item
        qty_base = line.qty * line.deduct_per_unit
        if item.track_stock:
            unit_cost = item.avg_cost
            stock.add_movement(
                db, item=item, qty=-qty_base, type="sale", user=user, unit_cost=unit_cost,
                ref_type="order", ref_id=order.id, reason=line.name,
            )
        else:
            unit_cost = item.cost_price / item.unit_size  # untracked: last purchase price
        line.cost_total = money(qty_base * unit_cost)
        cost_total += line.cost_total

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
    """Put back the stock a paid bill took out, at the same cost."""
    sales = await db.scalars(
        select(StockMovement).where(
            StockMovement.ref_type == "order", StockMovement.ref_id == order.id, StockMovement.type == "sale"
        )
    )
    items = {line.item_id: line.item for line in order.lines}
    for m in sales:
        stock.add_movement(
            db, item=items[m.item_id], qty=-m.qty, type="void_reversal", user=user, unit_cost=m.unit_cost,
            ref_type="order", ref_id=order.id, reason=f"Bill #{order.id} voided: {reason}",
        )
