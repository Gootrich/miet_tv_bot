"""Запись событий истории бронирований.

Все события пишутся в таблицу ``booking_history``. Хелпер не коммитит
транзакцию — это делает вызывающий код (в тех же транзакциях, что и
изменение самой брони, чтобы не оставлять «висячих» событий).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking_history import BookingHistory


async def record_event(
    session: AsyncSession,
    booking_id: int,
    event_type: str,
    actor_user_id: int | None = None,
    details: str | None = None,
) -> BookingHistory:
    """Добавляет событие в историю бронирования (без commit).

    :param session: активная сессия (в той же транзакции, что изменение брони)
    :param booking_id: id брони
    :param event_type: created | checkout | return | cancelled | moved
    :param actor_user_id: кто выполнил действие
    :param details: произвольный текст (например, JSON для moved)
    """
    entry = BookingHistory(
        booking_id=booking_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        details=details,
    )
    session.add(entry)
    await session.flush()
    return entry


async def list_history(
    session: AsyncSession,
    booking_id: int,
) -> list[BookingHistory]:
    """Возвращает историю брони в порядке возрастания времени."""
    stmt = (
        select(BookingHistory)
        .where(BookingHistory.booking_id == booking_id)
        .order_by(BookingHistory.created_at.asc(), BookingHistory.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_all_history(
    session: AsyncSession,
    event_type: str | None = None,
    scope: str = "all",
    club: str | None = None,
    user_id: int | None = None,
    before_id: int | None = None,
    limit: int = 20,
) -> list[BookingHistory]:
    """Возвращает последние события по всем броням (таб «История»).

    :param event_type: csv (`created,checkout`) или один код
    :param scope: 'all' | 'mine' — mine = события по моим броням
    :param club: 'photographer' | 'videographer' — фильтр по клубу владельца
    :param user_id: id текущего пользователя (нужен для scope=mine)
    :param before_id: курсорная пагинация (id < before_id), порядок id DESC
    :param limit: 1..100, дефолт 20
    """
    if scope not in ("all", "mine"):
        raise ValueError("scope должен быть 'all' или 'mine'")
    if limit < 1 or limit > 100:
        raise ValueError("limit должен быть в диапазоне 1..100")

    from app.models.booking import Booking
    from app.models.user import Role, User, UserRole

    stmt = (
        select(BookingHistory)
        .order_by(
            BookingHistory.created_at.desc(),
            BookingHistory.id.desc(),
        )
        .limit(limit)
    )

    if event_type:
        codes = [s.strip() for s in event_type.split(",") if s.strip()]
        if codes:
            stmt = stmt.where(BookingHistory.event_type.in_(codes))

    # Подзапрос: id броней, принадлежащих пользователю / клубу.
    booking_ids_subq = None

    if scope == "mine":
        if user_id is None:
            raise ValueError("scope=mine требует user_id")
        booking_ids_subq = select(Booking.id).where(
            Booking.user_id == user_id
        )

    if club in ("photographer", "videographer"):
        club_user_ids = (
            select(User.id)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.code == club)
        )
        club_booking_ids = select(Booking.id).where(
            Booking.user_id.in_(club_user_ids)
        )
        if booking_ids_subq is None:
            booking_ids_subq = club_booking_ids
        else:
            booking_ids_subq = booking_ids_subq.where(
                Booking.id.in_(club_booking_ids)
            )
    elif club not in (None, "", "all"):
        raise ValueError("club должен быть 'all', 'photographer' или 'videographer'")

    if booking_ids_subq is not None:
        stmt = stmt.where(BookingHistory.booking_id.in_(booking_ids_subq))

    if before_id is not None:
        stmt = stmt.where(BookingHistory.id < before_id)

    result = await session.execute(stmt)
    return list(result.scalars().unique().all())
