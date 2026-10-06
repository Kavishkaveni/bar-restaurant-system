"""Expenses and the cash drawer.

There is one cash drawer. A cashier opens a shift with a float, cash comes
in from bills and room payments, goes out for refunds, pay-outs and cash
drops, and at close the cashier counts the drawer. The system works out what
should be there, so the difference (short or over) is visible.
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
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.inventory import MONEY
from app.models.user import User

EXPENSE_METHODS = ("cash", "card", "bank_transfer", "qr", "cheque")
SHIFT_STATUSES = ("open", "closed")
CASH_KINDS = ("in", "out")

DEFAULT_EXPENSE_CATEGORIES = (
    "Salaries and wages",
    "Staff advances",
    "Rent",
    "Electricity",
    "Water",
    "Gas",
    "Internet and phone",
    "Liquor licence",
    "Taxes and council fees",
    "Repairs and maintenance",
    "Transport",
    "Cleaning supplies",
    "Other",
)


class ExpenseCategory(Base, TimestampMixin):
    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(8), default="open")
    opening_float: Mapped[Decimal] = mapped_column(MONEY)
    opened_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Stored at close so later corrections don't rewrite what the cashier saw.
    expected_cash: Mapped[Decimal | None] = mapped_column(MONEY)
    counted_cash: Mapped[Decimal | None] = mapped_column(MONEY)
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str] = mapped_column(String(300), default="")

    opener: Mapped[User | None] = relationship(foreign_keys=[opened_by], lazy="selectin")
    closer: Mapped[User | None] = relationship(foreign_keys=[closed_by], lazy="selectin")
    movements: Mapped[list["CashMovement"]] = relationship(
        back_populates="shift", lazy="selectin", order_by="CashMovement.id", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"status IN {SHIFT_STATUSES}", name="status"),
        CheckConstraint("opening_float >= 0", name="float_non_negative"),
        # Only one drawer, so only one open shift at a time.
        Index("uq_shifts_one_open", "status", unique=True, postgresql_where="status = 'open'"),
        Index("ix_shifts_opened_at", "opened_at"),
    )


class CashMovement(Base):
    """Cash put in (more change) or taken out (cash drop to the safe, owner takes cash)."""

    __tablename__ = "cash_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(4))
    amount: Mapped[Decimal] = mapped_column(MONEY)
    reason: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    shift: Mapped[Shift] = relationship(back_populates="movements")
    user: Mapped[User | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"kind IN {CASH_KINDS}", name="kind"),
        CheckConstraint("amount > 0", name="amount_positive"),
    )


class Expense(Base, TimestampMixin):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    method: Mapped[str] = mapped_column(String(20), default="cash")
    payee: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(300), default="")
    # Paid out of the counter cash drawer during this shift.
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_void: Mapped[bool] = mapped_column(Boolean, default=False)
    void_reason: Mapped[str] = mapped_column(String(300), default="")
    voided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    category: Mapped[ExpenseCategory] = relationship(lazy="selectin")
    user: Mapped[User | None] = relationship(foreign_keys=[created_by], lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"method IN {EXPENSE_METHODS}", name="method"),
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_expenses_date", "date"),
    )
