from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Booking, Category, EquipmentItem, EquipmentModel


async def list_categories(session: AsyncSession) -> list[Category]:
    """Все категории по алфавиту."""
    result = await session.execute(select(Category).order_by(Category.name))
    return list(result.scalars().all())


async def list_models_by_category(
    session: AsyncSession, category_id: int
) -> list[EquipmentModel]:
    """Модели в категории по алфавиту."""
    result = await session.execute(
        select(EquipmentModel)
        .where(EquipmentModel.category_id == category_id)
        .order_by(EquipmentModel.name)
    )
    return list(result.scalars().all())


async def get_model_with_items(
    session: AsyncSession, model_id: int
) -> EquipmentModel | None:
    """Модель вместе со всеми её экземплярами (eager load)."""
    result = await session.execute(
        select(EquipmentModel)
        .where(EquipmentModel.id == model_id)
        .options(
            selectinload(EquipmentModel.items),
            selectinload(EquipmentModel.category),
        )
    )
    return result.scalar_one_or_none()


async def _compute_availability(
    session: AsyncSession,
    models: list[EquipmentModel],
    now: datetime | None = None,
) -> dict[int, dict]:
    """Для списка моделей считает available_now / free_until / next_busy_at.

    Возвращает {model_id: {...}}. Ничего не пишет в БД.
    """
    if not models:
        return {}
    now = now or datetime.now(timezone.utc)
    model_ids = [m.id for m in models]

    # Все активные и будущие брони по этим моделям одним SELECT-ом.
    result = await session.execute(
        select(Booking).where(
            Booking.model_id.in_(model_ids),
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_end > now,
        )
    )
    bookings = list(result.scalars().all())

    # group by model_id
    per_model: dict[int, list[Booking]] = {mid: [] for mid in model_ids}
    for b in bookings:
        per_model.setdefault(b.model_id, []).append(b)

    out: dict[int, dict] = {}
    for m in models:
        mine = per_model.get(m.id, [])
        booked_now_qty = 0
        free_until: datetime | None = None  # ближайшее будущее начало
        next_release: datetime | None = None  # ближайшее окончание текущей

        for b in mine:
            if b.planned_start <= now < b.planned_end:
                booked_now_qty += (b.quantity or 1)
                if next_release is None or b.planned_end < next_release:
                    next_release = b.planned_end
            elif b.planned_start > now:
                if free_until is None or b.planned_start < free_until:
                    free_until = b.planned_start

        if m.tracking_type == "quantity":
            total = m.total_quantity or 0
        else:
            # individual: пока экземпляров нет — считаем 1 доступный слот
            total = max(1, len(m.items) if getattr(m, "items", None) else 1)

        available_now = max(0, total - booked_now_qty)

        out[m.id] = {
            "available_now": available_now,
            "total_quantity": total,
            # free_until: если сейчас есть занятость — когда освободится;
            # если сейчас свободно — когда начнётся следующая бронь (None = бессрочно)
            "free_until": next_release if booked_now_qty > 0 else free_until,
            # next_busy_at: ближайшее будущее начало (None, если броней нет)
            "next_busy_at": free_until,
        }
    return out


async def list_categories_with_models(
    session: AsyncSession,
) -> list[Category]:
    """Все категории вместе с моделями (eager load), по алфавиту.

    Дополнительно проставляет в каждую модель атрибуты:
      - available_now: int
      - free_until: datetime | None
      - next_busy_at: datetime | None
    (динамические атрибуты, не поля БД).
    """
    result = await session.execute(
        select(Category)
        .order_by(Category.name)
        .options(selectinload(Category.models))
    )
    categories = list(result.scalars().unique().all())

    all_models: list[EquipmentModel] = []
    for c in categories:
        all_models.extend(c.models)

    availability = await _compute_availability(session, all_models)

    for m in all_models:
        info = availability.get(m.id, {})
        # Проставляем как обычные атрибуты — Pydantic с from_attributes их подхватит.
        setattr(m, "available_now", info.get("available_now", m.total_quantity or 0))
        setattr(m, "free_until", info.get("free_until"))
        setattr(m, "next_busy_at", info.get("next_busy_at"))

    return categories
