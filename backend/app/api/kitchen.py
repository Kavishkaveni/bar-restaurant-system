"""Kitchen screen: food on bills shows up as tickets the cooks move along."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, require_any
from app.models import Order, OrderLine, User

router = APIRouter(prefix="/kitchen", tags=["kitchen"])

KitchenUser = Annotated[User, Depends(require_any("kitchen.view", "pos.order"))]
FLOW = ["new", "preparing", "ready", "served"]


class TicketLine(BaseModel):
    id: int
    name: str
    qty: float
    note: str
    kitchen_status: str
    created_at: datetime
    kitchen_updated_at: datetime | None


class Ticket(BaseModel):
    order_id: int
    label: str
    order_note: str
    waiter: str | None
    lines: list[TicketLine]
    oldest: datetime


class StatusIn(BaseModel):
    status: Literal["new", "preparing", "ready", "served"]


def _label(order: Order) -> str:
    from app.api.orders import label  # avoid a circular import at load time

    return label(order)


@router.get("/tickets", response_model=list[Ticket])
async def tickets(_: KitchenUser, db: DB):
    """Food not yet served, grouped by bill, oldest first."""
    lines = list(
        await db.scalars(
            select(OrderLine)
            .join(Order)
            .where(OrderLine.kitchen_status.in_(["new", "preparing", "ready"]), Order.status.in_(["open", "paid"]))
            .options(selectinload(OrderLine.order).selectinload(Order.table),
                     selectinload(OrderLine.order).selectinload(Order.opener))
            .order_by(OrderLine.created_at, OrderLine.id)
        )
    )
    grouped: dict[int, Ticket] = {}
    for line in lines:
        o = line.order
        t = grouped.get(o.id)
        if not t:
            t = grouped[o.id] = Ticket(
                order_id=o.id, label=_label(o), order_note=o.note, waiter=o.opener.name if o.opener else None,
                lines=[], oldest=line.created_at,
            )
        t.lines.append(
            TicketLine(id=line.id, name=line.name, qty=float(line.qty), note=line.note,
                       kitchen_status=line.kitchen_status, created_at=line.created_at,
                       kitchen_updated_at=line.kitchen_updated_at)
        )
    return sorted(grouped.values(), key=lambda t: t.oldest)


@router.post("/lines/{line_id}/status", response_model=TicketLine)
async def set_status(line_id: int, body: StatusIn, _: KitchenUser, db: DB):
    line = await db.get(OrderLine, line_id)
    if not line or line.kitchen_status is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a kitchen item")
    order = await db.get(Order, line.order_id)
    if order.status not in ("open", "paid"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bill was voided")
    line.kitchen_status = body.status
    line.kitchen_updated_at = datetime.now(timezone.utc)
    await db.commit()
    return TicketLine(id=line.id, name=line.name, qty=float(line.qty), note=line.note,
                      kitchen_status=line.kitchen_status, created_at=line.created_at,
                      kitchen_updated_at=line.kitchen_updated_at)
