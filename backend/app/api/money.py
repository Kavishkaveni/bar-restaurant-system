"""Expenses, expense categories and the cash drawer (shifts)."""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, require, require_any
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import CashMovement, Expense, ExpenseCategory, Shift, User
from app.schemas.money import (
    CashMoveIn,
    CategoryTotal,
    DrawerOut,
    ExpenseCategoryIn,
    ExpenseCategoryOut,
    ExpenseIn,
    ExpenseOut,
    ExpensePage,
    ExpenseVoidIn,
    ShiftCloseIn,
    ShiftOpenIn,
    ShiftOut,
)
from app.services import audit, drawer
from app.services.pins import has_permission

router = APIRouter(tags=["money"])

ExpenseManager = Annotated[User, Depends(require("expenses.manage"))]
# Cashiers can pay small things out of the drawer; managers record every expense.
ExpenseWriter = Annotated[User, Depends(require_any("expenses.manage", "pos.payment"))]
Cashier = Annotated[User, Depends(require_any("pos.payment", "expenses.manage"))]
ShiftViewer = Annotated[User, Depends(require_any("pos.payment", "expenses.manage", "dashboard.view"))]


async def today(db: DB) -> date:
    return datetime.now(business_tz((await load_settings(db))["timezone"])).date()


# ---- Categories -----------------------------------------------------------------------

@router.get("/expense-categories", response_model=list[ExpenseCategoryOut])
async def list_categories(_: ExpenseWriter, db: DB):
    return list(
        await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.is_active.is_(True))
            .order_by(ExpenseCategory.sort_order, ExpenseCategory.name)
        )
    )


async def _category_taken(db: DB, name: str, exclude: int | None = None) -> bool:
    stmt = select(ExpenseCategory.id).where(func.lower(ExpenseCategory.name) == name.lower(),
                                            ExpenseCategory.is_active.is_(True))
    if exclude:
        stmt = stmt.where(ExpenseCategory.id != exclude)
    return bool(await db.scalar(stmt))


@router.post("/expense-categories", response_model=ExpenseCategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(body: ExpenseCategoryIn, actor: ExpenseManager, db: DB, request: Request):
    if await _category_taken(db, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'"{body.name}" already exists')
    if body.sort_order == 0:
        body.sort_order = (await db.scalar(select(func.coalesce(func.max(ExpenseCategory.sort_order), 0)))) + 1
    c = ExpenseCategory(**body.model_dump())
    db.add(c)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="expense_category", entity_id=c.id,
                 after={"name": c.name}, request=request)
    await db.commit()
    return c


@router.put("/expense-categories/{category_id}", response_model=ExpenseCategoryOut)
async def rename_category(category_id: int, body: ExpenseCategoryIn, actor: ExpenseManager, db: DB, request: Request):
    c = await db.get(ExpenseCategory, category_id)
    if not c or not c.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    if await _category_taken(db, body.name, c.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'"{body.name}" already exists')
    audit.record(db, user=actor, action="update", entity="expense_category", entity_id=c.id,
                 before={"name": c.name}, after={"name": body.name}, request=request)
    c.name = body.name
    if body.sort_order:
        c.sort_order = body.sort_order
    await db.commit()
    return c


