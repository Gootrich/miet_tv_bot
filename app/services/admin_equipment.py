"""Сервис для CRUD оборудования (категории, модели, экземпляры) и ролей.

Все изменения — только для пользователей со scope admin:super.
Проверка прав — на уровне routes (require_admin).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.equipment import Category, EquipmentItem, EquipmentModel
from app.models.user import Role, User, UserRole


# Разрешённые роли для ручного назначения из UI.
# photographer/videographer выдаются только через registration_requests.
ASSIGNABLE_BY_ADMIN = {"miettv_head", "infocus_head", "admin"}

# Допустимые значения
ACCESS_POLICIES = {"all", "photographer", "videographer"}
TRACKING_TYPES = {"individual", "quantity"}
ITEM_STATUSES = {"active", "maintenance", "retired"}


# ---------------- Roles ----------------

async def list_roles(session: AsyncSession) -> list[Role]:
    result = await session.execute(select(Role).order_by(Role.id))
    return list(result.scalars().all())


async def assign_role_to_user(
    session: AsyncSession, user_id: int, role_code: str,
) -> User:
    if role_code not in ASSIGNABLE_BY_ADMIN:
        raise ValueError(
            f"Роль '{role_code}' нельзя назначить вручную. "
            f"Разрешены: {sorted(ASSIGNABLE_BY_ADMIN)}."
        )
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    role_res = await session.execute(select(Role).where(Role.code == role_code))
    role = role_res.scalar_one_or_none()
    if role is None:
        raise ValueError(f"Роль '{role_code}' не существует в БД.")

    exists = await session.execute(
        select(UserRole).where(
            UserRole.user_id == user.id, UserRole.role_id == role.id,
        )
    )
    if exists.scalar_one_or_none() is None:
        session.add(UserRole(user_id=user.id, role_id=role.id))
        await session.flush()
    return user


async def remove_role_from_user(
    session: AsyncSession, user_id: int, role_code: str, actor_id: int,
) -> User:
    if role_code not in ASSIGNABLE_BY_ADMIN:
        raise ValueError(f"Роль '{role_code}' нельзя снять вручную.")
    if role_code == "admin" and user_id == actor_id:
        raise ValueError("Нельзя снять admin с самого себя.")

    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    role_res = await session.execute(select(Role).where(Role.code == role_code))
    role = role_res.scalar_one_or_none()
    if role is None:
        raise ValueError(f"Роль '{role_code}' не существует.")

    # Защита: не оставить систему без admin
    if role_code == "admin":
        admins_count_res = await session.execute(
            select(UserRole).where(UserRole.role_id == role.id)
        )
        admins = list(admins_count_res.scalars().all())
        if len(admins) <= 1:
            raise ValueError("Нельзя снять последнего admin.")

    from sqlalchemy import delete as _delete
    await session.execute(
        _delete(UserRole).where(
            UserRole.user_id == user.id, UserRole.role_id == role.id,
        )
    )
    await session.flush()
    return user


# ---------------- Categories ----------------

async def list_categories(session: AsyncSession) -> list[Category]:
    result = await session.execute(select(Category).order_by(Category.id))
    return list(result.scalars().all())


async def create_category(
    session: AsyncSession, code: str, name: str, description: str | None,
) -> Category:
    code = code.strip().lower()
    if not code or not name.strip():
        raise ValueError("code и name обязательны.")
    exists = await session.execute(select(Category).where(Category.code == code))
    if exists.scalar_one_or_none() is not None:
        raise ValueError(f"Категория с code='{code}' уже существует.")
    cat = Category(code=code, name=name.strip(), description=description)
    session.add(cat)
    await session.flush()
    return cat


async def update_category(
    session: AsyncSession, cat_id: int,
    name: str | None, description: str | None,
) -> Category:
    cat = await session.get(Category, cat_id)
    if cat is None:
        raise ValueError("Категория не найдена.")
    if name is not None and name.strip():
        cat.name = name.strip()
    if description is not None:
        cat.description = description
    await session.flush()
    return cat


async def delete_category(session: AsyncSession, cat_id: int) -> None:
    cat = await session.get(Category, cat_id)
    if cat is None:
        raise ValueError("Категория не найдена.")
    models_res = await session.execute(
        select(EquipmentModel).where(EquipmentModel.category_id == cat_id)
    )
    if models_res.first() is not None:
        raise ValueError("Нельзя удалить категорию: в ней есть модели.")
    await session.delete(cat)
    await session.flush()


# ---------------- Models ----------------

async def list_models(
    session: AsyncSession, category_id: int | None = None,
) -> list[EquipmentModel]:
    stmt = select(EquipmentModel).order_by(EquipmentModel.id)
    if category_id is not None:
        stmt = stmt.where(EquipmentModel.category_id == category_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def create_model(
    session: AsyncSession,
    category_id: int, name: str,
    manufacturer: str | None, description: str | None,
    access_policy: str, tracking_type: str, total_quantity: int,
    short_name: str | None = None,
) -> EquipmentModel:
    if access_policy not in ACCESS_POLICIES:
        raise ValueError(f"access_policy должен быть одним из {sorted(ACCESS_POLICIES)}.")
    if tracking_type not in TRACKING_TYPES:
        raise ValueError(f"tracking_type должен быть одним из {sorted(TRACKING_TYPES)}.")
    if total_quantity < 0:
        raise ValueError("total_quantity не может быть < 0.")
    cat = await session.get(Category, category_id)
    if cat is None:
        raise ValueError("Категория не найдена.")
    m = EquipmentModel(
        category_id=category_id, name=name.strip(),
        short_name=short_name,
        manufacturer=manufacturer, description=description,
        access_policy=access_policy, tracking_type=tracking_type,
        total_quantity=total_quantity,
    )
    session.add(m)
    await session.flush()
    return m


async def update_model(
    session: AsyncSession, model_id: int, **fields,
) -> EquipmentModel:
    m = await session.get(EquipmentModel, model_id)
    if m is None:
        raise ValueError("Модель не найдена.")
    if "access_policy" in fields and fields["access_policy"] is not None:
        if fields["access_policy"] not in ACCESS_POLICIES:
            raise ValueError("Некорректный access_policy.")
        m.access_policy = fields["access_policy"]
    if "tracking_type" in fields and fields["tracking_type"] is not None:
        if fields["tracking_type"] not in TRACKING_TYPES:
            raise ValueError("Некорректный tracking_type.")
        # Q6.2: запрет смены при активных бронированиях (pending/confirmed).
        if fields["tracking_type"] != m.tracking_type:
            from app.models.booking import Booking as _Booking
            active_res = await session.execute(
                select(_Booking.id).where(
                    _Booking.model_id == m.id,
                    _Booking.status.in_(("pending", "confirmed")),
                ).limit(1)
            )
            if active_res.scalar_one_or_none() is not None:
                raise ValueError(
                    "Нельзя сменить tracking_type: есть активные "
                    "бронирования этой модели."
                )
        m.tracking_type = fields["tracking_type"]
    if "total_quantity" in fields and fields["total_quantity"] is not None:
        if fields["total_quantity"] < 0:
            raise ValueError("total_quantity < 0.")
        m.total_quantity = fields["total_quantity"]
    if "category_id" in fields and fields["category_id"] is not None:
        cat = await session.get(Category, fields["category_id"])
        if cat is None:
            raise ValueError("Новая категория не найдена.")
        m.category_id = fields["category_id"]
    for f in ("name", "short_name", "manufacturer", "description"):
        if f in fields and fields[f] is not None:
            setattr(m, f, fields[f])
    await session.flush()
    return m


async def delete_model(session: AsyncSession, model_id: int) -> None:
    m = await session.get(EquipmentModel, model_id)
    if m is None:
        raise ValueError("Модель не найдена.")
    items_res = await session.execute(
        select(EquipmentItem).where(EquipmentItem.model_id == model_id)
    )
    if items_res.first() is not None:
        raise ValueError("Нельзя удалить модель: есть физические экземпляры.")
    await session.delete(m)
    await session.flush()


# ---------------- Items ----------------

async def list_items(
    session: AsyncSession, model_id: int | None = None,
) -> list[EquipmentItem]:
    stmt = select(EquipmentItem).order_by(EquipmentItem.id)
    if model_id is not None:
        stmt = stmt.where(EquipmentItem.model_id == model_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def create_item(
    session: AsyncSession,
    model_id: int, inventory_number: str, serial_number: str | None,
    status_: str, notes: str | None,
) -> EquipmentItem:
    if status_ not in ITEM_STATUSES:
        raise ValueError(f"status должен быть одним из {sorted(ITEM_STATUSES)}.")
    m = await session.get(EquipmentModel, model_id)
    if m is None:
        raise ValueError("Модель не найдена.")
    inv = inventory_number.strip()
    if not inv:
        raise ValueError("inventory_number обязателен.")
    exists_res = await session.execute(
        select(EquipmentItem).where(EquipmentItem.inventory_number == inv)
    )
    if exists_res.scalar_one_or_none() is not None:
        raise ValueError(f"Инвентарный номер '{inv}' уже используется.")
    it = EquipmentItem(
        model_id=model_id, inventory_number=inv,
        serial_number=serial_number, status=status_, notes=notes,
    )
    session.add(it)
    await session.flush()
    return it


async def update_item(
    session: AsyncSession, item_id: int, **fields,
) -> EquipmentItem:
    it = await session.get(EquipmentItem, item_id)
    if it is None:
        raise ValueError("Экземпляр не найден.")
    if "status" in fields and fields["status"] is not None:
        if fields["status"] not in ITEM_STATUSES:
            raise ValueError("Некорректный status.")
        it.status = fields["status"]
    for f in ("serial_number", "notes"):
        if f in fields:
            setattr(it, f, fields[f])
    await session.flush()
    return it


async def delete_item(session: AsyncSession, item_id: int) -> None:
    from app.models.booking import Booking
    it = await session.get(EquipmentItem, item_id)
    if it is None:
        raise ValueError("Экземпляр не найден.")
    bookings_res = await session.execute(
        select(Booking).where(Booking.item_id == item_id)
    )
    if bookings_res.first() is not None:
        raise ValueError("Нельзя удалить экземпляр: есть бронирования.")
    await session.delete(it)
    await session.flush()
