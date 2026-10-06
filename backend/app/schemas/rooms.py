from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.inventory import Num
from app.schemas.pos import UserBrief
from app.services.pins import Approval

Housekeeping = Literal["clean", "dirty", "maintenance"]
BookingStatus = Literal["booked", "checked_in", "checked_out", "cancelled", "no_show"]
StayType = Literal["night", "short"]
IdType = Literal["nic", "passport", "driving_licence", "other"]
FolioMethod = Literal["cash", "card", "bank_transfer", "qr"]
Money = Field(ge=0, max_digits=12, decimal_places=2)


def _strip(v: str) -> str:
    return v.strip()


# ---- Room types and rooms -----------------------------------------------------------

class RoomTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    nightly_rate: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    short_stay_rate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    short_stay_hours: int = Field(default=3, ge=1, le=24)
    extra_hour_rate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    max_guests: int = Field(default=2, ge=1, le=50)
    description: str = Field(default="", max_length=300)
    sort_order: int = 0

    _s = field_validator("name", "description")(_strip)


class RoomTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    nightly_rate: Num
    short_stay_rate: Num | None
    short_stay_hours: int
    extra_hour_rate: Num | None
    max_guests: int
    description: str
    sort_order: int
    room_count: int = 0


class RoomIn(BaseModel):
    number: str = Field(min_length=1, max_length=20)
    room_type_id: int
    floor: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=200)
    sort_order: int = 0

    _s = field_validator("number", "floor", "note")(_strip)


class RoomTypeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    room_type: RoomTypeBrief
    floor: str
    housekeeping: Housekeeping
    note: str
    sort_order: int


class HousekeepingIn(BaseModel):
    housekeeping: Housekeeping
    note: str | None = Field(default=None, max_length=200)


# ---- Bookings --------------------------------------------------------------------------

class GuestFields(BaseModel):
    guest_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=40)
    id_type: IdType = "nic"
    id_number: str = Field(default="", max_length=40)
    address: str = Field(default="", max_length=300)
    adults: int = Field(default=1, ge=1, le=50)
    children: int = Field(default=0, ge=0, le=50)
    vehicle_no: str = Field(default="", max_length=30)
    note: str = Field(default="", max_length=500)

    _s = field_validator("guest_name", "phone", "id_number", "address", "vehicle_no", "note")(_strip)


class AdvanceIn(BaseModel):
    method: FolioMethod
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reference: str = Field(default="", max_length=80)


class BookingCreate(GuestFields):
    room_id: int
    stay_type: StayType = "night"
    arrival: datetime
    departure: datetime
    rate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)  # default: the room type's
    check_in_now: bool = False
    advance: AdvanceIn | None = None

    @model_validator(mode="after")
    def order(self):
        if self.departure <= self.arrival:
            raise ValueError("Departure must be after arrival")
        return self


class BookingUpdate(BaseModel):
    guest_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    id_type: IdType | None = None
    id_number: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=300)
    adults: int | None = Field(default=None, ge=1, le=50)
    children: int | None = Field(default=None, ge=0, le=50)
    vehicle_no: str | None = Field(default=None, max_length=30)
    note: str | None = Field(default=None, max_length=500)
    room_id: int | None = None
    arrival: datetime | None = None
    departure: datetime | None = None
    rate: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class CheckInIn(BaseModel):
    """Guest details can be completed at the desk while checking in."""

    guest_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    id_type: IdType | None = None
    id_number: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=300)
    adults: int | None = Field(default=None, ge=1, le=50)
    children: int | None = Field(default=None, ge=0, le=50)
    vehicle_no: str | None = Field(default=None, max_length=30)


class ChargeIn(BaseModel):
    kind: Literal["extra", "discount"]
    description: str = Field(min_length=2, max_length=200)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)  # positive; discounts are taken off
    approval: Approval | None = None


class RemoveChargeIn(BaseModel):
    reason: str = Field(default="", max_length=200)
    approval: Approval | None = None


class CheckOutIn(BaseModel):
    units: Decimal | None = Field(default=None, gt=0, max_digits=8, decimal_places=2)
    payments: list[AdvanceIn] = Field(default=[], max_length=5)
    refund_method: FolioMethod | None = None  # when advances are more than the bill
    approval: Approval | None = None  # charging fewer nights than stayed needs a manager


class CancelIn(BaseModel):
    reason: str = Field(min_length=2, max_length=300)
    no_show: bool = False
    advance: Literal["refund", "keep"] | None = None
    refund_method: FolioMethod | None = None


class RoomBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    room_type: RoomTypeBrief


class ChargeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    description: str
    amount: Num
    order_id: int | None
    user: UserBrief | None
    created_at: datetime


class FolioPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: Literal["payment", "refund"]
    method: FolioMethod
    amount: Num
    reference: str
    user: UserBrief | None
    created_at: datetime


class FolioOut(BaseModel):
    units: Num
    unit_label: str
    room_charge: Num
    extras: Num
    discounts: Num
    room_service: Num
    tax_percent: Num
    tax: Num
    total: Num
    paid: Num
    balance: Num
    estimated: bool


class OpenBillBrief(BaseModel):
    id: int
    total: Num


class BookingOut(BaseModel):
    id: int
    room: RoomBrief
    status: BookingStatus
    stay_type: StayType
    guest_name: str
    phone: str
    id_type: IdType
    id_number: str
    address: str
    adults: int
    children: int
    vehicle_no: str
    note: str
    arrival: datetime
    departure: datetime
    rate: Num
    extra_hour_rate: Num
    block_hours: int
    checked_in_at: datetime | None
    checked_out_at: datetime | None
    cancel_reason: str
    creator: UserBrief | None
    created_at: datetime
    folio: FolioOut
    charges: list[ChargeOut] = []
    payments: list[FolioPaymentOut] = []
    open_bills: list[OpenBillBrief] = []


class BookingBrief(BaseModel):
    """For lists and the room board."""

    id: int
    room: RoomBrief
    status: BookingStatus
    stay_type: StayType
    guest_name: str
    phone: str
    arrival: datetime
    departure: datetime
    checked_in_at: datetime | None
    checked_out_at: datetime | None
    total: Num
    balance: Num


class BoardRoom(BaseModel):
    id: int
    number: str
    floor: str
    room_type: RoomTypeBrief
    housekeeping: Housekeeping
    note: str
    state: Literal["free", "occupied", "arriving", "overdue"]
    stay: BookingBrief | None  # the guest in the room now
    next: BookingBrief | None  # the next booking (arriving today shows "arriving")


class BoardOut(BaseModel):
    rooms: list[BoardRoom]
    arrivals_today: int
    departures_today: int
    in_house: int
