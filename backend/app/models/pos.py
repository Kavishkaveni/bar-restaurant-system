"""POS: tables, selling options, orders (bills), order lines and payments.

An order is a bill while it's open and a receipt once it's paid. Stock is
deducted when the order is fully paid, in the same transaction as the last
payment, and put back if a manager voids the bill.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.inventory import MONEY, QTY, Item
from app.models.rooms import Booking
from app.models.user import User

PERCENT = Numeric(5, 2)

ORDER_TYPES = ("table", "bar", "takeaway", "tab", "room")
ORDER_STATUSES = ("open", "paid", "void", "merged")
PAYMENT_METHODS = ("cash", "card", "bank_transfer", "qr", "room")


class DiningTable(Base, TimestampMixin):
    __tablename__ = "dining_tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    area: Mapped[str] = mapped_column(String(40), default="")  # e.g. Indoor, Garden, Bar
    seats: Mapped[int] = mapped_column(Integer, default=4)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SellOption(Base, TimestampMixin):
    """Extra ways to sell an item besides the whole stock unit, e.g. a single
    cigarette from a pack. Pegs from open bottles arrive in phase 4."""

    __tablename__ = "sell_options"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    deduct_qty: Mapped[Decimal] = mapped_column(QTY)  # base units taken from stock per sale
    price: Mapped[Decimal] = mapped_column(MONEY)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        CheckConstraint("deduct_qty > 0", name="deduct_positive"),
        CheckConstraint("price >= 0", name="price_non_negative"),
    )


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(20))
    table_id: Mapped[int | None] = mapped_column(ForeignKey("dining_tables.id"))
    # Room service: the stay this order belongs to.
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id"), index=True)
    customer_name: Mapped[str] = mapped_column(String(80), default="")
    note: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="open")

    # Rates are copied from Settings when the order opens, so a settings change
    # mid-service doesn't change bills that are already running.
    service_charge_percent: Mapped[Decimal] = mapped_column(PERCENT, default=0)
    tax_percent: Mapped[Decimal] = mapped_column(PERCENT, default=0)

    discount_type: Mapped[str | None] = mapped_column(String(10))  # percent | amount
    discount_value: Mapped[Decimal] = mapped_column(MONEY, default=0)
    discount_reason: Mapped[str] = mapped_column(String(200), default="")
    discount_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # Totals are stored when the bill is paid; while open they're calculated live.
    subtotal: Mapped[Decimal] = mapped_column(MONEY, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    service_charge: Mapped[Decimal] = mapped_column(MONEY, default=0)
    tax: Mapped[Decimal] = mapped_column(MONEY, default=0)
    total: Mapped[Decimal] = mapped_column(MONEY, default=0)
    cost_total: Mapped[Decimal] = mapped_column(MONEY, default=0)

    printed_count: Mapped[int] = mapped_column(Integer, default=0)  # bills shown to the customer before paying
    receipt_count: Mapped[int] = mapped_column(Integer, default=0)  # receipts printed after paying
    opened_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    void_reason: Mapped[str] = mapped_column(String(300), default="")
    voided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_into: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))

    table: Mapped[DiningTable | None] = relationship(lazy="selectin")
    booking: Mapped["Booking | None"] = relationship(lazy="selectin")
    opener: Mapped[User | None] = relationship(foreign_keys=[opened_by], lazy="selectin")
    closer: Mapped[User | None] = relationship(foreign_keys=[closed_by], lazy="selectin")
    lines: Mapped[list["OrderLine"]] = relationship(
        back_populates="order", lazy="selectin", order_by="OrderLine.id", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order", lazy="selectin", order_by="Payment.id", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"type IN {ORDER_TYPES}", name="type"),
        CheckConstraint(f"status IN {ORDER_STATUSES}", name="status"),
        CheckConstraint("discount_type IS NULL OR discount_type IN ('percent', 'amount')", name="discount_type"),
        Index("ix_orders_status_created", "status", "created_at"),
        Index("ix_orders_closed_at", "closed_at"),
        Index("ix_orders_table_status", "table_id", "status"),
    )


class OrderLine(Base):
    __tablename__ = "order_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    option_id: Mapped[int | None] = mapped_column(ForeignKey("sell_options.id"))
    # Copied at the time of sale so later price or name changes don't alter old bills.
    name: Mapped[str] = mapped_column(String(180))
    qty: Mapped[Decimal] = mapped_column(QTY)
    unit_price: Mapped[Decimal] = mapped_column(MONEY)
    deduct_per_unit: Mapped[Decimal] = mapped_column(QTY)  # base units per 1 qty
    note: Mapped[str] = mapped_column(String(200), default="")
    # Kitchen items (food) go new -> preparing -> ready -> served; None = not for the kitchen.
    kitchen_status: Mapped[str | None] = mapped_column(String(12))
    kitchen_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cost_total: Mapped[Decimal] = mapped_column(MONEY, default=0)  # set when paid
    added_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="lines")
    item: Mapped[Item] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint(
            "kitchen_status IS NULL OR kitchen_status IN ('new', 'preparing', 'ready', 'served')",
            name="kitchen_status",
        ),
        Index("ix_order_lines_kitchen_status", "kitchen_status"),
    )

    @property
    def line_total(self) -> Decimal:
        return (self.qty * self.unit_price).quantize(Decimal("0.01"))


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(MONEY)      # applied to the bill
    tendered: Mapped[Decimal | None] = mapped_column(MONEY)  # cash handed over
    change: Mapped[Decimal] = mapped_column(MONEY, default=0)
    tip: Mapped[Decimal] = mapped_column(MONEY, default=0)
    reference: Mapped[str] = mapped_column(String(80), default="")
    # Charge to room: the stay whose bill this amount was moved to.
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="payments")
    user: Mapped[User | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"method IN {PAYMENT_METHODS}", name="method"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("tip >= 0", name="tip_non_negative"),
    )
