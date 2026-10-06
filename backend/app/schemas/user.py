from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

PIN_PATTERN = r"^\d{4}$"


class RoleBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    label: str


class RoleOut(RoleBrief):
    is_system: bool
    permission_names: list[str]


class RolePermissionsUpdate(BaseModel):
    permissions: list[str]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    username: str
    role: RoleBrief
    is_active: bool
    has_pin: bool
    last_login_at: datetime | None
    created_at: datetime


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)
    role_id: int

    @field_validator("username")
    @classmethod
    def lower_username(cls, v: str) -> str:
        return v.lower()


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role_id: int | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)
    remove_pin: bool = False


class StaffTile(BaseModel):
    """Shown on the PIN screen of a shared counter device."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: RoleBrief
