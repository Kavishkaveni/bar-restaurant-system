"""Tables, selling options and the POS menu."""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.models import Category, DiningTable, Item, Order, SellOption, User
from app.schemas.pos import (
    Menu,
    MenuCategory,
    MenuItem,
    MenuOption,
    OpenOrderBrief,
    SellOptionIn,
    SellOptionOut,
    TableIn,
    TableOut,
)
from app.services import audit, billing, stock

router = APIRouter(tags=["pos"])

POS_USERS = ("pos.order", "pos.payment", "pos.room_service")
PosUser = Annotated[User, Depends(require_any(*POS_USERS))]
CatalogueManager = Annotated[User, Depends(require("catalogue.manage"))]


# ---- Tables ---------------------------------------------------------------------

@router.get("/tables", response_model=list[TableOut])
async def list_tables(_: PosUser, db: DB):
    tables = list(
        await db.scalars(
            select(DiningTable).where(DiningTable.is_active.is_(True)).order_by(DiningTable.sort_order, DiningTable.name)
        )
    )
    open_orders = list(
        await db.scalars(select(Order).where(Order.status == "open", Order.table_id.is_not(None)).order_by(Order.id))
    )
    by_table: dict[int, list[OpenOrderBrief]] = {}
    for o in open_orders:
        by_table.setdefault(o.table_id, []).append(
            OpenOrderBrief(
                id=o.id,
                total=billing.totals(o).total,
                item_count=sum((line.qty for line in o.lines), Decimal(0)),
                opened_at=o.created_at,
                printed=o.printed_count > 0,
            )
        )
    return [TableOut.model_validate(t).model_copy(update={"open_orders": by_table.get(t.id, [])}) for t in tables]


