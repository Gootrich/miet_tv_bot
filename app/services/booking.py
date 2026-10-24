from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking


def _parse_dt(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def check_time_step(start: datetime | str, end: datetime | str) -> None:
    start_dt = _parse_dt(start)
    end_dt = _parse_dt(end)

    for dt in (start_dt, end_dt):
        if dt.minute % 15 != 0 or dt.second != 0 or dt.microsecond != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Время должно быть кратно 15 минутам.",
            )
    if start_dt >= end_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Время начала должно быть раньше времени окончания.",
        )


async def create_booking(
    session: AsyncSession,
    user_id: int,
    planned_start: datetime | str,
    planned_end: datetime | str,
    item_id: int | None = None,
    model_id: int | None = None,
    quantity: int = 1,
    comment: str | None = None,
) -> Booking:
    """Создаёт бронирование физического экземпляра или количественного ресурса."""
    await check_time_step(planned_start, planned_end)

    start_dt = _parse_dt(planned_start)
    end_dt = _parse_dt(planned_end)

    # Согласовано с constraint valid_booking_target_type в модели Booking
    if item_id is not None and model_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите либо item_id, либо model_id, но не оба.",
        )
    if item_id is None and model_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нужно указать item_id (экземпляр) или model_id (количество).",
        )
    if item_id is not None:
        quantity = 1
    if quantity is None or quantity < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quantity должно быть >= 1.",
        )

    booking = Booking(
        user_id=user_id,
        item_id=item_id,
        model_id=model_id,
        quantity=quantity,
        planned_start=start_dt,
        planned_end=end_dt,
        comment=comment,
        status="pending",  # допустимо: pending | confirmed | cancelled | completed
    )
    session.add(booking)
    await session.commit()
    await session.refresh(booking)
    return booking


async def get_user_bookings(
    session: AsyncSession,
    user_id: int,
    is_admin: bool = False,
) -> list[Booking]:
    """Список бронирований текущего пользователя (или всех — для admin)."""
    stmt = select(Booking).order_by(Booking.planned_start.desc())
    if not is_admin:
        stmt = stmt.where(Booking.user_id == user_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def checkout_booking(
    session: AsyncSession,
    booking_id: int,
    user_id: int,
    is_admin: bool = False,
) -> Booking:
    """Подтверждает получение оборудования (actual_checkout)."""
    booking = await session.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Бронирование не найдено.",
        )
    if not is_admin and booking.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому бронированию.",
        )
    if booking.status in ("cancelled", "completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нельзя выдать бронирование со статусом «{booking.status}».",
        )
    if booking.actual_checkout is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Оборудование уже выдано.",
        )

    booking.actual_checkout = datetime.now(timezone.utc)
    if booking.status == "pending":
        booking.status = "confirmed"
    await session.commit()
    await session.refresh(booking)
    return booking


async def return_booking(
    session: AsyncSession,
    booking_id: int,
    user_id: int,
    is_admin: bool = False,
) -> Booking:
    """Подтверждает возврат оборудования (actual_return → completed)."""
    booking = await session.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Бронирование не найдено.",
        )
    if not is_admin and booking.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому бронированию.",
        )
    if booking.actual_checkout is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сначала нужно подтвердить получение (checkout).",
        )
    if booking.actual_return is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Оборудование уже возвращено.",
        )
    if booking.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя вернуть отменённое бронирование.",
        )

    booking.actual_return = datetime.now(timezone.utc)
    booking.status = "completed"
    await session.commit()
    await session.refresh(booking)
    return booking
