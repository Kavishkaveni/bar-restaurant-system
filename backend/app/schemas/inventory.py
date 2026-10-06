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
    # final_product: bought (or batch-made) and counted. build_assembly: a dish
    # made to order from a recipe; it has no stock of its own.
    kind: Literal["final_product", "build_assembly"] = "final_product"
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

    def normalised(self) -> dict:
        """Dishes are sold one portion at a time and have no stock of their own."""
        data = self.model_dump()
        if self.kind == "build_assembly":
            data.update(base_unit="piece", unit_size=Decimal(1), track_stock=False,
                        reorder_level=Decimal(0), stock_unit=self.stock_unit or "plate")
        return data


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
    batch_yield: Num | None = None
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


# ---- Recipes ------------------------------------------------------------------

class RecipeLineIn(BaseModel):
    component_id: int
    qty: Decimal = Field(gt=0, max_digits=14, decimal_places=3)  # component base units


class RecipeIn(BaseModel):
    lines: list[RecipeLineIn] = Field(max_length=100)
    # Only for batch items: how much one batch makes, in base units.
    batch_yield: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)


class RecipeComponent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    base_unit: BaseUnit
    unit_size: Num
    stock_unit: str
    track_stock: bool


class RecipeLineOut(BaseModel):
    id: int
    component: RecipeComponent
    qty: Num
    qty_display: str
    cost: Num
    on_hand_display: str


class RecipeOut(BaseModel):
    item_id: int
    kind: str
    lines: list[RecipeLineOut]
    ingredient_cost: Num
    overhead_percent: Num
    total_cost: Num
    selling_price: Num | None
    margin: Num | None
    margin_percent: Num | None
    batch_yield: Num | None
    batch_yield_display: str | None
    portions_available: Num | None


class ProduceIn(BaseModel):
    batches: Decimal = Field(gt=0, max_digits=8, decimal_places=3)
    note: str = Field(default="", max_length=200)


# ---- Open bottles -------------------------------------------------------------

class OpenBottleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    size_ml: Num
    remaining_ml: Num
    opened_at: datetime
    opener: MovementUser | None
    note: str


class BottleItemOut(BaseModel):
    item_id: int
    name: str
    category: str
    unit_size: Num
    sealed: int
    on_hand_display: str
    smallest_pour: Num | None
    running_low: bool
    open: list[OpenBottleOut]


class FinishBottleIn(BaseModel):
    """The bottle is empty. Anything the record still shows is unaccounted for
    (over-pouring or spillage) and is written off as wastage."""

    reason: str = Field(default="Bottle finished", max_length=200)
