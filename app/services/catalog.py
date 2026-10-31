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
            selectinload(EquipmentModel.aliases),
            selectinload(EquipmentModel.category),
        )
    )
    return result.scalar_one_or_none()


def _model_capacity(m: EquipmentModel) -> tuple[int, int]:
    """(всего_учтённых, бронируемых) для модели.

    quantity — total_quantity и он же.
    individual — retired исключены из total; active только в bookable.
    """
    if m.tracking_type == "quantity":
        total = m.total_quantity or 0
        return total, total
    items = getattr(m, "items", None) or []
    if not items:
        return 1, 1
    total = sum(1 for i in items if i.status != "retired")
    bookable = sum(1 for i in items if i.status == "active")
    return total, bookable



def _peak_booked(bookings, start_dt, end_dt) -> int:
    """Максимальная одновременная занятость на [start_dt, end_dt)."""
    relevant = [
        b for b in bookings
        if b.planned_start < end_dt and b.planned_end > start_dt
    ]
    if not relevant:
        return 0
    points = {start_dt}
    for b in relevant:
        if start_dt < b.planned_start < end_dt:
            points.add(b.planned_start)
    peak = 0
    for p in points:
        s = sum((b.quantity or 1) for b in relevant
                if b.planned_start <= p < b.planned_end)
        if s > peak:
            peak = s
    return peak

async def _compute_availability(
    session: AsyncSession,
    models: list[EquipmentModel],
    now: datetime | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> dict[int, dict]:
    """Для списка моделей считает available_now / free_until / next_busy_at
    (на «сейчас») и — если задан период — available_in_period на
    [from_dt, to_dt). Ничего не пишет в БД.
    """
    if not models:
        return {}
    now = now or datetime.now(timezone.utc)
    model_ids = [m.id for m in models]

    result = await session.execute(
        select(Booking).where(
            Booking.model_id.in_(model_ids),
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_end > now,
        )
    )
    bookings_now = list(result.scalars().all())

    bookings_period: list[Booking] | None = None
    if from_dt is not None and to_dt is not None:
        result = await session.execute(
            select(Booking).where(
                Booking.model_id.in_(model_ids),
                Booking.status.in_(("pending", "confirmed")),
                Booking.planned_start < to_dt,
                Booking.planned_end > from_dt,
            )
        )
        bookings_period = list(result.scalars().all())

    per_model_now: dict[int, list[Booking]] = {mid: [] for mid in model_ids}
    for b in bookings_now:
        per_model_now.setdefault(b.model_id, []).append(b)

    per_model_period: dict[int, list[Booking]] = {mid: [] for mid in model_ids}
    if bookings_period is not None:
        for b in bookings_period:
            per_model_period.setdefault(b.model_id, []).append(b)

    out: dict[int, dict] = {}
    for m in models:
        total, bookable_capacity = _model_capacity(m)

        mine_now = per_model_now.get(m.id, [])
        booked_now_qty = 0
        free_until: datetime | None = None
        next_release: datetime | None = None
        for b in mine_now:
            if b.planned_start <= now < b.planned_end:
                booked_now_qty += (b.quantity or 1)
                if next_release is None or b.planned_end < next_release:
                    next_release = b.planned_end
            elif b.planned_start > now:
                if free_until is None or b.planned_start < free_until:
                    free_until = b.planned_start

        info = {
            "available_now": max(0, bookable_capacity - booked_now_qty),
            "total_quantity": total,
            "free_until": next_release if booked_now_qty > 0 else free_until,
            "next_busy_at": free_until,
            "available_in_period": None,
        }

        if from_dt is not None and to_dt is not None:
            period_bookings = per_model_period.get(m.id, [])
            peak = _peak_booked(period_bookings, from_dt, to_dt)
            info["available_in_period"] = max(0, bookable_capacity - peak)

        out[m.id] = info
    return out


async def list_categories_with_models(
    session: AsyncSession,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[Category]:
    """Все категории вместе с моделями (eager load), по алфавиту.

    Проставляет в каждую модель атрибуты available_now / free_until /
    next_busy_at и, если задан период, available_in_period.
    """
    result = await session.execute(
        select(Category)
        .order_by(Category.name)
        .options(
            selectinload(Category.models).selectinload(EquipmentModel.items),
            selectinload(Category.models).selectinload(EquipmentModel.aliases),
        )
    )
    categories = list(result.scalars().unique().all())

    all_models: list[EquipmentModel] = []
    for c in categories:
        all_models.extend(c.models)

    availability = await _compute_availability(
        session, all_models, from_dt=from_dt, to_dt=to_dt,
    )

    for m in all_models:
        info = availability.get(m.id, {})
        setattr(m, "available_now", info.get("available_now", m.total_quantity or 0))
        setattr(m, "free_until", info.get("free_until"))
        setattr(m, "next_busy_at", info.get("next_busy_at"))
        setattr(m, "available_in_period", info.get("available_in_period"))

    return categories

async def get_model_by_id(
    session: AsyncSession, model_id: int
) -> EquipmentModel | None:
    """Модель с предзагруженными items и category."""
    result = await session.execute(
        select(EquipmentModel)
        .where(EquipmentModel.id == model_id)
        .options(
            selectinload(EquipmentModel.items),
            selectinload(EquipmentModel.aliases),
            selectinload(EquipmentModel.category),
        )
    )
    return result.scalar_one_or_none()


async def check_availability(
    session: AsyncSession,
    model: EquipmentModel,
    quantity: int,
    from_dt: datetime,
    to_dt: datetime,
) -> tuple[int, int]:
    """(available_in_period, peak_booked) для [from_dt, to_dt)."""
    bookable = _model_capacity(model)[1]
    result = await session.execute(
        select(Booking).where(
            Booking.model_id == model.id,
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_start < to_dt,
            Booking.planned_end > from_dt,
        )
    )
    bookings = list(result.scalars().all())
    peak = _peak_booked(bookings, from_dt, to_dt)
    return max(0, bookable - peak), peak


async def find_next_available(
    session: AsyncSession,
    model: EquipmentModel,
    start_dt: datetime,
    end_dt: datetime,
    quantity: int,
) -> tuple[datetime, datetime] | None:
    """Ближайший интервал [s, s+duration) с s >= start_dt,
    на котором доступно >= quantity единиц."""
    duration = end_dt - start_dt
    if duration.total_seconds() <= 0:
        return None
    bookable = _model_capacity(model)[1]
    if quantity > bookable:
        return None
    result = await session.execute(
        select(Booking).where(
            Booking.model_id == model.id,
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_end > start_dt,
        ).order_by(Booking.planned_start)
    )
    bookings = list(result.scalars().all())
    candidates: set[datetime] = {start_dt}
    for b in bookings:
        if b.planned_start > start_dt:
            candidates.add(b.planned_start)
        if b.planned_end > start_dt:
            candidates.add(b.planned_end)
    for c in sorted(candidates):
        if c < start_dt:
            continue
        ce = c + duration
        peak = _peak_booked(bookings, c, ce)
        if bookable - peak >= quantity:
            return c, ce
    return None

def serialize_aliases(model: EquipmentModel) -> list[str]:
    """Отсортированный список display-значений aliases модели."""
    aliases = getattr(model, "aliases", None) or []
    return sorted((a.value for a in aliases), key=lambda s: s.lower())

