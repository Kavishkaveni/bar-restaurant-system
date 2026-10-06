"""Catalogue, suppliers, purchases and the stock ledger.

Stock is never stored as a number on the item. Every change is one row in
`stock_movements`, in the item's base unit (ml, g or piece), and current
stock is the sum of those rows.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.user import User

MONEY = Numeric(12, 2)
QTY = Numeric(14, 3)
# Cost per base unit (per ml / g / piece) needs more decimals than money.
UNIT_COST = Numeric(14, 6)

BASE_UNITS = ("ml", "g", "piece")
MODULES = ("bar", "sundry", "food", "other")
MOVEMENT_TYPES = (
    "opening",        # starting stock, entered once per item
    "purchase",       # stock received from a supplier
    "purchase_void",  # a cancelled purchase is reversed
    "wastage",        # spillage, spoilage, breakage
    "count_adjust",   # physical count differs from the system
    "sale",           # phase 3
    "void_reversal",  # phase 3
    "open_bottle",    # phase 4
    "production",     # phase 4
)


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    module: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Name uniqueness (case-insensitive, per module) is checked in the API.
    __table_args__ = (CheckConstraint(f"module IN {MODULES}", name="module"),)


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    contact_person: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Item(Base, TimestampMixin):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    # final_product now; build_assembly (recipes) arrives in phase 4.
    kind: Mapped[str] = mapped_column(String(20), default="final_product")

    # How stock is counted. A 750 ml bottle: base_unit=ml, unit_size=750,
    # stock_unit="bottle". A pack of 20 cigarettes: piece, 20, "pack".
    base_unit: Mapped[str] = mapped_column(String(10))
    unit_size: Mapped[Decimal] = mapped_column(QTY)
    stock_unit: Mapped[str] = mapped_column(String(20))

    cost_price: Mapped[Decimal] = mapped_column(MONEY, default=0)      # per stock unit, last purchase
    selling_price: Mapped[Decimal | None] = mapped_column(MONEY)       # per stock unit, if sold whole
    avg_cost: Mapped[Decimal] = mapped_column(UNIT_COST, default=0)    # per base unit, weighted average
    reorder_level: Mapped[Decimal] = mapped_column(QTY, default=0)     # in stock units
    track_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"))
    sku: Mapped[str] = mapped_column(String(60), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category] = relationship(lazy="selectin")
    supplier: Mapped[Supplier | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"base_unit IN {BASE_UNITS}", name="base_unit"),
        CheckConstraint("unit_size > 0", name="unit_size_positive"),
        CheckConstraint("kind IN ('final_product', 'build_assembly')", name="kind"),
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(QTY)  # signed, base units
    unit_cost: Mapped[Decimal] = mapped_column(UNIT_COST, default=0)  # per base unit
    type: Mapped[str] = mapped_column(String(20))
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None]
    reason: Mapped[str] = mapped_column(String(300), default="")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"type IN {MOVEMENT_TYPES}", name="type"),
        Index("ix_stock_movements_item_created", "item_id", "created_at"),
        Index("ix_stock_movements_ref", "ref_type", "ref_id"),
    )


class Purchase(Base, TimestampMixin):
    __tablename__ = "purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    invoice_no: Mapped[str] = mapped_column(String(60), default="")
    invoice_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    total: Mapped[Decimal] = mapped_column(MONEY)
    amount_paid: Mapped[Decimal] = mapped_column(MONEY, default=0)
    status: Mapped[str] = mapped_column(String(20), default="received")  # received | cancelled
    cancel_reason: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    supplier: Mapped[Supplier] = relationship(lazy="selectin")
    creator: Mapped[User | None] = relationship(lazy="selectin")
    lines: Mapped[list["PurchaseLine"]] = relationship(
        back_populates="purchase", cascade="all, delete-orphan", lazy="selectin", order_by="PurchaseLine.id"
    )

    __table_args__ = (
        CheckConstraint("status IN ('received', 'cancelled')", name="status"),
        CheckConstraint("amount_paid >= 0", name="paid_non_negative"),
    )


class PurchaseLine(Base):
    __tablename__ = "purchase_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(QTY)          # in stock units (bottles, kg, packs)
    unit_cost: Mapped[Decimal] = mapped_column(MONEY)  # per stock unit
    line_total: Mapped[Decimal] = mapped_column(MONEY)
    expiry_date: Mapped[date | None] = mapped_column(Date)

    purchase: Mapped[Purchase] = relationship(back_populates="lines")
    item: Mapped[Item] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("unit_cost >= 0", name="cost_non_negative"),
    )
