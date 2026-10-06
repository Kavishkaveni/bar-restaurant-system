from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select

from app.api.deps import DB, STOCK_VIEWERS, require, require_any
from app.models import Category, Item, RecipeLine, StockMovement, Supplier, User
from app.schemas.inventory import CategoryIn, CategoryOut, ItemIn, ItemOut, Module
from app.services import audit, stock

router = APIRouter(tags=["catalogue"])

Viewer = Annotated[User, Depends(require_any(*STOCK_VIEWERS))]
Manager = Annotated[User, Depends(require("catalogue.manage"))]


# ---- Categories -------------------------------------------------------------

async def _category_name_taken(db: DB, name: str, module: str, exclude_id: int | None = None) -> bool:
    stmt = select(Category.id).where(
        func.lower(Category.name) == name.lower(), Category.module == module, Category.is_active.is_(True)
    )
    if exclude_id:
        stmt = stmt.where(Category.id != exclude_id)
    return bool(await db.scalar(stmt))


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(_: Viewer, db: DB, module: Module | None = None):
    counts = (
        select(Item.category_id, func.count().label("n"))
        .where(Item.is_active.is_(True))
        .group_by(Item.category_id)
        .subquery()
    )
    stmt = (
        select(Category, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.category_id == Category.id)
        .where(Category.is_active.is_(True))
        .order_by(Category.module, Category.name)
    )
    if module:
        stmt = stmt.where(Category.module == module)
    rows = await db.execute(stmt)
    return [CategoryOut.model_validate(c).model_copy(update={"item_count": n}) for c, n in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(body: CategoryIn, actor: Manager, db: DB, request: Request):
    if await _category_name_taken(db, body.name, body.module):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a "{body.name}" category')
    cat = Category(name=body.name, module=body.module)
    db.add(cat)
    await db.flush()
    audit.record(db, user=actor, action="create", entity="category", entity_id=cat.id,
                 after=body.model_dump(), request=request)
    await db.commit()
    return cat


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryIn, actor: Manager, db: DB, request: Request):
    cat = await db.get(Category, category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    if await _category_name_taken(db, body.name, body.module, exclude_id=cat.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'There is already a "{body.name}" category')
    before = {"name": cat.name, "module": cat.module}
    cat.name, cat.module = body.name, body.module
    audit.record(db, user=actor, action="update", entity="category", entity_id=cat.id,
                 before=before, after=body.model_dump(), request=request)
    await db.commit()
    return cat


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: int, actor: Manager, db: DB, request: Request):
    cat = await db.get(Category, category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    in_use = await db.scalar(
        select(func.count()).select_from(Item).where(Item.category_id == cat.id, Item.is_active.is_(True))
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} item{'s' if in_use != 1 else ''} still use this category. Move or delete them first.",
        )
    cat.is_active = False
    audit.record(db, user=actor, action="delete", entity="category", entity_id=cat.id,
                 before={"name": cat.name}, request=request)
    await db.commit()


# ---- Items --------------------------------------------------------------------

async def with_stock(db: DB, items: list[Item]) -> list[ItemOut]:
    """Attach on-hand stock, value and low-stock flag from the ledger."""
    totals = await stock.on_hand(db, [i.id for i in items])
    ids = [i.id for i in items]
    moved = (
        set(await db.scalars(select(func.distinct(StockMovement.item_id)).where(StockMovement.item_id.in_(ids))))
        if ids
        else set()
    )
    out = []
    for item in items:
        qty = totals.get(item.id, Decimal(0))
        out.append(
            ItemOut.model_validate(item).model_copy(
                update={
                    "on_hand": qty,
                    "on_hand_display": (
                        "Made to order" if item.kind == "build_assembly"
                        else stock.format_qty(item, qty) if item.track_stock else "Not tracked"
                    ),
                    "stock_value": (qty * item.avg_cost).quantize(Decimal("0.01")) if qty > 0 else Decimal(0),
                    "is_low": item.track_stock and qty < item.reorder_level * item.unit_size,
                    "has_movements": item.id in moved,
                }
            )
        )
    return out