@router.delete("/expense-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: int, actor: ExpenseManager, db: DB, request: Request):
    """Hidden from the list; past expenses keep their category."""
    c = await db.get(ExpenseCategory, category_id)
    if not c or not c.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    c.is_active = False
    audit.record(db, user=actor, action="delete", entity="expense_category", entity_id=c.id,
                 before={"name": c.name}, request=request)
    await db.commit()


# ---- Expenses --------------------------------------------------------------------------

@router.get("/expenses", response_model=ExpensePage)
async def list_expenses(
    _: ExpenseManager,
    db: DB,
    start: date | None = None,
    end: date | None = None,
    category_id: int | None = None,
    include_void: bool = False,
):
    end = end or await today(db)
    start = start or end.replace(day=1)
    filters = [Expense.date >= start, Expense.date <= end]
    if category_id:
        filters.append(Expense.category_id == category_id)
    if not include_void:
        filters.append(Expense.is_void.is_(False))
    rows = list(await db.scalars(select(Expense).where(*filters).order_by(Expense.date.desc(), Expense.id.desc())))
    live = [e for e in rows if not e.is_void]
    by_cat: dict[int, CategoryTotal] = {}
    for e in live:
        t = by_cat.setdefault(e.category_id, CategoryTotal(category_id=e.category_id, name=e.category.name,
                                                           amount=0, count=0))
        t.amount += e.amount
        t.count += 1
    return ExpensePage(items=rows, total=sum((e.amount for e in live), 0),
                       by_category=sorted(by_cat.values(), key=lambda t: -t.amount))


async def _active_category(db: DB, category_id: int) -> ExpenseCategory:
    c = await db.get(ExpenseCategory, category_id)
    if not c or not c.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a category")
    return c


def _dump(e: Expense) -> dict:
    return {"name": f"{e.category.name} {float(e.amount):,.2f}", "date": e.date.isoformat(),
            "amount": float(e.amount), "method": e.method, "payee": e.payee,
            "from_drawer": e.shift_id is not None}


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(body: ExpenseIn, actor: ExpenseWriter, db: DB, request: Request):
    category = await _active_category(db, body.category_id)
    day = await today(db)
    if body.date > day:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The date can't be in the future")
    if not has_permission(actor, "expenses.manage") and not (body.from_drawer and body.date == day):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only pay out of the cash drawer today")
    shift = None
    if body.from_drawer:
        shift = await drawer.current(db, lock=True)
        if not shift:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No shift is open. Open the cash drawer first.")
        if body.date != day:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Money from the drawer is paid today")
        cash = await drawer.count(db, shift)
        if body.amount > cash.expected:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Only {cash.expected:,.2f} should be in the drawer")
    e = Expense(
        category_id=category.id, date=body.date, amount=body.amount,
        method="cash" if body.from_drawer else body.method, payee=body.payee, note=body.note,
        shift_id=shift.id if shift else None, created_by=actor.id,
    )
    e.category = category
    db.add(e)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="expense", entity_id=e.id, after=_dump(e), request=request)
    await db.commit()
    await db.refresh(e, ["user"])
    return e


