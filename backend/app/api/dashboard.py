"""The owner's dashboard: today at a glance, compared with yesterday, plus the last 30 days."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Integer, cast, extract, func, select, text

from app.api.deps import DB, require_any
from app.api.orders import label
from app.api.reports import Amount, Day, summary
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import Booking, Item, Order, OrderLine, Room, User
from app.schemas.inventory import Num
from app.services import billing, drawer, stock
from app.services.pins import has_permission

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

Viewer = Annotated[User, Depends(require_any("dashboard.view", "dashboard.profit"))]
ZERO = Decimal(0)


class Today(BaseModel):
    sales: Num            # bills before tax
    bills: int
    average_bill: Num
    rooms: Num            # room income (checked out today)
    money_in: Num
    expenses: Num
    cost: Num | None
    profit: Num | None
    # Same moment yesterday, for a fair comparison.
    sales_yesterday: Num
    bills_yesterday: int


class Hour(BaseModel):
    hour: int
    today: Num | None   # None for hours still to come
    yesterday: Num


class RoomsNow(BaseModel):
    total: int
    occupied: int
    arriving: int
    leaving: int
    to_clean: int
    maintenance: int


class LowItem(BaseModel):
    id: int
    name: str
    on_hand: str
    reorder_at: str


class RecentBill(BaseModel):
    id: int
    label: str
    total: Num
    closed_at: datetime
    methods: list[str]


class Dashboard(BaseModel):
    day: date
    updated_at: datetime
    today: Today
    hourly: list[Hour]
    trend: list[Day]
    sections: list[Amount]
    payments: list[Amount]
    rooms: RoomsNow
    open_bills: int
    open_total: Num
    kitchen: dict[str, int]
    low_stock: list[LowItem]
    low_stock_count: int
    drawer_expected: Num | None
    drawer_open_since: datetime | None
    recent: list[RecentBill]


@router.get("", response_model=Dashboard)
async def dashboard(actor: Viewer, db: DB):
    tz_name = (await load_settings(db))["timezone"]
    tz = business_tz(tz_name)
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date()
    day_start = datetime.combine(today, time.min, tz)
    yday_start = day_start - timedelta(days=1)
    show_profit = has_permission(actor, "dashboard.profit")

    s = await summary(actor, db, today, today)
    trend = (await summary(actor, db, today - timedelta(days=29), today)).daily

    # ---- yesterday up to this moment, and sales by hour
    net = Order.subtotal - Order.discount_amount + Order.service_charge
    y_sales, y_bills = (await db.execute(
        select(func.coalesce(func.sum(net), 0), func.count()).where(
            Order.status == "paid", Order.closed_at >= yday_start, Order.closed_at < now - timedelta(days=1))
    )).one()
    hour_of = cast(extract("hour", func.timezone(tz_name, Order.closed_at)), Integer)
    by_hour: dict[tuple[bool, int], Decimal] = {}
    for is_today, h, amount in (await db.execute(
        select(Order.closed_at >= day_start, hour_of, func.sum(net))
        .where(Order.status == "paid", Order.closed_at >= yday_start, Order.closed_at < day_start + timedelta(days=1))
        .group_by(text("1"), text("2"))
    )).all():
        by_hour[(is_today, h)] = Decimal(amount)
    current_hour = now.astimezone(tz).hour
    hourly = [
        Hour(hour=h, today=by_hour.get((True, h), ZERO) if h <= current_hour else None,
             yesterday=by_hour.get((False, h), ZERO))
        for h in range(24)
    ]

    # ---- rooms right now
    rooms = list(await db.scalars(select(Room).where(Room.is_active.is_(True))))
    live = list(await db.scalars(select(Booking).where(Booking.status.in_(["booked", "checked_in"]))))
    day_end = day_start + timedelta(days=1)
    rooms_now = RoomsNow(
        total=len(rooms),
        occupied=sum(1 for b in live if b.status == "checked_in"),
        arriving=sum(1 for b in live if b.status == "booked" and b.arrival < day_end),
        leaving=sum(1 for b in live if b.status == "checked_in" and b.departure < day_end),
        to_clean=sum(1 for r in rooms if r.housekeeping == "dirty"),
        maintenance=sum(1 for r in rooms if r.housekeeping == "maintenance"),
    )

    # ---- service right now
    open_orders = list(await db.scalars(select(Order).where(Order.status == "open")))
    kitchen = dict((await db.execute(
        select(OrderLine.kitchen_status, func.count()).join(Order)
        .where(OrderLine.kitchen_status.in_(["new", "preparing", "ready"]), Order.status.in_(["open", "paid"]))
        .group_by(OrderLine.kitchen_status)
    )).all())

    # ---- stock running low
    tracked = list(await db.scalars(
        select(Item).where(Item.is_active.is_(True), Item.track_stock.is_(True), Item.reorder_level > 0,
                           Item.kind != "build_assembly")
    ))
    qty = await stock.on_hand(db, [i.id for i in tracked])
    low = sorted(
        (i for i in tracked if qty[i.id] < i.reorder_level * i.unit_size),
        key=lambda i: qty[i.id] / (i.reorder_level * i.unit_size),
    )

    shift = await drawer.current(db)
    expected = (await drawer.count(db, shift)).expected if shift else None

    recent = list(await db.scalars(
        select(Order).where(Order.status == "paid").order_by(Order.closed_at.desc()).limit(6)
    ))

    money_in = sum((p.amount for p in s.payments), ZERO)
    return Dashboard(
        day=today,
        updated_at=now,
        today=Today(
            sales=s.sales_net, bills=s.bills,
            average_bill=(s.sales_total / s.bills).quantize(Decimal("0.01")) if s.bills else ZERO,
            rooms=s.room_income + s.cancellation_income, money_in=money_in, expenses=s.expenses,
            cost=s.cost_of_sales if show_profit else None, profit=s.net_profit if show_profit else None,
            sales_yesterday=y_sales, bills_yesterday=y_bills,
        ),
        hourly=hourly,
        trend=trend,
        sections=s.by_section,
        payments=s.payments,
        rooms=rooms_now,
        open_bills=len(open_orders),
        open_total=sum((billing.totals(o).total for o in open_orders), ZERO),
        kitchen={k: kitchen.get(k, 0) for k in ("new", "preparing", "ready")},
        low_stock=[LowItem(id=i.id, name=i.name, on_hand=stock.format_qty(i, qty[i.id]),
                           reorder_at=stock.format_qty(i, i.reorder_level * i.unit_size)) for i in low[:8]],
        low_stock_count=len(low),
        drawer_expected=expected,
        drawer_open_since=shift.opened_at if shift else None,
        recent=[RecentBill(id=o.id, label=label(o), total=o.total, closed_at=o.closed_at,
                           methods=sorted({p.method for p in o.payments})) for o in recent],
    )