async def _check_refs(db: DB, body: ItemIn) -> None:
    cat = await db.get(Category, body.category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a category")
    if body.supplier_id is not None:
        sup = await db.get(Supplier, body.supplier_id)
        if not sup or not sup.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Supplier not found")
    if body.unit_size < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Size must be at least 1")
    if body.base_unit == "piece" and body.unit_size != body.unit_size.to_integral_value():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pieces per pack must be a whole number")


async def _name_taken(db: DB, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(Item.id).where(func.lower(Item.name) == name.lower(), Item.is_active.is_(True))
    if exclude_id:
        stmt = stmt.where(Item.id != exclude_id)
    return bool(await db.scalar(stmt))


def _snapshot(item: Item) -> dict:
    return {
        "name": item.name,
        "category_id": item.category_id,
        "base_unit": item.base_unit,
        "unit_size": float(item.unit_size),
        "stock_unit": item.stock_unit,
        "cost_price": float(item.cost_price),
        "selling_price": float(item.selling_price) if item.selling_price is not None else None,
        "reorder_level": float(item.reorder_level),
        "track_stock": item.track_stock,
        "supplier_id": item.supplier_id,
        "sku": item.sku,
        "kind": item.kind,
    }


@router.get("/items", response_model=list[ItemOut])
async def list_items(
    _: Viewer,
    db: DB,
    q: str | None = None,
    category_id: int | None = None,
    module: Module | None = None,
    low_only: bool = False,
    include_inactive: bool = False,
):
    stmt = select(Item).join(Category).order_by(Category.module, Category.name, Item.name)
    if not include_inactive:
        stmt = stmt.where(Item.is_active.is_(True))
    if q:
        like = f"%{q.lower().strip()}%"
        stmt = stmt.where(or_(func.lower(Item.name).like(like), func.lower(Item.sku).like(like)))
    if category_id:
        stmt = stmt.where(Item.category_id == category_id)
    if module:
        stmt = stmt.where(Category.module == module)
    result = await with_stock(db, list(await db.scalars(stmt)))
    if low_only:
        result = [i for i in result if i.is_low]
    return result


@router.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(body: ItemIn, actor: Manager, db: DB, request: Request):
    await _check_refs(db, body)
    if await _name_taken(db, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'An item called "{body.name}" already exists')
    item = Item(**body.normalised())
    db.add(item)
    await db.flush()
    await db.refresh(item, ["category", "supplier"])
    audit.record(db, user=actor, action="create", entity="item", entity_id=item.id,
                 after=_snapshot(item), request=request)
    await db.commit()
    return (await with_stock(db, [item]))[0]


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(item_id: int, _: Viewer, db: DB):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return (await with_stock(db, [item]))[0]


@router.put("/items/{item_id}", response_model=ItemOut)
async def update_item(item_id: int, body: ItemIn, actor: Manager, db: DB, request: Request):
    item = await db.get(Item, item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    await _check_refs(db, body)
    if await _name_taken(db, body.name, exclude_id=item.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f'An item called "{body.name}" already exists')

    data = body.normalised()
    unit_changed = (
        data["base_unit"] != item.base_unit or data["unit_size"] != item.unit_size or data["kind"] != item.kind
    )
    if unit_changed and await stock.has_movements(db, item.id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The unit or size can't change after stock has been recorded, because past stock was "
            "counted in the old unit. Create a new item instead.",
        )

    before = _snapshot(item)
    for key, value in data.items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item, ["category", "supplier"])
    audit.record(db, user=actor, action="update", entity="item", entity_id=item.id,
                 before=before, after=_snapshot(item), request=request)
    await db.commit()
    return (await with_stock(db, [item]))[0]


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int, actor: Manager, db: DB, request: Request):
    """Hidden from lists and new purchases; history and old purchases keep it."""
    item = await db.get(Item, item_id)
    if not item or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    used_in = list(
        await db.scalars(
            select(Item.name).join(RecipeLine, RecipeLine.item_id == Item.id)
            .where(RecipeLine.component_id == item.id, Item.is_active.is_(True))
        )
    )
    if used_in:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{item.name} is an ingredient of {', '.join(used_in)}. Remove it from those recipes first.",
        )
    item.is_active = False
    audit.record(db, user=actor, action="delete", entity="item", entity_id=item.id,
                 before={"name": item.name}, request=request)
    await db.commit()


@router.post("/items/{item_id}/restore", response_model=ItemOut)
async def restore_item(item_id: int, actor: Manager, db: DB, request: Request):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    if item.is_active:
        return (await with_stock(db, [item]))[0]
    if await _name_taken(db, item.name):
        raise HTTPException(status.HTTP_409_CONFLICT, f'Another active item is already called "{item.name}"')
    item.is_active = True
    audit.record(db, user=actor, action="restore", entity="item", entity_id=item.id,
                 after={"name": item.name}, request=request)
    await db.commit()
    return (await with_stock(db, [item]))[0]
