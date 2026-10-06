"""Orders, from the first item to the paid (or voided) bill."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, require, require_any
from app.api.pos import POS_USERS
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import DiningTable, Item, Order, OrderLine, Payment, SellOption, User
from app.schemas.pos import (
    BillsPage,
    DiscountIn,
    LineAdd,
    LineRemove,
    LineUpdate,
    MergeIn,
    MethodTotal,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    PaymentIn,
    SplitIn,
    VoidIn,
)
from app.services import audit, billing
from app.services.pins import Approval, authorize

router = APIRouter(prefix="/orders", tags=["orders"])

Waiter = Annotated[User, Depends(require("pos.order"))]
Cashier = Annotated[User, Depends(require("pos.payment"))]
PosUser = Annotated[User, Depends(require_any(*POS_USERS))]

APPROVE = "pos.discount_void"
ZERO = Decimal(0)


# ---- Helpers ----------------------------------------------------------------------

def label(order: Order) -> str:
    if order.type == "table" and order.table:
        return order.table.name
    if order.type == "tab":
        return f"Tab: {order.customer_name}"
    base = "Bar" if order.type == "bar" else "Takeaway"
    return f"{base} · {order.customer_name}" if order.customer_name else f"{base} #{order.id}"


def to_out(order: Order) -> OrderOut:
    t = billing.totals(order)
    return OrderOut(
        id=order.id,
        type=order.type,
        label=label(order),
        table=order.table,
        customer_name=order.customer_name,
        note=order.note,
        status=order.status,
        service_charge_percent=order.service_charge_percent,
        tax_percent=order.tax_percent,
        discount_type=order.discount_type,
        discount_value=order.discount_value,
        discount_reason=order.discount_reason,
        subtotal=t.subtotal,
        discount=t.discount,
        service_charge=t.service_charge,
        tax=t.tax,
        total=t.total,
        paid=t.paid,
        due=t.due,
        tips=t.tips,
        item_count=sum((line.qty for line in order.lines), ZERO),
        printed_count=order.printed_count,
        receipt_count=order.receipt_count,
        opener=order.opener,
        closer=order.closer,
        created_at=order.created_at,
        closed_at=order.closed_at,
        void_reason=order.void_reason,
        merged_into=order.merged_into,
        lines=order.lines,
        payments=order.payments,
    )


def _query():
    return select(Order).options(
        selectinload(Order.lines).selectinload(OrderLine.item),
        selectinload(Order.payments).selectinload(Payment.user),
        selectinload(Order.table),
        selectinload(Order.opener),
        selectinload(Order.closer),
    )


async def load(db: DB, order_id: int, lock: bool = False) -> Order:
    stmt = _query().where(Order.id == order_id).execution_options(populate_existing=True)
    if lock:
        # Two tills paying the same bill at once must not both succeed.
        stmt = stmt.with_for_update(of=Order)
    order = await db.scalar(stmt)
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bill not found")
    return order


def ensure_open(order: Order) -> None:
    if order.status != "open":
        word = {"paid": "already paid", "void": "voided", "merged": f"merged into bill #{order.merged_into}"}
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This bill is {word.get(order.status, order.status)}")


async def respond(db: DB, order_id: int) -> OrderOut:
    return to_out(await load(db, order_id))


async def guard_reduction(
    db: DB, order: Order, actor: User, approval: Approval | None, request: Request, line: OrderLine | None = None
) -> User:
    """Taking things off a bill after the customer has seen it (printed), paid
    part of it, or the kitchen started cooking it needs a manager. Before that,
    staff fix mistakes freely."""
    cooking = line is not None and line.kitchen_status in ("preparing", "ready", "served")
    if order.printed_count > 0 or order.payments or cooking:
        return await authorize(db, actor, APPROVE, approval, request)
    return actor


def ensure_not_below_paid(order: Order) -> None:
    t = billing.totals(order)
    if t.total < t.paid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{t.paid:,.2f} is already paid on this bill, so it can't go below that.",
        )


async def _rates(db: DB, order_type: str) -> tuple[Decimal, Decimal]:
    s = await load_settings(db)
    service = Decimal(str(s["service_charge_percent"])) if order_type in ("table", "tab") else ZERO
    return service, Decimal(str(s["tax_percent"]))


async def _active_table(db: DB, table_id: int) -> DiningTable:
    table = await db.get(DiningTable, table_id)
    if not table or not table.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Table not found")
    return table


# ---- Lists --------------------------------------------------------------------------

@router.get("", response_model=list[OrderOut])
async def open_orders(_: PosUser, db: DB, table_id: int | None = None):
    stmt = _query().where(Order.status == "open").order_by(Order.created_at)
    if table_id:
        stmt = stmt.where(Order.table_id == table_id)
    return [to_out(o) for o in await db.scalars(stmt)]


@router.get("/bills", response_model=BillsPage)
async def bills(
    _: Annotated[User, Depends(require_any("pos.payment", "dashboard.view"))],
    db: DB,
    day: date | None = None,
    show: Annotated[str, Query(pattern="^(paid|void|all)$")] = "all",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
):
    """Closed bills for one business day, newest first, with the day's totals."""
    tz = business_tz((await load_settings(db))["timezone"])
    day = day or datetime.now(tz).date()
    start = datetime.combine(day, time.min, tz)
    end = start + timedelta(days=1)
    in_day = [Order.closed_at >= start, Order.closed_at < end]

    statuses = ["paid", "void"] if show == "all" else [show]
    filters = [*in_day, Order.status.in_(statuses)]
    count = await db.scalar(select(func.count()).select_from(Order).where(*filters))
    rows = await db.scalars(
        _query().where(*filters).order_by(Order.closed_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )

    paid_today = select(Order.id).where(*in_day, Order.status == "paid")
    sales_total, bill_count = (
        await db.execute(
            select(func.coalesce(func.sum(Order.total), 0), func.count()).where(*in_day, Order.status == "paid")
        )
    ).one()
    methods = await db.execute(
        select(Payment.method, func.sum(Payment.amount), func.count())
        .where(Payment.order_id.in_(paid_today))
        .group_by(Payment.method)
    )
    tips = await db.scalar(select(func.coalesce(func.sum(Payment.tip), 0)).where(Payment.order_id.in_(paid_today)))
    voids = await db.scalar(select(func.count()).select_from(Order).where(*in_day, Order.status == "void"))
    return BillsPage(
        items=[to_out(o) for o in rows],
        total=count or 0,
        page=page,
        page_size=page_size,
        day=day,
        sales_total=Decimal(sales_total),
        bill_count=bill_count,
        tips_total=Decimal(tips),
        by_method=[MethodTotal(method=m, amount=Decimal(a), count=n) for m, a, n in methods],
        void_count=voids or 0,
    )


# ---- Create, read, update, delete -------------------------------------------------------

@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def create_order(body: OrderCreate, actor: Waiter, db: DB, request: Request):
    if body.type == "table":
        if not body.table_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a table")
        await _active_table(db, body.table_id)
    elif body.table_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only table orders have a table")
    if body.type == "tab" and not body.customer_name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a name for the tab")

    service, tax = await _rates(db, body.type)
    order = Order(
        type=body.type,
        table_id=body.table_id,
        customer_name=body.customer_name.strip(),
        note=body.note,
        service_charge_percent=service,
        tax_percent=tax,
        opened_by=actor.id,
    )
    db.add(order)
    await db.flush()
    audit.record(db, user=actor, action="open", entity="order", entity_id=order.id,
                 after={"name": f"#{order.id}", "type": body.type}, request=request)
    await db.commit()
    return await respond(db, order.id)


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, _: Annotated[User, Depends(require_any(*POS_USERS, "dashboard.view"))], db: DB):
    return await respond(db, order_id)


