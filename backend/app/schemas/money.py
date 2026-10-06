from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.inventory import Num
from app.schemas.pos import UserBrief

ExpenseMethod = Literal["cash", "card", "bank_transfer", "qr", "cheque"]


# ---- Expenses -------------------------------------------------------------------------

class ExpenseCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class ExpenseCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int


class ExpenseIn(BaseModel):
    category_id: int
    date: date
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    method: ExpenseMethod = "cash"
    from_drawer: bool = False  # paid out of the counter cash drawer
    payee: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=300)

    @field_validator("payee", "note")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class ExpenseVoidIn(BaseModel):
    reason: str = Field(min_length=2, max_length=300)


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: ExpenseCategoryOut
    date: date
    amount: Num
    method: ExpenseMethod
    payee: str
    note: str
    shift_id: int | None
    user: UserBrief | None
    is_void: bool
    void_reason: str
    created_at: datetime


class CategoryTotal(BaseModel):
    category_id: int
    name: str
    amount: Num
    count: int


class ExpensePage(BaseModel):
    items: list[ExpenseOut]
    total: Num
    by_category: list[CategoryTotal]


# ---- Cash drawer -------------------------------------------------------------------------

class ShiftOpenIn(BaseModel):
    opening_float: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    note: str = Field(default="", max_length=300)


class CashMoveIn(BaseModel):
    kind: Literal["in", "out"]
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=2, max_length=200)


class ShiftCloseIn(BaseModel):
    counted_cash: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    note: str = Field(default="", max_length=300)


class CashMoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: Literal["in", "out"]
    amount: Num
    reason: str
    user: UserBrief | None
    created_at: datetime


class DrawerOut(BaseModel):
    opening_float: Num
    cash_sales: Num
    cash_refunds: Num
    room_cash: Num
    room_refunds: Num
    paid_out: Num
    cash_in: Num
    cash_out: Num
    expected: Num


class ShiftOut(BaseModel):
    id: int
    status: Literal["open", "closed"]
    opening_float: Num
    opener: UserBrief | None
    opened_at: datetime
    closer: UserBrief | None
    closed_at: datetime | None
    counted_cash: Num | None
    difference: Num | None  # counted - expected; negative = short
    note: str
    drawer: DrawerOut
    movements: list[CashMoveOut]
    payouts: list[ExpenseOut]