async def _name_taken(db: DB, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(DiningTable.id).where(func.lower(DiningTable.name) == name.lower(), DiningTable.is_active.is_(True))
    if exclude_id:
        stmt = stmt.where(DiningTable.id != exclude_id)
    return bool(await db.scalar(stmt))


@router.post("/tables", response_model=TableOut, status_code=status.HTTP_201_CREATED)
async def create_table(body: TableIn, actor: CatalogueManager, db: DB, request: Request):
    if await _name_taken(db, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a table called "{body.name}"')
    table = DiningTable(**body.model_dump())
    db.add(table)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="table", entity_id=table.id, after=body.model_dump(),
                 request=request)
    await db.commit()
    return table


@router.put("/tables/{table_id}", response_model=TableOut)
async def update_table(table_id: int, body: TableIn, actor: CatalogueManager, db: DB, request: Request):
    table = await db.get(DiningTable, table_id)
    if not table or not table.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Table not found")
    if await _name_taken(db, body.name, exclude_id=table.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a table called "{body.name}"')
    before = {k: getattr(table, k) for k in body.model_dump()}
    for k, v in body.model_dump().items():
        setattr(table, k, v)
    audit.record(db, user=actor, action="update", entity="table", entity_id=table.id, before=before,
                 after=body.model_dump(), request=request)
    await db.commit()
    return table


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(table_id: int, actor: CatalogueManager, db: DB, request: Request):
    table = await db.get(DiningTable, table_id)
    if not table or not table.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Table not found")
    if await db.scalar(select(Order.id).where(Order.table_id == table.id, Order.status == "open").limit(1)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This table has an open bill. Close or move it first.")
    table.is_active = False
    audit.record(db, user=actor, action="delete", entity="table", entity_id=table.id, before={"name": table.name},
                 request=request)
    await db.commit()


# ---- Selling options -------------------------------------------------------------

@router.get("/items/{item_id}/options", response_model=list[SellOptionOut])
async def list_options(item_id: int, _: Annotated[User, Depends(require_any(*STOCK_VIEWERS, *POS_USERS))], db: DB):
    return list(
        await db.scalars(
            select(SellOption)
            .where(SellOption.item_id == item_id, SellOption.is_active.is_(True))
            .order_by(SellOption.sort_order, SellOption.id)
        )
    )


async def _active_item(db: DB, item_id: int) -> Item:
    item = await db.get(Item, item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return item


@router.post("/items/{item_id}/options", response_model=SellOptionOut, status_code=status.HTTP_201_CREATED)
async def create_option(item_id: int, body: SellOptionIn, actor: CatalogueManager, db: DB, request: Request):
    item = await _active_item(db, item_id)
    option = SellOption(item_id=item.id, **body.model_dump())
    db.add(option)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="sell_option", entity_id=option.id,
                 after={"name": f"{item.name}: {body.name}", "price": float(body.price),
                        "takes": stock.format_qty(item, body.deduct_qty)}, request=request)
    await db.commit()
    return option


@router.put("/items/{item_id}/options/{option_id}", response_model=SellOptionOut)
async def update_option(item_id: int, option_id: int, body: SellOptionIn, actor: CatalogueManager, db: DB,
                        request: Request):
    item = await _active_item(db, item_id)
    option = await db.get(SellOption, option_id)
    if not option or option.item_id != item.id or not option.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Option not found")
    before = {"name": f"{item.name}: {option.name}", "price": float(option.price)}
    for k, v in body.model_dump().items():
        setattr(option, k, v)
    audit.record(db, user=actor, action="update", entity="sell_option", entity_id=option.id, before=before,
                 after={"name": f"{item.name}: {body.name}", "price": float(body.price)}, request=request)
    await db.commit()
    return option


@router.delete("/items/{item_id}/options/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_option(item_id: int, option_id: int, actor: CatalogueManager, db: DB, request: Request):
    option = await db.get(SellOption, option_id)
    if not option or option.item_id != item_id or not option.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Option not found")
    option.is_active = False
    audit.record(db, user=actor, action="delete", entity="sell_option", entity_id=option.id,
                 before={"name": option.name}, request=request)
    await db.commit()


# ---- Menu ------------------------------------------------------------------------

@router.get("/pos/menu", response_model=Menu)
async def menu(_: PosUser, db: DB):
    """Everything that can be sold: items with a selling price, plus their options."""
    items = list(
        await db.scalars(
            select(Item).join(Category).where(Item.is_active.is_(True), Category.is_active.is_(True))
            .order_by(Item.name)
        )
    )
    options = list(
        await db.scalars(
            select(SellOption).where(SellOption.is_active.is_(True)).order_by(SellOption.sort_order, SellOption.id)
        )
    )
    by_item: dict[int, list[SellOption]] = {}
    for o in options:
        by_item.setdefault(o.item_id, []).append(o)

    on_hand = await stock.on_hand(db, [i.id for i in items])
    out: list[MenuItem] = []
    used_categories: dict[int, Category] = {}
    for item in items:
        opts: list[MenuOption] = []
        if item.selling_price is not None:
            opts.append(MenuOption(id=None, name=f"1 {item.stock_unit}", price=item.selling_price))
        opts += [MenuOption(id=o.id, name=o.name, price=o.price) for o in by_item.get(item.id, [])]
        if not opts:
            continue  # ingredients and supplies that aren't sold
        qty = on_hand[item.id]
        smallest = min([item.unit_size] + [o.deduct_qty for o in by_item.get(item.id, [])])
        out.append(
            MenuItem(
                id=item.id,
                name=item.name,
                category_id=item.category_id,
                stock_unit=item.stock_unit,
                track_stock=item.track_stock,
                on_hand_display=stock.format_qty(item, qty) if item.track_stock else "",
                out_of_stock=item.track_stock and qty < smallest,
                options=opts,
            )
        )
        used_categories[item.category_id] = item.category
    cats = sorted(used_categories.values(), key=lambda c: (["bar", "sundry", "food", "other"].index(c.module), c.name))
    return Menu(categories=[MenuCategory(id=c.id, name=c.name, module=c.module) for c in cats], items=out)
