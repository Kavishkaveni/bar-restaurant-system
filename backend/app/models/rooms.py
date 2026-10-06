"""Rooms: room types with their prices, rooms, bookings and each booking's bill.

A booking is the whole stay: reserved, checked in, checked out (or cancelled
or a no-show). Its bill (folio) is the room charge plus charges added during
the stay (room service bills, extras like laundry, discounts), less payments
(advances and the final settlement).
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
from app.models.inventory import MONEY
from app.models.user import User

QTY_UNITS = Numeric(8, 2)

HOUSEKEEPING = ("clean", "dirty", "maintenance")
BOOKING_STATUSES = ("booked", "checked_in", "checked_out", "cancelled", "no_show")
STAY_TYPES = ("night", "short")
ID_TYPES = ("nic", "passport", "driving_licence", "other")
CHARGE_KINDS = ("room_service", "extra", "discount")
FOLIO_PAYMENT_KINDS = ("payment", "refund")
FOLIO_METHODS = ("cash", "card", "bank_transfer", "qr")


class RoomType(Base, TimestampMixin):
    __tablename__ = "room_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    nightly_rate: Mapped[Decimal] = mapped_column(MONEY)
    # Short stay (day use): a block of hours for one price, then per extra hour.
    short_stay_rate: Mapped[Decimal | None] = mapped_column(MONEY)
    short_stay_hours: Mapped[int] = mapped_column(Integer, default=3)
    extra_hour_rate: Mapped[Decimal | None] = mapped_column(MONEY)
    max_guests: Mapped[int] = mapped_column(Integer, default=2)
    description: Mapped[str] = mapped_column(String(300), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        CheckConstraint("nightly_rate >= 0", name="nightly_rate_non_negative"),
        CheckConstraint("short_stay_hours >= 1", name="short_stay_hours_positive"),
    )


class Room(Base, TimestampMixin):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20))
    room_type_id: Mapped[int] = mapped_column(ForeignKey("room_types.id"))
    floor: Mapped[str] = mapped_column(String(20), default="")
    housekeeping: Mapped[str] = mapped_column(String(12), default="clean")
    note: Mapped[str] = mapped_column(String(200), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    room_type: Mapped[RoomType] = relationship(lazy="selectin")

    __table_args__ = (CheckConstraint(f"housekeeping IN {HOUSEKEEPING}", name="housekeeping"),)


class Booking(Base, TimestampMixin):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), index=True)
    status: Mapped[str] = mapped_column(String(12), default="booked")
    stay_type: Mapped[str] = mapped_column(String(8), default="night")

    guest_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(40), default="")
    id_type: Mapped[str] = mapped_column(String(20), default="nic")
    id_number: Mapped[str] = mapped_column(String(40), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    adults: Mapped[int] = mapped_column(Integer, default=1)
    children: Mapped[int] = mapped_column(Integer, default=0)
    vehicle_no: Mapped[str] = mapped_column(String(30), default="")
    note: Mapped[str] = mapped_column(String(500), default="")

    # Planned times; the actual ones are checked_in_at / checked_out_at.
    arrival: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    departure: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Price agreed when booking: per night, or per short-stay block.
    rate: Mapped[Decimal] = mapped_column(MONEY)
    extra_hour_rate: Mapped[Decimal] = mapped_column(MONEY, default=0)
    block_hours: Mapped[int] = mapped_column(Integer, default=3)
    room_tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)

    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Fixed at check-out: nights (or hours for a short stay) charged, and the room charge.
    units_charged: Mapped[Decimal | None] = mapped_column(QTY_UNITS)
    room_charge: Mapped[Decimal | None] = mapped_column(MONEY)
    cancel_reason: Mapped[str] = mapped_column(String(300), default="")

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    checked_in_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    checked_out_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    room: Mapped[Room] = relationship(lazy="selectin")
    creator: Mapped[User | None] = relationship(foreign_keys=[created_by], lazy="selectin")
    charges: Mapped[list["BookingCharge"]] = relationship(
        back_populates="booking", lazy="selectin", order_by="BookingCharge.id", cascade="all, delete-orphan"
    )
    payments: Mapped[list["BookingPayment"]] = relationship(
        back_populates="booking", lazy="selectin", order_by="BookingPayment.id", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(f"status IN {BOOKING_STATUSES}", name="status"),
        CheckConstraint(f"stay_type IN {STAY_TYPES}", name="stay_type"),
        CheckConstraint("departure > arrival", name="departure_after_arrival"),
        CheckConstraint("rate >= 0", name="rate_non_negative"),
        Index("ix_bookings_status_arrival", "status", "arrival"),
    )


class BookingCharge(Base):
    """Something added to the room bill during the stay. Discounts are negative."""

    __tablename__ = "booking_charges"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(14))
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(MONEY)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), index=True)  # room service bill
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    booking: Mapped[Booking] = relationship(back_populates="charges")
    user: Mapped[User | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"kind IN {CHARGE_KINDS}", name="kind"),
        CheckConstraint("(kind = 'discount' AND amount < 0) OR (kind <> 'discount' AND amount > 0)", name="amount_sign"),
    )


class BookingPayment(Base):
    """Money taken for the stay (advance or at check-out), or given back (refund)."""

    __tablename__ = "booking_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="payment")
    method: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(MONEY)  # always positive; kind says which way
    reference: Mapped[str] = mapped_column(String(80), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    booking: Mapped[Booking] = relationship(back_populates="payments")
    user: Mapped[User | None] = relationship(lazy="selectin")

    __table_args__ = (
        CheckConstraint(f"kind IN {FOLIO_PAYMENT_KINDS}", name="kind"),
        CheckConstraint(f"method IN {FOLIO_METHODS}", name="method"),
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_booking_payments_created_at", "created_at"),
    )
