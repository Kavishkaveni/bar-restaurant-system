from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.inventory import Num
from app.services.pins import Approval

OrderType = Literal["table", "bar", "takeaway", "tab", "room"]
PaymentMethod = Literal["cash", "card", "bank_transfer", "qr", "room"]


# ---- Tables ---------------------------------------------------------------------

class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    area: str = Field(default="", max_length=40)
    seats: int = Field(default=4, ge=1, le=100)
    sort_order: int = 0

    @field_validator("name", "area")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class OpenOrderBrief(BaseModel):
    id: int
    total: Num
    item_count: Num
    opened_at: datetime
    printed: bool


class TableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    area: str
    seats: int
    sort_order: int
    open_orders: list[OpenOrderBrief] = []


# ---- Selling options -------------------------------------------------------------

class SellOptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    deduct_qty: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    sort_order: int = 0


class SellOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    name: str
    deduct_qty: Num
    price: Num
    sort_order: int


# ---- Menu ------------------------------------------------------------------------

class MenuOption(BaseModel):
    id: int | None  # None = the whole stock unit at the item's selling price
    name: str
    price: Num


class MenuItem(BaseModel):
    id: int
    name: str
    category_id: int
    stock_unit: str
    track_stock: bool
    on_hand_display: str
    out_of_stock: bool
    options: list[MenuOption]


class MenuCategory(BaseModel):
    id: int
    name: str
    module: str


class Menu(BaseModel):
    categories: list[MenuCategory]
    items: list[MenuItem]


# ---- Orders ----------------------------------------------------------------------

class OrderCreate(BaseModel):
    type: OrderType
    table_id: int | None = None
    booking_id: int | None = None  # room service: the guest's stay
    customer_name: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=300)


class OrderUpdate(BaseModel):
    table_id: int | None = None
    customer_name: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)
    service_charge_on: bool | None = None
    approval: Approval | None = None


class LineAdd(BaseModel):
    item_id: int
    option_id: int | None = None
    qty: Decimal = Field(default=Decimal(1), gt=0, max_digits=10, decimal_places=3)
    note: str = Field(default="", max_length=200)


class LineUpdate(BaseModel):
    qty: Decimal = Field(gt=0, max_digits=10, decimal_places=3)
    note: str | None = Field(default=None, max_length=200)
    reason: str = Field(default="", max_length=200)
    approval: Approval | None = None


class LineRemove(BaseModel):
    reason: str = Field(default="", max_length=200)
    approval: Approval | None = None


class DiscountIn(BaseModel):
    type: Literal["percent", "amount"]
    value: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=2, max_length=200)
    approval: Approval | None = None


class SplitLine(BaseModel):
    line_id: int
    qty: Decimal = Field(gt=0, max_digits=10, decimal_places=3)


class SplitIn(BaseModel):
    lines: list[SplitLine] = Field(min_length=1)


class MergeIn(BaseModel):
    from_order_id: int


class PaymentIn(BaseModel):
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    tendered: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    tip: Decimal = Field(default=Decimal(0), ge=0, max_digits=12, decimal_places=2)
    reference: str = Field(default="", max_length=80)
    booking_id: int | None = None  # method "room": which stay to charge


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    approval: Approval | None = None


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class TableBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    option_id: int | None
    name: str
    qty: Num
    unit_price: Num
    line_total: Num
    note: str
    kitchen_status: str | None
    created_at: datetime


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    method: PaymentMethod
    amount: Num
    tendered: Num | None
    change: Num
    tip: Num
    reference: str
    booking_id: int | None
    user: UserBrief | None
    created_at: datetime


class OrderOut(BaseModel):
    id: int
    type: OrderType
    label: str
    table: TableBrief | None
    booking_id: int | None
    customer_name: str
    note: str
    status: str
    service_charge_percent: Num
    tax_percent: Num
    discount_type: str | None
    discount_value: Num
    discount_reason: str
    subtotal: Num
    discount: Num
    service_charge: Num
    tax: Num
    total: Num
    paid: Num
    due: Num
    tips: Num
    item_count: Num
    printed_count: int
    receipt_count: int
    opener: UserBrief | None
    closer: UserBrief | None
    created_at: datetime
    closed_at: datetime | None
    void_reason: str
    merged_into: int | None
    lines: list[LineOut]
    payments: list[PaymentOut]


class MethodTotal(BaseModel):
    method: PaymentMethod
    amount: Num
    count: int


class BillsPage(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    day: date
    sales_total: Num
    bill_count: int
    tips_total: Num
    by_method: list[MethodTotal]
    void_count: int
