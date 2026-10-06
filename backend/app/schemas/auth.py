from pydantic import BaseModel, Field

from app.schemas.user import PIN_PATTERN, UserOut


class LoginRequest(BaseModel):
    username: str
    password: str


class PinLoginRequest(BaseModel):
    user_id: int
    pin: str = Field(pattern=PIN_PATTERN)


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class Me(BaseModel):
    user: UserOut
    permissions: list[str]


class LoginResponse(TokenPair):
    user: UserOut
    permissions: list[str]
