"""Pydantic-схемы ответов API каталога.

Схемы описывают безопасный публичный формат ответов и не являются
ORM-моделями. Внутренние поля (например, telegram_id) сюда не попадают.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime


class EquipmentItemPublicOut(BaseModel):
    """Публичное представление экземпляра: без inventory/serial/notes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str = Field(description="active | maintenance | retired")


class EquipmentItemOut(EquipmentItemPublicOut):
    """Полное представление экземпляра — только для одобренных участников."""

    inventory_number: str
    serial_number: str | None = None
    notes: str | None = None


class EquipmentModelOut(BaseModel):
    """Модель оборудования в каталоге (краткий вид)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    name: str
    manufacturer: str | None = None
    description: str | None = None
    tracking_type: str = Field(description="individual | quantity")
    total_quantity: int
    available_now: int = 0
    free_until: datetime | None = None
    next_busy_at: datetime | None = None
    access_policy: str = Field(
        description="all | photographer | videographer",
    )


class EquipmentModelDetailPublicOut(EquipmentModelOut):
    """Публичный взгляд на модель: без inventory/serial/notes в items."""

    view: Literal["public"] = "public"
    items: list[EquipmentItemPublicOut] = Field(default_factory=list)


class EquipmentModelDetailOut(EquipmentModelOut):
    """Модель с экземплярами — только для одобренных участников."""

    view: Literal["admin"] = "admin"
    items: list[EquipmentItemOut] = Field(default_factory=list)


class CategoryWithModelsOut(BaseModel):
    """Категория вместе со списком моделей."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str = Field(description="Стабильный slug: cameras, lenses, ...")
    name: str = Field(description="Человекочитаемое имя: Камеры, Оптика, ...")
    description: str | None = None
    models: list[EquipmentModelOut] = Field(default_factory=list)


class HealthOut(BaseModel):
    """Ответ health-check."""

    status: str
    database: str


class BookingItemIn(BaseModel):
    """Одна позиция пакетной брони (модель + количество)."""
    model_id: int
    quantity: int = 1


class BookingRequest(BaseModel):
    """Схема запроса на создание бронирования (одиночная или пакетная)."""
    item_id: int | None = None
    model_id: int | None = None
    quantity: int = 1
    items: list[BookingItemIn] | None = None
    planned_start: str
    planned_end: str
    comment: str | None = None


class BookingGroupOut(BaseModel):
    """Пакетная бронь: group_id + список броней."""
    group_id: int
    bookings: list["BookingOut"]


class BookingReturnPartialRequest(BaseModel):
    """Частичный возврат: список booking_id в группе."""
    booking_ids: list[int]


class BookingOut(BaseModel):
    """Схема ответа с данными бронирования.

    Включает денормализованные поля (user_name, model_name, category_name,
    item_inventory_number), чтобы фронту не нужно было делать N+1 запросов.
    Собирается через ``from_orm_booking``.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int | None = None
    model_id: int | None = None
    user_id: int
    quantity: int
    planned_start: datetime
    planned_end: datetime
    actual_checkout: datetime | None = None
    actual_return: datetime | None = None
    status: str
    comment: str | None = None
    created_at: datetime | None = None
    group_id: int | None = None
    # денормализация:
    user_name: str | None = None
    model_name: str | None = None
    category_name: str | None = None
    item_inventory_number: str | None = None

    @classmethod
    def from_orm_booking(cls, booking) -> "BookingOut":
        """Собирает BookingOut из Booking с учётом подгруженных relationships.

        Ожидает, что booking.user / booking.model / booking.item уже
        подгружены (selectinload). category_name берётся из
        booking.model.category, если она подгружена, иначе None.
        """
        user = getattr(booking, "user", None)
        model = getattr(booking, "model", None)
        item = getattr(booking, "item", None)

        category_name = None
        if model is not None:
            category = getattr(model, "category", None)
            if category is not None:
                category_name = category.name

        return cls(
            id=booking.id,
            item_id=booking.item_id,
            model_id=booking.model_id,
            user_id=booking.user_id,
            quantity=booking.quantity,
            planned_start=booking.planned_start,
            planned_end=booking.planned_end,
            actual_checkout=booking.actual_checkout,
            actual_return=booking.actual_return,
            status=booking.status,
            comment=booking.comment,
            created_at=booking.created_at,
            group_id=booking.group_id,
            user_name=user.full_name if user is not None else None,
            model_name=model.name if model is not None else None,
            category_name=category_name,
            item_inventory_number=(
                item.inventory_number if item is not None else None
            ),
        )


class BookingMoveRequest(BaseModel):
    """Запрос на перенос брони (перезапись planned_start/planned_end)."""
    planned_start: str
    planned_end: str


class BookingHistoryOut(BaseModel):
    """Одно событие истории бронирования."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    booking_id: int
    actor_user_id: int | None = None
    event_type: str
    details: str | None = None
    created_at: datetime