async def _editable(db: DB, expense_id: int) -> Expense:
    e = await db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    if e.is_void:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This expense was cancelled")
    if e.shift_id:
        shift = await db.get(Shift, e.shift_id)
        if shift.status == "closed":
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "This was paid from a drawer that's already counted and closed")
    return e


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(expense_id: int, body: ExpenseIn, actor: ExpenseManager, db: DB, request: Request):
    e = await _editable(db, expense_id)
    if body.from_drawer != (e.shift_id is not None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Whether it was paid from the drawer can't change. Cancel it and add it again.")
    if body.date > await today(db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The date can't be in the future")
    before = _dump(e)
    e.category = await _active_category(db, body.category_id)
    e.amount, e.payee, e.note = body.amount, body.payee, body.note
    if not e.shift_id:  # drawer pay-outs keep the day and cash method they were paid with
        e.date, e.method = body.date, body.method
    audit.record(db, user=actor, action="update", entity="expense", entity_id=e.id, before=before, after=_dump(e),
                 request=request)
    await db.commit()
    return e


@router.post("/expenses/{expense_id}/void", response_model=ExpenseOut)
async def void_expense(expense_id: int, body: ExpenseVoidIn, actor: ExpenseManager, db: DB, request: Request):
    e = await _editable(db, expense_id)
    e.is_void, e.void_reason, e.voided_by = True, body.reason.strip(), actor.id
    audit.record(db, user=actor, action="void", entity="expense", entity_id=e.id,
                 after={**_dump(e), "reason": body.reason}, request=request)
    await db.commit()
    return e


# ---- Cash drawer -------------------------------------------------------------------------

async def shift_out(db: DB, shift: Shift) -> ShiftOut:
    if shift.status == "closed":
        expected = shift.expected_cash
        cash = await drawer.count(db, shift)
        cash.expected = expected  # what the cashier saw at close
    else:
        cash = await drawer.count(db, shift)
    payouts = list(await db.scalars(select(Expense).where(Expense.shift_id == shift.id).order_by(Expense.id)))
    return ShiftOut(
        id=shift.id, status=shift.status, opening_float=shift.opening_float, opener=shift.opener,
        opened_at=shift.opened_at, closer=shift.closer, closed_at=shift.closed_at, counted_cash=shift.counted_cash,
        difference=(shift.counted_cash - shift.expected_cash) if shift.counted_cash is not None else None,
        note=shift.note, drawer=DrawerOut(**cash.__dict__), movements=shift.movements, payouts=payouts,
    )


@router.get("/shifts/current", response_model=ShiftOut | None)
async def current_shift(_: ShiftViewer, db: DB):
    shift = await drawer.current(db)
    return await shift_out(db, shift) if shift else None


@router.get("/shifts", response_model=list[ShiftOut])
async def shift_history(
    _: Annotated[User, Depends(require_any("expenses.manage", "dashboard.view"))],
    db: DB,
    days: int = Query(default=14, ge=1, le=366),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = await db.scalars(select(Shift).where(Shift.opened_at >= since).order_by(Shift.opened_at.desc()))
    return [await shift_out(db, s) for s in rows]


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def open_shift(body: ShiftOpenIn, actor: Cashier, db: DB, request: Request):
    if await drawer.current(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "A shift is already open. Close it first.")
    shift = Shift(opening_float=body.opening_float, opened_by=actor.id, note=body.note.strip(),
                  opened_at=datetime.now(timezone.utc), movements=[])
    db.add(shift)
    try:
        await db.flush()
    except IntegrityError:  # someone opened one at the same moment
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A shift is already open. Close it first.") from None
    audit.record(db, user=actor, action="open", entity="shift", entity_id=shift.id,
                 after={"name": f"#{shift.id}", "float": float(body.opening_float)}, request=request)
    await db.commit()
    return await shift_out(db, await db.get(Shift, shift.id))


async def _open_shift(db: DB, shift_id: int) -> Shift:
    shift = await db.get(Shift, shift_id, with_for_update=True)
    if not shift:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shift not found")
    if shift.status != "open":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This shift is already closed")
    return shift


@router.post("/shifts/{shift_id}/cash", response_model=ShiftOut)
async def move_cash(shift_id: int, body: CashMoveIn, actor: Cashier, db: DB, request: Request):
    """Put change into the drawer, or take cash out (to the safe, to the owner)."""
    shift = await _open_shift(db, shift_id)
    if body.kind == "out":
        cash = await drawer.count(db, shift)
        if body.amount > cash.expected:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Only {cash.expected:,.2f} should be in the drawer")
    shift.movements.append(CashMovement(kind=body.kind, amount=body.amount, reason=body.reason.strip(),
                                        created_by=actor.id))
    audit.record(db, user=actor, action="cash_" + body.kind, entity="shift", entity_id=shift.id,
                 after={"name": f"#{shift.id}", "amount": float(body.amount), "reason": body.reason}, request=request)
    await db.commit()
    return await shift_out(db, shift)


@router.post("/shifts/{shift_id}/close", response_model=ShiftOut)
async def close_shift(shift_id: int, body: ShiftCloseIn, actor: Cashier, db: DB, request: Request):
    shift = await _open_shift(db, shift_id)
    now = datetime.now(timezone.utc)
    cash = await drawer.count(db, shift, until=now)
    shift.status, shift.closed_at, shift.closed_by = "closed", now, actor.id
    shift.expected_cash, shift.counted_cash = cash.expected, body.counted_cash
    if body.note.strip():
        shift.note = (shift.note + "\n" if shift.note else "") + body.note.strip()
    diff = body.counted_cash - cash.expected
    audit.record(db, user=actor, action="close", entity="shift", entity_id=shift.id,
                 after={"name": f"#{shift.id}", "expected": float(cash.expected),
                        "counted": float(body.counted_cash), "difference": float(diff)}, request=request)
    await db.commit()
    return await shift_out(db, shift)
