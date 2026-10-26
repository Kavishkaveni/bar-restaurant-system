"""Open bottles for pegs.

The stock ledger (in ml) is the truth about how much liquor there is. Open
bottle records say how that ml is split: which bottles are open and how much
is left in each. Sealed bottles = (stock ml - ml left in open bottles) / size.
"""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item, OpenBottle, User
from app.services import stock

ZERO = Decimal(0)


def pours_from_bottle(item: Item, deduct_ml: Decimal) -> bool:
    """A sale pours from an open bottle when it's less than a whole bottle of
    an ml-measured item (a peg or shot)."""
    return item.base_unit == "ml" and item.unit_size > 1 and deduct_ml < item.unit_size


async def open_bottles(db: AsyncSession, item_id: int) -> list[OpenBottle]:
    return list(
        await db.scalars(
            select(OpenBottle)
            .where(OpenBottle.item_id == item_id, OpenBottle.status == "open")
            .order_by(OpenBottle.opened_at, OpenBottle.id)
        )
    )


async def open_ml(db: AsyncSession, item_id: int) -> Decimal:
    return Decimal(
        await db.scalar(
            select(func.coalesce(func.sum(OpenBottle.remaining_ml), 0)).where(
                OpenBottle.item_id == item_id, OpenBottle.status == "open"
            )
        )
    )


async def sealed_count(db: AsyncSession, item: Item, on_hand_ml: Decimal | None = None) -> int:
    if on_hand_ml is None:
        on_hand_ml = (await stock.on_hand(db, [item.id]))[item.id]
    sealed_ml = on_hand_ml - await open_ml(db, item.id)
    return max(int(sealed_ml // item.unit_size), 0)


async def open_new(db: AsyncSession, item: Item, user: User | None, note: str = "") -> OpenBottle:
    bottle = OpenBottle(
        item_id=item.id, size_ml=item.unit_size, remaining_ml=item.unit_size,
        opened_by=user.id if user else None, note=note,
    )
    db.add(bottle)
    await db.flush()
    return bottle


async def fit_to_stock(db: AsyncSession, item: Item) -> bool:
    """Open bottles can never hold more than the stock. When stock went down
    another way (a whole bottle sold, wastage, a stock count) and the open
    bottles now add up to more, take the difference off them: first bottles
    that were opened but never poured from, then the newest. Returns True if
    anything changed."""
    on_hand = max((await stock.on_hand(db, [item.id]))[item.id], ZERO)
    open_list = await open_bottles(db, item.id)
    extra = sum((b.remaining_ml for b in open_list), ZERO) - on_hand
    if extra < 0:
        return await _add_loose(db, item, open_list, (-extra) % item.unit_size)
    if extra == 0:
        return False
    untouched = [b for b in reversed(open_list) if b.remaining_ml >= b.size_ml]
    used = [b for b in reversed(open_list) if b.remaining_ml < b.size_ml]
    now = datetime.now(timezone.utc)
    for bottle in untouched + used:
        if extra <= 0:
            break
        take = min(bottle.remaining_ml, extra)
        bottle.remaining_ml -= take
        extra -= take
        if bottle.remaining_ml == 0:
            bottle.status = "finished"
            bottle.finished_at = now
            bottle.note = ((bottle.note + " · " if bottle.note else "") + "Closed: stock went down another way")[:200]
    await db.flush()
    return True


async def _add_loose(db: AsyncSession, item: Item, open_list: list[OpenBottle], loose: Decimal) -> bool:
    """Stock that isn't whole sealed bottles (e.g. a count of 1 bottle + 250 ml)
    must sit in an open bottle: adjust the newest one, or open one."""
    if loose <= 0:
        return False
    if not open_list:
        db.add(OpenBottle(item_id=item.id, size_ml=item.unit_size, remaining_ml=loose,
                          note="Part bottle in stock"))
    else:
        bottle = open_list[-1]
        new = bottle.remaining_ml + loose
        bottle.remaining_ml = new - item.unit_size if new > bottle.size_ml else new
        if bottle.remaining_ml == 0:
            bottle.status = "finished"
            bottle.finished_at = datetime.now(timezone.utc)
    await db.flush()
    return True


async def pour(db: AsyncSession, item: Item, ml: Decimal, user: User | None) -> Decimal:
    """Take ml from open bottles, oldest first, opening sealed bottles as
    needed. Call BEFORE the sale's stock movement is added. Returns ml that
    couldn't be poured from any bottle (stock already ran out)."""
    await fit_to_stock(db, item)
    on_hand = (await stock.on_hand(db, [item.id]))[item.id]
    need = ml
    bottles = await open_bottles(db, item.id)
    sealed = await sealed_count(db, item, on_hand)
    now = datetime.now(timezone.utc)
    while need > 0:
        if not bottles:
            if sealed <= 0:
                break
            bottles.append(await open_new(db, item, user, note="Opened automatically for a peg"))
            sealed -= 1
        bottle = bottles[0]
        take = min(bottle.remaining_ml, need)
        bottle.remaining_ml -= take
        need -= take
        if bottle.remaining_ml == 0:
            bottle.status = "finished"
            bottle.finished_at = now
            bottle.finished_by = user.id if user else None
            bottles.pop(0)
    return need


async def put_back(db: AsyncSession, item: Item, ml: Decimal) -> None:
    """A voided peg: return the ml to the newest open bottle, up to its size."""
    bottles = await open_bottles(db, item.id)
    for bottle in reversed(bottles):
        room = bottle.size_ml - bottle.remaining_ml
        give = min(room, ml)
        bottle.remaining_ml += give
        ml -= give
        if ml <= 0:
            return