# --- User / admin schemas ---

from app.models.user import User  # noqa: E402


class UserOut(BaseModel):
    id: int
    telegram_id: int
    full_name: str
    username: str | None
    status: str
    is_active: bool
    block_reason: str | None
    blocked_until: datetime | None
    role_codes: list[str] = Field(default_factory=list)
    created_at: datetime
    approved_at: datetime | None = None

    @classmethod
    def from_orm_user(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            telegram_id=user.telegram_id,
            full_name=user.full_name,
            username=user.username,
            status=user.status,
            is_active=user.is_active,
            block_reason=user.block_reason,
            blocked_until=user.blocked_until,
            role_codes=user.role_codes(),
            created_at=user.created_at,
            approved_at=user.approved_at,
        )


class ApproveUserRequest(BaseModel):
    role_codes: list[str] = Field(
        default_factory=list,
        description="photographer | videographer | universal | admin",
    )


class RejectUserRequest(BaseModel):
    reason: str = ""


class BlockUserRequest(BaseModel):
    hours: int | None = Field(
        default=None,
        description="None или 0 — бессрочно; >0 — на N часов",
    )
    reason: str = ""


class RegistrationRequestOut(BaseModel):
    """Одна заявка на вступление в клуб."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    club_code: str = Field(description="photographer | videographer")
    status: str = Field(description="pending | approved | rejected | cancelled")
    created_at: datetime
    updated_at: datetime
    decided_at: datetime | None = None
    decided_by_id: int | None = None
    decision_reason: str | None = None


class RejectRequestPayload(BaseModel):
    reason: str = ""


# ============================================================
# Admin: roles
# ============================================================

class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    scopes: list[str] = Field(default_factory=list)


class AssignRoleRequest(BaseModel):
    role_code: str = Field(
        description="miettv_head | infocus_head | admin"
    )


# ============================================================
# Admin: categories
# ============================================================

class CategoryAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None = None


class CategoryCreateRequest(BaseModel):
    code: str
    name: str
    description: str | None = None


class CategoryUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


# ============================================================
# Admin: models
# ============================================================

class ModelAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    name: str
    manufacturer: str | None = None
    description: str | None = None
    access_policy: str
    tracking_type: str
    total_quantity: int


class ModelCreateRequest(BaseModel):
    category_id: int
    name: str
    manufacturer: str | None = None
    description: str | None = None
    access_policy: str = "all"
    tracking_type: str = "quantity"
    total_quantity: int = 1


class ModelUpdateRequest(BaseModel):
    category_id: int | None = None
    name: str | None = None
    manufacturer: str | None = None
    description: str | None = None
    access_policy: str | None = None
    tracking_type: str | None = None
    total_quantity: int | None = None


# ============================================================
# Admin: items
# ============================================================

class ItemAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    model_id: int
    inventory_number: str
    serial_number: str | None = None
    status: str
    notes: str | None = None


class ItemCreateRequest(BaseModel):
    model_id: int
    inventory_number: str
    serial_number: str | None = None
    status: str = "active"
    notes: str | None = None


class ItemUpdateRequest(BaseModel):
    serial_number: str | None = None
    status: str | None = None
    notes: str | None = None