@router.patch("/{order_id}", response_model=OrderOut)
async def update_order(order_id: int, body: OrderUpdate, actor: Waiter, db: DB, request: Request):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    changes: dict = {}

    if body.table_id is not None and body.table_id != order.table_id:
        table = await _active_table(db, body.table_id)
        changes["table"] = f"{order.table.name if order.table else label(order)} → {table.name}"
        order.table_id = table.id
        order.type = "table"
    if body.customer_name is not None:
        if order.type == "tab" and not body.customer_name.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A tab needs a name")
        order.customer_name = body.customer_name.strip()
    if body.note is not None:
        order.note = body.note
    if body.service_charge_on is not None:
        currently_on = order.service_charge_percent > 0
        if body.service_charge_on and not currently_on:
            order.service_charge_percent = Decimal(str((await load_settings(db))["service_charge_percent"]))
            changes["service_charge"] = "on"
        elif not body.service_charge_on and currently_on:
            approver = await authorize(db, actor, APPROVE, body.approval, request)
            order.service_charge_percent = ZERO
            changes["service_charge"] = f"off (approved by {approver.name})"
            ensure_not_below_paid(order)

    if changes:
        audit.record(db, user=actor, action="update", entity="order", entity_id=order.id,
                     after={"name": f"#{order.id}", **changes}, request=request)
    await db.commit()
    return await respond(db, order.id)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_empty_order(order_id: int, actor: Waiter, db: DB, request: Request):
    """Throw away a bill opened by mistake. Bills with items must be voided."""
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if order.lines or order.payments:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bill has items. Remove them or void the bill.")
    audit.record(db, user=actor, action="delete", entity="order", entity_id=order.id,
                 before={"name": f"#{order.id}"}, request=request)
    await db.delete(order)
    await db.commit()


