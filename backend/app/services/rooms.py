"""Room bill maths: how many nights (or hours) a stay is, what the room costs,
and the running total of the stay's bill."""

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from app.core.timeutil import business_tz
from app.models import Booking
from app.services.billing import money

ZERO = Decimal(0)
GRACE_MINUTES = 15  # a short stay isn't charged an extra hour for a few minutes over


@dataclass
class Folio:
    units: Decimal          # nights, or hours for a short stay
    unit_label: str         # "night" / "hour"
    room_charge: Decimal
    extras: Decimal
    discounts: Decimal      # negative or zero
    room_service: Decimal
    tax_percent: Decimal
    tax: Decimal
    total: Decimal
    paid: Decimal           # payments less refunds
    balance: Decimal        # positive = guest owes, negative = we owe the guest
    estimated: bool         # True until check-out fixes the room charge


def stay_window(b: Booking, now: datetime) -> tuple[datetime, datetime]:
    """Start and end used for charging. Before check-out the end is the planned
    departure, or now if the guest has stayed past it."""
    start = b.checked_in_at or b.arrival
    if b.checked_out_at:
        end = b.checked_out_at
    elif b.status == "checked_in":
        end = max(b.departure, now)
    else:
        end = b.departure
    return start, end


def default_units(b: Booking, now: datetime, tz_name: str) -> Decimal:
    start, end = stay_window(b, now)
    if b.stay_type == "short":
        minutes = max(0.0, (end - start).total_seconds() / 60 - GRACE_MINUTES)
        return Decimal(max(b.block_hours, math.ceil(minutes / 60)))
    tz = business_tz(tz_name)
    nights = (end.astimezone(tz).date() - start.astimezone(tz).date()).days
    return Decimal(max(1, nights))


def charge_for(b: Booking, units: Decimal) -> Decimal:
    if b.stay_type == "short":
        extra_hours = max(ZERO, units - b.block_hours)
        return money(b.rate + extra_hours * b.extra_hour_rate)
    return money(b.rate * units)


def folio(b: Booking, tz_name: str, now: datetime | None = None) -> Folio:
    now = now or datetime.now(timezone.utc)
    if b.status in ("cancelled", "no_show"):
        units, room_charge, estimated = ZERO, ZERO, False  # only kept advances (as extras) remain
    elif b.room_charge is not None:
        units, room_charge, estimated = b.units_charged or ZERO, b.room_charge, False
    else:
        units = default_units(b, now, tz_name)
        room_charge, estimated = charge_for(b, units), True

    extras = sum((c.amount for c in b.charges if c.kind == "extra"), ZERO)
    discounts = sum((c.amount for c in b.charges if c.kind == "discount"), ZERO)
    room_service = sum((c.amount for c in b.charges if c.kind == "room_service"), ZERO)
    taxable = max(ZERO, room_charge + extras + discounts)
    tax = money(taxable * b.room_tax_percent / 100)
    total = taxable + tax + room_service
    paid = sum((p.amount if p.kind == "payment" else -p.amount for p in b.payments), ZERO)
    return Folio(
        units=units,
        unit_label="hour" if b.stay_type == "short" else "night",
        room_charge=room_charge,
        extras=extras,
        discounts=discounts,
        room_service=room_service,
        tax_percent=b.room_tax_percent,
        tax=tax,
        total=total,
        paid=paid,
        balance=total - paid,
        estimated=estimated,
    )
