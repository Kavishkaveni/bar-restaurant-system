from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

# Decimals are exact in Python and the database; JSON gets plain numbers.
Num = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

Module = Literal["bar", "sundry", "food", "other"]
BaseUnit = Literal["ml", "g", "piece"]


def _strip(v: str) -> str:
    return v.strip()


# ---- Categories -------------------------------------------------------------

class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    module: Module

    _strip = field_validator("name")(_strip)


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    module: Module
    is_active: bool
    item_count: int = 0


# ---- Suppliers --------------------------------------------------------------

class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    contact_person: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)
    address: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=2000)

    _strip = field_validator("name")(_strip)


class SupplierBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class SupplierOut(SupplierBrief):
    contact_person: str
    phone: str
    email: str
    address: str
    notes: str
    is_active: bool
    balance_due: Num = Decimal(0)
    purchase_count: int = 0


# ---- Items ------------------------------------------------------------------

class CategoryBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    module: Module


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category_id: int
    base_unit: BaseUnit
    unit_size: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    stock_unit: str = Field(min_length=1, max_length=20)
    cost_price: Decimal = Field(default=Decimal(0), ge=0, max_digits=12, decimal_places=2)
    selling_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    reorder_level: Decimal = Field(default=Decimal(0), ge=0, max_digits=14, decimal_places=3)
    track_stock: bool = True
    supplier_id: int | None = None
    sku: str = Field(default="", max_length=60)
    notes: str = Field(default="", max_length=2000)

    _strip = field_validator("name", "stock_unit", "sku")(_strip)


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: CategoryBrief
    kind: str
    base_unit: BaseUnit
    unit_size: Num
    stock_unit: str
    cost_price: Num
    selling_price: Num | None
    avg_cost: Num
    reorder_level: Num
    track_stock: bool
    supplier: SupplierBrief | None
    sku: str
    notes: str
    is_active: bool
    # Filled in by the API from the stock ledger.
    on_hand: Num = Decimal(0)
    on_hand_display: str = ""
    stock_value: Num = Decimal(0)
    is_low: bool = False
    has_movements: bool = False


# ---- Stock ------------------------------------------------------------------

class MovementUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    qty: Num
    qty_display: str = ""
    unit_cost: Num
    type: str
    ref_type: str | None
    ref_id: int | None
    reason: str
    user: MovementUser | None
    created_at: datetime
    balance_after: Num = Decimal(0)


class MovementPage(BaseModel):
    items: list[MovementOut]
    total: int
    page: int
    page_size: int


class OpeningStockIn(BaseModel):
    """Starting stock in base units (ml, g, pieces); cost per stock unit."""

    qty: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    cost_per_unit: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class WastageIn(BaseModel):
    """Amount wasted, in base units (ml, g, pieces): it's usually a small part."""

    qty: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    reason: str = Field(min_length=2, max_length=300)


class CountIn(BaseModel):
    """What was physically counted, in base units."""

    counted: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    reason: str = Field(default="Stock count", min_length=2, max_length=300)


# ---- Purchases ----------------------------------------------------------------

class PurchaseLineIn(BaseModel):
    item_id: int
    qty: Decimal = Field(gt=0, max_digits=14, decimal_places=3)          # stock units
    unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)    # per stock unit
    expiry_date: date | None = None


class PurchaseIn(BaseModel):
    supplier_id: int
    invoice_no: str = Field(default="", max_length=60)
    invoice_date: date
    notes: str = Field(default="", max_length=2000)
    amount_paid: Decimal = Field(default=Decimal(0), ge=0, max_digits=12, decimal_places=2)
    lines: list[PurchaseLineIn] = Field(min_length=1, max_length=200)


class PaymentIn(BaseModel):
    amount_paid: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class ItemBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    stock_unit: str


class PurchaseLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item: ItemBrief
    qty: Num
    unit_cost: Num
    line_total: Num
    expiry_date: date | None


class PurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier: SupplierBrief
    invoice_no: str
    invoice_date: date
    notes: str
    total: Num
    amount_paid: Num
    status: str
    cancel_reason: str
    creator: MovementUser | None
    created_at: datetime
    lines: list[PurchaseLineOut]


class PurchasePage(BaseModel):
    items: list[PurchaseOut]
    total: int
    page: int
    page_size: int