# ---- Lines -----------------------------------------------------------------------------

@router.post("/{order_id}/lines", response_model=OrderOut)
async def add_line(order_id: int, body: LineAdd, actor: Waiter, db: DB):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    item = await db.get(Item, body.item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Item not found")

    if body.option_id is not None:
        option = await db.get(SellOption, body.option_id)
        if not option or option.item_id != item.id or not option.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That option isn't available")
        name, price, deduct = f"{item.name} ({option.name})", option.price, option.deduct_qty
    else:
        if item.selling_price is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{item.name} has no selling price")
        name, price, deduct = item.name, item.selling_price, item.unit_size

    note = body.note.strip()
    for_kitchen = item.category.module == "food"
    same = next(
        (
            line for line in order.lines
            if line.item_id == item.id and line.option_id == body.option_id
            and line.unit_price == price and not line.note and not note
            # A second portion after the kitchen started the first is a new ticket line.
            and line.kitchen_status in (None, "new")
        ),
        None,
    )
    if same:
        same.qty += body.qty
    else:
        order.lines.append(
            OrderLine(item_id=item.id, option_id=body.option_id, name=name, qty=body.qty, unit_price=price,
                      deduct_per_unit=deduct, note=note, added_by=actor.id,
                      kitchen_status="new" if for_kitchen else None)
        )
    await db.commit()
    return await respond(db, order.id)


def _line(order: Order, line_id: int) -> OrderLine:
    line = next((x for x in order.lines if x.id == line_id), None)
    if not line:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That item isn't on this bill")
    return line


@router.patch("/{order_id}/lines/{line_id}", response_model=OrderOut)
async def update_line(order_id: int, line_id: int, body: LineUpdate, actor: Waiter, db: DB, request: Request):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    line = _line(order, line_id)
    if body.qty < line.qty:
        approver = await guard_reduction(db, order, actor, body.approval, request, line)
        audit.record(db, user=actor, action="reduce_line", entity="order", entity_id=order.id,
                     before={"name": f"#{order.id}", "item": line.name, "qty": float(line.qty)},
                     after={"name": f"#{order.id}", "item": line.name, "qty": float(body.qty),
                            "reason": body.reason, "approved_by": approver.name}, request=request)
    line.qty = body.qty
    if body.note is not None:
        line.note = body.note.strip()
    ensure_not_below_paid(order)
    await db.commit()
    return await respond(db, order.id)


@router.post("/{order_id}/lines/{line_id}/remove", response_model=OrderOut)
async def remove_line(order_id: int, line_id: int, body: LineRemove, actor: Waiter, db: DB, request: Request):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    line = _line(order, line_id)
    approver = await guard_reduction(db, order, actor, body.approval, request, line)
    audit.record(db, user=actor, action="remove_line", entity="order", entity_id=order.id,
                 before={"name": f"#{order.id}", "item": line.name, "qty": float(line.qty),
                         "total": float(line.line_total)},
                 after={"name": f"#{order.id}", "reason": body.reason, "approved_by": approver.name},
                 request=request)
    order.lines.remove(line)
    ensure_not_below_paid(order)
    await db.commit()
    return await respond(db, order.id)


# ---- Discounts, printing ----------------------------------------------------------------

@router.post("/{order_id}/discount", response_model=OrderOut)
async def set_discount(order_id: int, body: DiscountIn, actor: Waiter, db: DB, request: Request):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if body.type == "percent" and body.value > 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A discount can't be more than 100%")
    approver = await authorize(db, actor, APPROVE, body.approval, request)
    order.discount_type, order.discount_value = body.type, body.value
    order.discount_reason, order.discount_by = body.reason, approver.id
    ensure_not_below_paid(order)
    t = billing.totals(order)
    audit.record(db, user=actor, action="discount", entity="order", entity_id=order.id,
                 after={"name": f"#{order.id}", "discount": f"{body.value}{'%' if body.type == 'percent' else ''}",
                        "amount": float(t.discount), "reason": body.reason, "approved_by": approver.name},
                 request=request)
    await db.commit()
    return await respond(db, order.id)


@router.delete("/{order_id}/discount", response_model=OrderOut)
async def remove_discount(order_id: int, actor: Waiter, db: DB, request: Request):
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if order.discount_type:
        audit.record(db, user=actor, action="remove_discount", entity="order", entity_id=order.id,
                     before={"name": f"#{order.id}", "discount": float(order.discount_value)}, request=request)
        order.discount_type, order.discount_value, order.discount_reason, order.discount_by = None, ZERO, "", None
    await db.commit()
    return await respond(db, order.id)


@router.post("/{order_id}/print", response_model=OrderOut)
async def mark_printed(order_id: int, actor: PosUser, db: DB, request: Request):
    """Called when a bill or receipt is printed. After the first print, taking
    items off the bill needs a manager, and reprints are marked COPY."""
    order = await load(db, order_id, lock=True)
    if not order.lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There's nothing on this bill yet")
    # Bills (before paying) and receipts (after) are counted separately, so the
    # first receipt after a printed bill isn't marked COPY.
    if order.status == "paid":
        order.receipt_count += 1
        copies, kind = order.receipt_count - 1, "receipt"
    else:
        order.printed_count += 1
        copies, kind = order.printed_count - 1, "bill"
    if copies > 0:
        audit.record(db, user=actor, action="reprint", entity="order", entity_id=order.id,
                     after={"name": f"#{order.id}", "kind": kind, "copy": copies}, request=request)
    await db.commit()
    return await respond(db, order.id)


# ---- Split and merge ----------------------------------------------------------------------

@router.post("/{order_id}/split", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def split(order_id: int, body: SplitIn, actor: Waiter, db: DB, request: Request):
    """Move some items to a new bill, e.g. when one person pays for their own drinks.
    Returns the new bill."""
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if order.payments:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bill already has a payment, so it can't be split.")

    moving: dict[int, Decimal] = {}
    for s in body.lines:
        line = _line(order, s.line_id)
        moving[line.id] = moving.get(line.id, ZERO) + s.qty
        if moving[line.id] > line.qty:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Only {line.qty} of {line.name} on this bill")
    remaining = sum((line.qty - moving.get(line.id, ZERO) for line in order.lines), ZERO)
    if remaining <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Leave at least one item on the original bill")

    new = Order(
        type=order.type, table_id=order.table_id, customer_name=order.customer_name,
        service_charge_percent=order.service_charge_percent, tax_percent=order.tax_percent,
        opened_by=actor.id, printed_count=0, lines=[], payments=[],
    )
    db.add(new)
    await db.flush()
    for line in list(order.lines):
        qty = moving.get(line.id)
        if not qty:
            continue
        if qty == line.qty:
            line.order = new
        else:
            line.qty -= qty
            new.lines.append(
                OrderLine(item_id=line.item_id, option_id=line.option_id, name=line.name, qty=qty,
                          unit_price=line.unit_price, deduct_per_unit=line.deduct_per_unit, note=line.note,
                          added_by=actor.id, kitchen_status=line.kitchen_status)
            )
    audit.record(db, user=actor, action="split", entity="order", entity_id=order.id,
                 after={"name": f"#{order.id}", "new_bill": f"#{new.id}"}, request=request)
    await db.commit()
    return await respond(db, new.id)


@router.post("/{order_id}/merge", response_model=OrderOut)
async def merge(order_id: int, body: MergeIn, actor: Waiter, db: DB, request: Request):
    """Bring another open bill's items (and any payments) into this one."""
    if body.from_order_id == order_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a different bill")
    first, second = sorted([order_id, body.from_order_id])
    a = await load(db, first, lock=True)
    b = await load(db, second, lock=True)
    target, source = (a, b) if a.id == order_id else (b, a)
    ensure_open(target)
    ensure_open(source)
    for line in list(source.lines):
        line.order = target
    for payment in list(source.payments):
        payment.order = target
    source.status = "merged"
    source.merged_into = target.id
    source.closed_at = datetime.now(timezone.utc)
    audit.record(db, user=actor, action="merge", entity="order", entity_id=target.id,
                 after={"name": f"#{target.id}", "merged_from": f"#{source.id}"}, request=request)
    await db.commit()
    return await respond(db, target.id)


# ---- Payment, completion, void ------------------------------------------------------------

@router.post("/{order_id}/payments", response_model=OrderOut)
async def pay(order_id: int, body: PaymentIn, actor: Cashier, db: DB, request: Request):
    """Take a payment. Several payments can go on one bill (split the bill
    equally, or part cash part card). When it's fully paid the bill closes
    and stock is deducted."""
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if not order.lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There's nothing on this bill yet")
    t = billing.totals(order)
    if body.amount > t.due:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Only {t.due:,.2f} is due on this bill")

    change = ZERO
    tendered = None
    if body.method == "cash" and body.tendered is not None:
        if body.tendered < body.amount:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cash given is less than the amount")
        tendered, change = body.tendered, body.tendered - body.amount

    order.payments.append(
        Payment(method=body.method, amount=body.amount, tendered=tendered, change=change, tip=body.tip,
                reference=body.reference.strip(), created_by=actor.id)
    )
    await db.flush()
    if billing.totals(order).due == 0:
        await billing.close(db, order, actor)
        audit.record(db, user=actor, action="paid", entity="order", entity_id=order.id,
                     after={"name": label(order), "total": float(order.total)}, request=request)
    await db.commit()
    return await respond(db, order.id)


@router.post("/{order_id}/complete", response_model=OrderOut)
async def complete_free_bill(order_id: int, actor: Cashier, db: DB, request: Request):
    """Close a bill with nothing to pay (fully discounted) so its stock is recorded."""
    order = await load(db, order_id, lock=True)
    ensure_open(order)
    if not order.lines:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There's nothing on this bill yet")
    if billing.totals(order).due > 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bill still has an amount due")
    await billing.close(db, order, actor)
    audit.record(db, user=actor, action="paid", entity="order", entity_id=order.id,
                 after={"name": label(order), "total": float(order.total)}, request=request)
    await db.commit()
    return await respond(db, order.id)


@router.post("/{order_id}/void", response_model=OrderOut)
async def void(order_id: int, body: VoidIn, actor: PosUser, db: DB, request: Request):
    """Cancel a bill with a reason and a manager's approval. A paid bill's
    stock goes back on the shelf; its payments count as refunded."""
    order = await load(db, order_id, lock=True)
    if order.status not in ("open", "paid"):
        ensure_open(order)
    approver = await authorize(db, actor, APPROVE, body.approval, request)
    was_paid = order.status == "paid"
    if was_paid:
        await billing.reverse_stock(db, order, approver, body.reason)
    t = billing.totals(order)
    order.status = "void"
    order.void_reason = body.reason
    order.voided_by = approver.id
    if not order.closed_at:
        order.closed_at = datetime.now(timezone.utc)
    audit.record(db, user=actor, action="void", entity="order", entity_id=order.id,
                 after={"name": label(order), "total": float(t.total), "was_paid": was_paid,
                        "reason": body.reason, "approved_by": approver.name}, request=request)
    await db.commit()
    return await respond(db, order.id)
