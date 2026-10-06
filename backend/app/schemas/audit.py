from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user: AuditUser | None
    action: str
    entity: str
    entity_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    ip: str | None
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    page: int
    page_size: int
