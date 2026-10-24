from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from fastapi import HTTPException, status

from app.models.booking import Booking
from app.models.equipment import EquipmentItem, EquipmentModel

async def check_time_step(start: datetime | str, end: datetime | str):
    if isinstance(start, str):
        start = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if isinstance(end, str):
        end = datetime.fromisoformat(end.replace("Z", "+00:00"))
    
    for dt in (start, end):
        if dt.minute % 15 != 0 or dt.second != 0 or dt.microsecond != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Время должно быть кратно 15 минутам.",
            )
    if start >= end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Время начала должно быть раньше времени окончания.",
        )

async def create_booking(
    session: AsyncSession,
    user_id: int,
    data,
):
    await check_time_step(data.planned_start, data.planned_end)
    
    # Преобразуем строки в datetime для БД если нужно
    start_dt = data.planned_start
    if isinstance(start_dt, str):
        start_dt = datetime.fromisoformat(start_dt.replace("Z", "+00:00"))
        
    end_dt = data.planned_end
    if isinstance(end_dt, str):
        end_dt = datetime.fromisoformat(end_dt.replace("Z", "+00:00"))

    # Создаем бронирование
    booking = Booking(
        user_id=user_id,
        model_id=data.model_id,
        item_id=data.item_id,
        quantity=data.quantity or 1,
        planned_start=start_dt,
        planned_end=end_dt,
        comment=data.comment,
        status="booked",
    )
    session.add(booking)
    await session.commit()
    await session.refresh(booking)
    return booking
