"""Reports for a range of business days: sales, rooms, costs, expenses, profit, stock."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import Date, case, cast, func, select, text

from app.api.deps import DB, require_any
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import (
    Booking,
    BookingCharge,
    BookingPayment,
    Category,
    Expense,
    ExpenseCategory,
    Item,
    Order,
    OrderLine,
    Payment,
    StockMovement,
    User,
)
from app.schemas.inventory import Num
from app.services import stock
from app.services.pins import has_permission
from app.services.rooms import folio as folio_of

router = APIRouter(prefix="/reports", tags=["reports"])

Viewer = Annotated[User, Depends(require_any("dashboard.view", "dashboard.profit"))]
StockViewer = Annotated[User, Depends(require_any("dashboard.view", "dashboard.profit", "catalogue.manage"))]
ZERO = Decimal(0)
SECTION_LABEL = {"bar": "Bar", "sundry": "Sundries", "food": "Kitchen", "other": "Other"}


class Amount(BaseModel):
    key: str
    label: str
    amount: Num
    count: int = 0


class TopItem(BaseModel):
    name: str
    qty: Num
    amount: Num


class Day(BaseModel):
    day: date
    sales: Num        # bills, before tax
    rooms: Num        # room income, before tax
    cost: Num | None  # cost of what was sold
    expenses: Num | None
    profit: Num | None


class Summary(BaseModel):
    start: date
    end: date
    # Bills (bar, kitchen, sundries, room service)
    bills: int
    gross_sales: Num
    discounts: Num
    service_charge: Num
    sales_tax: Num
    sales_total: Num        # what customers paid for bills
    sales_net: Num          # gross - discounts + service charge (before tax)
    by_section: list[Amount]
    tips: Num
    voids: int
    void_amount: Num
    # Rooms
    stays: int
    nights: Num
    room_income: Num        # room charges, extras and discounts, before tax
    room_tax: Num
    cancellation_income: Num
    # Money in by method (bills charged to a room are counted when the room pays)
    payments: list[Amount]
    expenses: Num
    expenses_by_category: list[Amount]
    top_items: list[TopItem]
    daily: list[Day]
    # Only with "Dashboard: profit and costs"
    cost_of_sales: Num | None
    wastage: Num | None
    stock_adjustments: Num | None  # count differences; negative = missing stock
    gross_profit: Num | None
    net_profit: Num | None


def _range(tz, start: date, end: date) -> tuple[datetime, datetime]:
    if end < start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The end date is before the start date")
    if (end - start).days > 366:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a year or less")
    return datetime.combine(start, time.min, tz), datetime.combine(end + timedelta(days=1), time.min, tz)


@router.get("/summary", response_model=Summary)
async def summary(actor: Viewer, db: DB, start: date | None = None, end: date | None = None):
    settings = await load_settings(db)
    tz_name = settings["timezone"]
    tz = business_tz(tz_name)
    end = end or datetime.now(tz).date()
    start = start or end
    lo, hi = _range(tz, start, end)
    show_profit = has_permission(actor, "dashboard.profit")
    local_day = lambda col: cast(func.timezone(tz_name, col), Date)

    paid = [Order.status == "paid", Order.closed_at >= lo, Order.closed_at < hi]

    # ---- Bills
    bills, gross, disc, service, tax, total, cost = (await db.execute(
        select(func.count(), func.coalesce(func.sum(Order.subtotal), 0), func.coalesce(func.sum(Order.discount_amount), 0),
               func.coalesce(func.sum(Order.service_charge), 0), func.coalesce(func.sum(Order.tax), 0),
               func.coalesce(func.sum(Order.total), 0), func.coalesce(func.sum(Order.cost_total), 0)).where(*paid)
    )).one()
    line_total = OrderLine.qty * OrderLine.unit_price
    sections = (await db.execute(
        select(Category.module, func.sum(line_total), func.count(func.distinct(Order.id)))
        .select_from(OrderLine).join(Order).join(Item, Item.id == OrderLine.item_id).join(Category)
        .where(*paid).group_by(Category.module)
    )).all()
    top = (await db.execute(
        select(OrderLine.name, func.sum(OrderLine.qty), func.sum(line_total))
        .join(Order).where(*paid).group_by(OrderLine.name).order_by(func.sum(line_total).desc()).limit(15)
    )).all()
    paid_ids = select(Order.id).where(*paid)
    tips = await db.scalar(select(func.coalesce(func.sum(Payment.tip), 0)).where(Payment.order_id.in_(paid_ids)))
    voids, void_amount = (await db.execute(
        select(func.count(), func.coalesce(func.sum(Order.total), 0))
        .where(Order.status == "void", Order.voided_at >= lo, Order.voided_at < hi)
    )).one()

    # ---- Rooms: stays are counted on the day they check out.
    out = [Booking.status == "checked_out", Booking.checked_out_at >= lo, Booking.checked_out_at < hi]
    stays, nights, room_charges = (await db.execute(
        select(func.count(), func.coalesce(func.sum(case((Booking.stay_type == "night", Booking.units_charged),
                                                          else_=0)), 0),
               func.coalesce(func.sum(Booking.room_charge), 0)).where(*out)
    )).one()
    stay_ids = select(Booking.id).where(*out)
    extras = await db.scalar(select(func.coalesce(func.sum(BookingCharge.amount), 0)).where(
        BookingCharge.booking_id.in_(stay_ids), BookingCharge.kind.in_(["extra", "discount"])))
    taxed = (await db.execute(select(Booking).where(*out))).scalars().all()
    room_tax = ZERO
    for b in taxed:
        room_tax += folio_of(b, tz_name).tax
    cancelled = await db.scalar(
        select(func.coalesce(func.sum(BookingCharge.amount), 0)).join(Booking)
        .where(Booking.status.in_(["cancelled", "no_show"]), Booking.updated_at >= lo, Booking.updated_at < hi,
               BookingCharge.kind == "extra")
    )
    room_income = Decimal(room_charges) + Decimal(extras)

    # ---- Money in, by method
    methods: dict[str, Decimal] = {}
    for m, amt in (await db.execute(
        select(Payment.method, func.sum(Payment.amount)).where(Payment.order_id.in_(paid_ids), Payment.method != "room")
        .group_by(Payment.method)
    )).all():
        methods[m] = methods.get(m, ZERO) + Decimal(amt)
    for m, kind, amt in (await db.execute(
        select(BookingPayment.method, BookingPayment.kind, func.sum(BookingPayment.amount))
        .where(BookingPayment.created_at >= lo, BookingPayment.created_at < hi)
        .group_by(BookingPayment.method, BookingPayment.kind)
    )).all():
        methods[m] = methods.get(m, ZERO) + (Decimal(amt) if kind == "payment" else -Decimal(amt))
    method_label = {"cash": "Cash", "card": "Card", "bank_transfer": "Bank transfer", "qr": "QR"}

    # ---- Expenses
    exp_rows = (await db.execute(
        select(ExpenseCategory.id, ExpenseCategory.name, func.sum(Expense.amount), func.count())
        .join(ExpenseCategory).where(Expense.is_void.is_(False), Expense.date >= start, Expense.date <= end)
        .group_by(ExpenseCategory.id, ExpenseCategory.name).order_by(func.sum(Expense.amount).desc())
    )).all()
    expenses = sum((Decimal(r[2]) for r in exp_rows), ZERO)

    # ---- Stock losses
    in_range = [StockMovement.created_at >= lo, StockMovement.created_at < hi]
    wastage = -Decimal(await db.scalar(select(func.coalesce(func.sum(StockMovement.qty * StockMovement.unit_cost), 0))
                                       .where(StockMovement.type == "wastage", *in_range)))
    adjust = Decimal(await db.scalar(select(func.coalesce(func.sum(StockMovement.qty * StockMovement.unit_cost), 0))
                                     .where(StockMovement.type == "count_adjust", *in_range)))

    # ---- Day by day
    days: dict[date, dict[str, Decimal]] = {}
    def bucket(d: date) -> dict[str, Decimal]:
        return days.setdefault(d, {"sales": ZERO, "rooms": ZERO, "cost": ZERO, "expenses": ZERO, "loss": ZERO})
    for d, net, c in (await db.execute(
        select(local_day(Order.closed_at), func.sum(Order.subtotal - Order.discount_amount + Order.service_charge),
               func.sum(Order.cost_total)).where(*paid).group_by(text("1"))
    )).all():
        bucket(d)["sales"] += Decimal(net)
        bucket(d)["cost"] += Decimal(c)
    for b in taxed:
        f = folio_of(b, tz_name)
        bucket(b.checked_out_at.astimezone(tz).date())["rooms"] += f.room_charge + f.extras + f.discounts
    for d, amt in (await db.execute(
        select(Expense.date, func.sum(Expense.amount)).where(Expense.is_void.is_(False), Expense.date >= start,
                                                            Expense.date <= end).group_by(Expense.date)
    )).all():
        bucket(d)["expenses"] += Decimal(amt)
    for d, v in (await db.execute(
        select(local_day(StockMovement.created_at), func.sum(StockMovement.qty * StockMovement.unit_cost))
        .where(StockMovement.type.in_(["wastage", "count_adjust"]), *in_range)
        .group_by(text("1"))
    )).all():
        bucket(d)["loss"] -= Decimal(v)
    daily = []
    d = start
    while d <= end:
        x = days.get(d, {"sales": ZERO, "rooms": ZERO, "cost": ZERO, "expenses": ZERO, "loss": ZERO})
        profit = x["sales"] - x["cost"] + x["rooms"] - x["expenses"] - x["loss"]
        daily.append(Day(day=d, sales=x["sales"], rooms=x["rooms"], cost=x["cost"] if show_profit else None,
                         expenses=x["expenses"], profit=profit if show_profit else None))
        d += timedelta(days=1)

    sales_net = Decimal(gross) - Decimal(disc) + Decimal(service)
    gross_profit = sales_net - Decimal(cost)
    net_profit = gross_profit + room_income + Decimal(cancelled) - wastage + adjust - expenses
    return Summary(
        start=start, end=end, bills=bills, gross_sales=gross, discounts=disc, service_charge=service, sales_tax=tax,
        sales_total=total, sales_net=sales_net,
        by_section=[Amount(key=m, label=SECTION_LABEL.get(m, m), amount=a, count=n)
                    for m, a, n in sorted(sections, key=lambda r: -r[1])],
        tips=tips, voids=voids, void_amount=void_amount,
        stays=stays, nights=nights, room_income=room_income, room_tax=room_tax, cancellation_income=cancelled,
        payments=[Amount(key=m, label=method_label.get(m, m), amount=a) for m, a in
                  sorted(methods.items(), key=lambda kv: -kv[1]) if a],
        expenses=expenses,
        expenses_by_category=[Amount(key=str(i), label=n, amount=a, count=c) for i, n, a, c in exp_rows],
        top_items=[TopItem(name=n, qty=q, amount=a) for n, q, a in top],
        daily=daily,
        cost_of_sales=cost if show_profit else None,
        wastage=wastage if show_profit else None,
        stock_adjustments=adjust if show_profit else None,
        gross_profit=gross_profit if show_profit else None,
        net_profit=net_profit if show_profit else None,
    )


# ---- Stock movement report -------------------------------------------------------------

class StockRow(BaseModel):
    item_id: int
    name: str
    category: str
    unit: str
    opening: str
    received: str
    sold: str
    wasted: str
    adjusted: str
    other: str
    closing: str
    closing_qty: Num
    closing_value: Num | None
    wastage_value: Num | None
    low: bool


GROUPS = {
    "received": ("opening", "purchase", "purchase_void"),
    "sold": ("sale", "void_reversal"),
    "wasted": ("wastage",),
    "adjusted": ("count_adjust",),
}


@router.get("/stock", response_model=list[StockRow])
async def stock_report(actor: StockViewer, db: DB, start: date | None = None, end: date | None = None):
    """Per item: stock at the start, what came in, what was sold, wasted or
    corrected by a count, and what's left at the end of the range."""
    tz = business_tz((await load_settings(db))["timezone"])
    end = end or datetime.now(tz).date()
    start = start or end
    lo, hi = _range(tz, start, end)
    show_value = has_permission(actor, "dashboard.profit") or has_permission(actor, "catalogue.manage")

    items = list(await db.scalars(
        select(Item).join(Category).where(Item.track_stock.is_(True), Item.kind != "build_assembly")
        .order_by(Category.name, Item.name)
    ))
    before = dict((await db.execute(
        select(StockMovement.item_id, func.sum(StockMovement.qty)).where(StockMovement.created_at < lo)
        .group_by(StockMovement.item_id)
    )).all())
    during: dict[int, dict[str, Decimal]] = {}
    wasted_value: dict[int, Decimal] = {}
    for item_id, typ, qty, value in (await db.execute(
        select(StockMovement.item_id, StockMovement.type, func.sum(StockMovement.qty),
               func.sum(StockMovement.qty * StockMovement.unit_cost))
        .where(StockMovement.created_at >= lo, StockMovement.created_at < hi)
        .group_by(StockMovement.item_id, StockMovement.type)
    )).all():
        group = next((g for g, types in GROUPS.items() if typ in types), "other")
        row = during.setdefault(item_id, {})
        row[group] = row.get(group, ZERO) + Decimal(qty)
        if typ == "wastage":
            wasted_value[item_id] = wasted_value.get(item_id, ZERO) - Decimal(value)

    out = []
    for it in items:
        if not it.is_active and it.id not in during and not before.get(it.id):
            continue
        opening = Decimal(before.get(it.id) or 0)
        g = during.get(it.id, {})
        closing = opening + sum(g.values(), ZERO)
        def fmt(q: Decimal, it: Item = it) -> str:
            return stock.format_qty(it, q) if q else "—"

        out.append(StockRow(
            item_id=it.id, name=it.name, category=it.category.name, unit=it.stock_unit,
            opening=stock.format_qty(it, opening), received=fmt(g.get("received", ZERO)),
            sold=fmt(-g.get("sold", ZERO)), wasted=fmt(-g.get("wasted", ZERO)), adjusted=fmt(g.get("adjusted", ZERO)),
            other=fmt(g.get("other", ZERO)), closing=stock.format_qty(it, closing), closing_qty=closing,
            closing_value=(closing * it.avg_cost).quantize(Decimal("0.01")) if show_value else None,
            wastage_value=wasted_value.get(it.id, ZERO).quantize(Decimal("0.01")) if show_value else None,
            low=bool(it.reorder_level) and closing < it.reorder_level * it.unit_size,
        ))
    return out
