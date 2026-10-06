"""What should be in the cash drawer for a shift.

Everything is matched by time: there's one drawer and only one open shift,
so cash taken between a shift's open and close went into that drawer.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BookingPayment, Expense, Order, Payment, Shift

ZERO = Decimal(0)


@dataclass
class DrawerCount:
    opening_float: Decimal
    cash_sales: Decimal        # cash taken on bills (including cash tips)
    cash_refunds: Decimal      # cash bills voided during the shift
    room_cash: Decimal         # room advances and check-out payments in cash
    room_refunds: Decimal      # advances given back in cash
    paid_out: Decimal          # expenses paid from the drawer
    cash_in: Decimal
    cash_out: Decimal
    expected: Decimal


async def count(db: AsyncSession, shift: Shift, until: datetime | None = None) -> DrawerCount:
    start = shift.opened_at
    end = shift.closed_at or until or datetime.now(timezone.utc)
    in_window = lambda col: [col >= start, col <= end]

    cash_sales = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount + Payment.tip), 0)).where(
            Payment.method == "cash", *in_window(Payment.created_at)
        )
    )
    # A voided bill's cash goes back to the customer when it's voided.
    cash_refunds = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount + Payment.tip), 0))
        .join(Order, Order.id == Payment.order_id)
        .where(Payment.method == "cash", Order.status == "void", *in_window(Order.voided_at))
    )
    room = dict(
        (
            await db.execute(
                select(BookingPayment.kind, func.coalesce(func.sum(BookingPayment.amount), 0))
                .where(BookingPayment.method == "cash", *in_window(BookingPayment.created_at))
                .group_by(BookingPayment.kind)
            )
        ).all()
    )
    paid_out = await db.scalar(
        select(func.coalesce(func.sum(Expense.amount), 0)).where(
            Expense.shift_id == shift.id, Expense.is_void.is_(False)
        )
    )
    cash_in = sum((m.amount for m in shift.movements if m.kind == "in"), ZERO)
    cash_out = sum((m.amount for m in shift.movements if m.kind == "out"), ZERO)

    room_cash, room_refunds = Decimal(room.get("payment", 0)), Decimal(room.get("refund", 0))
    expected = (
        shift.opening_float + Decimal(cash_sales) - Decimal(cash_refunds) + room_cash - room_refunds
        - Decimal(paid_out) + cash_in - cash_out
    )
    return DrawerCount(
        opening_float=shift.opening_float, cash_sales=Decimal(cash_sales), cash_refunds=Decimal(cash_refunds),
        room_cash=room_cash, room_refunds=room_refunds, paid_out=Decimal(paid_out), cash_in=cash_in,
        cash_out=cash_out, expected=expected,
    )


async def current(db: AsyncSession, lock: bool = False) -> Shift | None:
    stmt = select(Shift).where(Shift.status == "open")
    if lock:
        stmt = stmt.with_for_update()
    return await db.scalar(stmt)
