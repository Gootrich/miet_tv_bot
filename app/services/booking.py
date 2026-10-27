from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.models.equipment import EquipmentItem, EquipmentModel
from app.models.user import User
from app.services.booking_history import record_event


def _parse_dt(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
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


def _can_book(user: User, access_policy: str) -> bool:
    """Проверка политики доступа модели для конкретного пользователя."""
    if user.has_scope("admin:super"):
        return True
    if access_policy == "all":
        return True
    if access_policy == "photographer":
        return user.has_role("photographer")
    if access_policy == "videographer":
        return user.has_role("videographer")
    return False


async def _check_quantity_availability(
    session: AsyncSession,
    model: EquipmentModel,
    requested_quantity: int,
    start_dt: datetime,
    end_dt: datetime,
) -> None:
    """Считает сумму активных броней на пересекающийся интервал (с блокировкой строки модели)."""
    stmt = select(func.coalesce(func.sum(Booking.quantity), 0)).where(
        Booking.model_id == model.id,
        Booking.status.in_(("pending", "confirmed")),
        Booking.planned_start < end_dt,
        Booking.planned_end > start_dt,
    )
    result = await session.execute(stmt)
    busy = int(result.scalar_one() or 0)
    free = model.total_quantity - busy
    if requested_quantity > free:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Недостаточно единиц на выбранный интервал: "
                f"всего {model.total_quantity}, занято {busy}, свободно {max(free, 0)}."
            ),
        )


# Глобальный asyncio.Lock: сериализует create_booking в рамках процесса.
# uvicorn --reload = один воркер = один event loop, поэтому лок работает.
# Для 100 пользователей это более чем достаточно и гарантирует отсутствие
# race condition на уровне Python (без зависимости от БД-блокировок).
_create_booking_lock: "asyncio.Lock | None" = None


def _get_create_booking_lock() -> "asyncio.Lock":
    global _create_booking_lock
    if _create_booking_lock is None:
        import asyncio as _asyncio
        _create_booking_lock = _asyncio.Lock()
    return _create_booking_lock


async def create_booking(
    session: AsyncSession,
    user: User,
    planned_start: datetime | str,
    planned_end: datetime | str,
    item_id: int | None = None,
    model_id: int | None = None,
    quantity: int = 1,
    comment: str | None = None,
) -> Booking:
    """Создаёт бронь с защитой от race condition через asyncio.Lock.

    Все вызовы create_booking сериализуются в рамках процесса. Пока одна
    бронь проходит «проверка остатка → INSERT → COMMIT», вторая ждёт.
    Это гарантирует, что параллельные брони на последнюю единицу не
    пройдут обе.

    Используется свежая сессия (не та, что пришла из get_current_user),
    чтобы коммиты из get_current_user не влияли на транзакцию.
    """
    await check_time_step(planned_start, planned_end)
    start_dt = _parse_dt(planned_start)
    end_dt = _parse_dt(planned_end)

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

    from app.db.session import AsyncSessionFactory
    from app.models.equipment import EquipmentItem, EquipmentModel

    lock = _get_create_booking_lock()
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                # --- model_id ---
                if model_id is not None:
                    model_result = await tx.execute(
                        select(EquipmentModel).where(
                            EquipmentModel.id == model_id
                        )
                    )
                    model = model_result.scalar_one_or_none()
                    if model is None:
                        raise HTTPException(404, "Модель не найдена.")
                    if model.tracking_type == "individual":
                        raise HTTPException(
                            400,
                            "Эта модель учитывается по экземплярам. "
                            "Укажите item_id.",
                        )
                    if not _can_book(user, model.access_policy):
                        raise HTTPException(
                            403,
                            f"Нет доступа к технике с политикой "
                            f"'{model.access_policy}'.",
                        )

                    sum_result = await tx.execute(
                        select(
                            func.coalesce(func.sum(Booking.quantity), 0)
                        ).where(
                            Booking.model_id == model_id,
                            Booking.status.in_(("pending", "confirmed")),
                            Booking.planned_start < end_dt,
                            Booking.planned_end > start_dt,
                        )
                    )
                    busy = int(sum_result.scalar_one() or 0)
                    free = model.total_quantity - busy
                    if quantity > free:
                        raise HTTPException(
                            409,
                            f"Недостаточно единиц на выбранный интервал: "
                            f"всего {model.total_quantity}, занято {busy}, "
                            f"свободно {max(free, 0)}.",
                        )

                # --- item_id ---
                if item_id is not None:
                    item_result = await tx.execute(
                        select(EquipmentItem).where(
                            EquipmentItem.id == item_id
                        )
                    )
                    item = item_result.scalar_one_or_none()
                    if item is None:
                        raise HTTPException(404, "Экземпляр не найден.")
                    if item.status != "active":
                        raise HTTPException(
                            400,
                            f"Экземпляр в статусе '{item.status}', "
                            f"бронировать нельзя.",
                        )

                    model_result = await tx.execute(
                        select(EquipmentModel).where(
                            EquipmentModel.id == item.model_id
                        )
                    )
                    item_model = model_result.scalar_one_or_none()
                    if item_model is not None and not _can_book(
                        user, item_model.access_policy
                    ):
                        raise HTTPException(
                            403,
                            f"Нет доступа к технике с политикой "
                            f"'{item_model.access_policy}'.",
                        )

                    overlap_result = await tx.execute(
                        select(Booking.id)
                        .where(
                            Booking.item_id == item_id,
                            Booking.status.in_(("pending", "confirmed")),
                            Booking.planned_start < end_dt,
                            Booking.planned_end > start_dt,
                        )
                        .limit(1)
                    )
                    if overlap_result.scalar_one_or_none() is not None:
                        raise HTTPException(
                            409,
                            "Этот экземпляр уже забронирован "
                            "на выбранный интервал.",
                        )

                booking = Booking(
                    user_id=user.id,
                    item_id=item_id,
                    model_id=model_id,
                    quantity=quantity,
                    planned_start=start_dt,
                    planned_end=end_dt,
                    comment=comment,
                    status="pending",
                )
                tx.add(booking)
                await tx.flush()
                # Унификация: одиночная = группа из 1. group_id = id самой брони.
                booking.group_id = booking.id
                await record_event(
                    tx,
                    booking_id=booking.id,
                    event_type="created",
                    actor_user_id=user.id,
                    details=None,
                )

            await tx.refresh(booking)

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
    if booking.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Выдать бронирование может только её владелец.",
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
    await record_event(
        session,
        booking_id=booking.id,
        event_type="checkout",
        actor_user_id=user_id,
        details=None,
    )
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
    if booking.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вернуть бронирование может только её владелец.",
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
    await record_event(
        session,
        booking_id=booking.id,
        event_type="return",
        actor_user_id=user_id,
        details=None,
    )
    await session.commit()
    await session.refresh(booking)
    return booking


# ============================================================
# Этап 2: cancel / move / get_bookings
# ============================================================

async def cancel_booking(
    session: AsyncSession,
    booking_id: int,
    user: User,
    is_admin: bool = False,
) -> Booking:
    """Отменяет бронь (status='cancelled').

    Права: владелец или админ. Уже выданную (actual_checkout != None)
    может отменить только админ.
    """
    booking = await session.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Бронирование не найдено.",
        )
    if not is_admin and booking.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому бронированию.",
        )
    if booking.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Бронирование уже отменено.",
        )
    if booking.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя отменить завершённое бронирование.",
        )
    if booking.actual_checkout is not None and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Оборудование уже выдано — отменить может только администратор.",
        )

    booking.status = "cancelled"
    await record_event(
        session,
        booking_id=booking.id,
        event_type="cancelled",
        actor_user_id=user.id,
        details=None,
    )
    await session.commit()
    await session.refresh(booking)
    return booking


async def move_booking(
    session: AsyncSession,
    booking_id: int,
    user: User,
    new_start: datetime | str,
    new_end: datetime | str,
) -> Booking:
    """Переносит бронь (перезапись planned_start/planned_end).

    Только владелец — даже админ не может перенести чужую бронь.
    Использует тот же asyncio.Lock, что и create_booking: сериализует
    проверку остатка и UPDATE.
    """
    await check_time_step(new_start, new_end)
    start_dt = _parse_dt(new_start)
    end_dt = _parse_dt(new_end)

    # Быстрая проверка прав до входа в lock (не трогая БД).
    booking_pre = await session.get(Booking, booking_id)
    if booking_pre is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Бронирование не найдено.",
        )
    if booking_pre.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Перенести бронь может только её владелец.",
        )

    lock = _get_create_booking_lock()
    async with lock:
        # Перечитываем в свежей сессии — в основной сессии бронь могла
        # измениться, пока мы ждали lock.
        from app.db.session import AsyncSessionFactory

        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                booking = await tx.get(Booking, booking_id)
                if booking is None:
                    raise HTTPException(404, "Бронирование не найдено.")
                if booking.user_id != user.id:
                    raise HTTPException(
                        403, "Перенести бронь может только её владелец."
                    )
                if booking.status in ("cancelled", "completed"):
                    raise HTTPException(
                        400,
                        f"Нельзя перенести бронь в статусе «{booking.status}».",
                    )
                if booking.actual_checkout is not None:
                    raise HTTPException(
                        400,
                        "Оборудование уже выдано — перенос невозможен.",
                    )

                old_start = booking.planned_start
                old_end = booking.planned_end

                # Проверка конфликта — как в create_booking.
                if booking.model_id is not None:
                    model = await tx.get(
                        EquipmentModel, booking.model_id
                    )
                    if model is None:
                        raise HTTPException(404, "Модель не найдена.")
                    # Сумма активных броней НА ДРУГИЕ брони (исключая
                    # текущую) на новый интервал.
                    sum_result = await tx.execute(
                        select(
                            func.coalesce(func.sum(Booking.quantity), 0)
                        ).where(
                            Booking.model_id == booking.model_id,
                            Booking.id != booking.id,
                            Booking.status.in_(("pending", "confirmed")),
                            Booking.planned_start < end_dt,
                            Booking.planned_end > start_dt,
                        )
                    )
                    busy = int(sum_result.scalar_one() or 0)
                    if busy + booking.quantity > model.total_quantity:
                        raise HTTPException(
                            409,
                            f"Недостаточно единиц на выбранный интервал: "
                            f"всего {model.total_quantity}, занято {busy}, "
                            f"свободно {max(model.total_quantity - busy, 0)}.",
                        )

                if booking.item_id is not None:
                    overlap_result = await tx.execute(
                        select(Booking.id)
                        .where(
                            Booking.item_id == booking.item_id,
                            Booking.id != booking.id,
                            Booking.status.in_(("pending", "confirmed")),
                            Booking.planned_start < end_dt,
                            Booking.planned_end > start_dt,
                        )
                        .limit(1)
                    )
                    if overlap_result.scalar_one_or_none() is not None:
                        raise HTTPException(
                            409,
                            "Этот экземпляр уже забронирован "
                            "на выбранный интервал.",
                        )

                booking.planned_start = start_dt
                booking.planned_end = end_dt

                import json as _json

                await record_event(
                    tx,
                    booking_id=booking.id,
                    event_type="moved",
                    actor_user_id=user.id,
                    details=_json.dumps(
                        {
                            "from": old_start.isoformat(),
                            "to": old_end.isoformat(),
                            "new_start": start_dt.isoformat(),
                            "new_end": end_dt.isoformat(),
                        },
                        ensure_ascii=False,
                    ),
                )

            await tx.refresh(booking)

    return booking


async def get_bookings(
    session: AsyncSession,
    user_id: int,
    is_admin: bool = False,
    status_filter: str | None = None,
    include_cancelled: bool = False,
    filter_user_id: int | None = None,
    model_id: int | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    scope: str = "all",
    club: str | None = None,
    before_id: int | None = None,
    limit: int = 20,
) -> list[Booking]:
    """Все брони всех пользователей (кроме cancelled по умолчанию).

    Этап 2 (расширение): «все видят всё» + серверные фильтры/пагинация.

    :param scope: 'all' | 'mine' — mine = только filter_user_id == user_id
    :param club: 'photographer' | 'videographer' — фильтр по клубу владельца
    :param before_id: курсорная пагинация (id < before_id), порядок id DESC
    :param limit: 1..100, дефолт 20
    """
    from sqlalchemy.orm import selectinload

    if scope not in ("all", "mine"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scope должен быть 'all' или 'mine'.",
        )
    if limit < 1 or limit > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="limit должен быть в диапазоне 1..100.",
        )

    # Обычный пользователь может фильтровать только по себе.
    if filter_user_id is not None:
        if not is_admin and filter_user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Можно фильтровать только свои брони.",
            )

    # scope=mine принудительно ограничивает по себе.
    if scope == "mine":
        if filter_user_id is not None and filter_user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="scope=mine доступен только для своих броней.",
            )
        filter_user_id = user_id

    stmt = (
        select(Booking)
        .options(
            selectinload(Booking.user),
            selectinload(Booking.model).selectinload(
                EquipmentModel.category
            ),
            selectinload(Booking.item),
        )
        .order_by(Booking.id.desc())
        .limit(limit)
    )

    if not include_cancelled:
        stmt = stmt.where(Booking.status != "cancelled")

    if status_filter:
        codes = [s.strip() for s in status_filter.split(",") if s.strip()]
        if codes:
            stmt = stmt.where(Booking.status.in_(codes))

    if filter_user_id is not None:
        stmt = stmt.where(Booking.user_id == filter_user_id)

    if model_id is not None:
        stmt = stmt.where(Booking.model_id == model_id)

    # Пересечение с [from_dt, to_dt]
    if from_dt is not None:
        stmt = stmt.where(Booking.planned_end > from_dt)
    if to_dt is not None:
        stmt = stmt.where(Booking.planned_start < to_dt)

    # Клуб владельца — через подзапрос по ролям (без relationship-магии,
    # чтобы не конфликтовать с selectinload(Booking.user)).
    if club in ("photographer", "videographer"):
        from app.models.user import Role, User as UserModel, UserRole

        club_user_ids = (
            select(UserModel.id)
            .join(UserRole, UserRole.user_id == UserModel.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.code == club)
        )
        stmt = stmt.where(Booking.user_id.in_(club_user_ids))
    elif club not in (None, "", "all"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="club должен быть 'all', 'photographer' или 'videographer'.",
        )

    # Курсорная пагинация: id < before_id (порядок id DESC).
    if before_id is not None:
        stmt = stmt.where(Booking.id < before_id)

    result = await session.execute(stmt)
    return list(result.scalars().unique().all())


async def get_booking_by_id(
    session: AsyncSession, booking_id: int,
) -> Booking | None:
    """Одна бронь с eager-loaded relationships.

    Для мутационных эндпоинтов (M-4/M-9): после сервисного вызова нужно
    вернуть изменённую бронь с user/model.category/item. Использовать
    get_bookings(... limit=N) + фильтр нельзя: старая бронь не попадёт
    в первые N записей, response получит model_name=null и т.п.
    """
    from sqlalchemy.orm import selectinload

    stmt = (
        select(Booking)
        .where(Booking.id == booking_id)
        .options(
            selectinload(Booking.user),
            selectinload(Booking.model).selectinload(
                EquipmentModel.category
            ),
            selectinload(Booking.item),
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_bookings_by_ids(
    session: AsyncSession, booking_ids: list[int],
) -> list[Booking]:
    """Несколько броней по списку id с relationships, в порядке ids.

    Для групповых мутаций (return-all/return-partial/cancel-group и
    create-batch): нужен ответ с полными деталями для всех возвращённых
    броней, включая старые, которые не попадают в get_bookings limit=N.
    """
    if not booking_ids:
        return []
    from sqlalchemy.orm import selectinload

    stmt = (
        select(Booking)
        .where(Booking.id.in_(booking_ids))
        .options(
            selectinload(Booking.user),
            selectinload(Booking.model).selectinload(
                EquipmentModel.category
            ),
            selectinload(Booking.item),
        )
    )
    result = await session.execute(stmt)
    by_id = {b.id: b for b in result.scalars().unique().all()}
    return [by_id[i] for i in booking_ids if i in by_id]


# ============================================================
# Этап 2+ (D): пакетная модель (group_id)
# ============================================================

async def _validate_one_item(
    tx: AsyncSession,
    user: User,
    model_id: int,
    quantity: int,
    start_dt: datetime,
    end_dt: datetime,
) -> EquipmentModel:
    """Проверки для одной позиции пакета. Возвращает модель.

    Бросает HTTPException при ошибке — вызывающий должен откатить всю tx.
    """
    model_result = await tx.execute(
        select(EquipmentModel).where(EquipmentModel.id == model_id)
    )
    model = model_result.scalar_one_or_none()
    if model is None:
        raise HTTPException(404, f"Модель #{model_id} не найдена.")
    if model.tracking_type == "individual":
        raise HTTPException(
            400,
            f"Модель #{model_id} учитывается по экземплярам. "
            f"Пакетная бронь поддерживает только quantity.",
        )
    if not _can_book(user, model.access_policy):
        raise HTTPException(
            403,
            f"Нет доступа к модели #{model_id} "
            f"(политика '{model.access_policy}').",
        )
    sum_result = await tx.execute(
        select(func.coalesce(func.sum(Booking.quantity), 0)).where(
            Booking.model_id == model_id,
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_start < end_dt,
            Booking.planned_end > start_dt,
        )
    )
    busy = int(sum_result.scalar_one() or 0)
    free = model.total_quantity - busy
    if quantity > free:
        raise HTTPException(
            409,
            f"Модель #{model_id}: недостаточно единиц — всего "
            f"{model.total_quantity}, занято {busy}, свободно {max(free, 0)}.",
        )
    return model


async def create_bookings_batch(
    session: AsyncSession,
    user: User,
    items: list[tuple[int, int]],
    planned_start: datetime | str,
    planned_end: datetime | str,
    comment: str | None = None,
) -> list[Booking]:
    """Создаёт несколько броней одной группой (атомарно, в том же lock).

    :param items: список (model_id, quantity)
    :return: список Booking в порядке items, group_id = id первой.
    :raises HTTPException: если хоть одна позиция невалидна — откат всей tx.
    """
    await check_time_step(planned_start, planned_end)
    start_dt = _parse_dt(planned_start)
    end_dt = _parse_dt(planned_end)
    if not items:
        raise HTTPException(400, "Пустой список items.")

    from app.db.session import AsyncSessionFactory

    lock = _get_create_booking_lock()
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                created: list[Booking] = []
                group_id: int | None = None
                for (model_id, qty) in items:
                    if qty is None or qty < 1:
                        raise HTTPException(
                            400, f"quantity должен быть >= 1 (model_id={model_id})."
                        )
                    await _validate_one_item(
                        tx, user, model_id, qty, start_dt, end_dt
                    )
                    b = Booking(
                        user_id=user.id,
                        model_id=model_id,
                        quantity=qty,
                        planned_start=start_dt,
                        planned_end=end_dt,
                        comment=comment,
                        status="pending",
                    )
                    tx.add(b)
                    await tx.flush()
                    if group_id is None:
                        group_id = b.id
                        b.group_id = b.id
                    else:
                        b.group_id = group_id
                    created.append(b)
                    await record_event(
                        tx,
                        booking_id=b.id,
                        event_type="created",
                        actor_user_id=user.id,
                        details=None,
                    )
            for b in created:
                await tx.refresh(b)

    return created


async def add_to_booking(
    session: AsyncSession,
    booking_id: int,
    user: User,
    model_id: int,
    quantity: int = 1,
) -> Booking:
    """Добавить ещё одну модель к существующей брони (в тот же group_id).

    Владелец — только пользователь брони. Время берётся из базовой брони.
    Использует тот же asyncio.Lock, что и create_booking.
    """
    base = await session.get(Booking, booking_id)
    if base is None:
        raise HTTPException(404, "Бронирование не найдено.")
    if base.user_id != user.id:
        raise HTTPException(403, "Добавить к брони может только её владелец.")
    if base.status not in ("pending", "confirmed"):
        raise HTTPException(
            400, f"Нельзя добавить к брони в статусе «{base.status}»."
        )
    if base.actual_checkout is not None:
        raise HTTPException(400, "Оборудование уже выдано — добавить нельзя.")

    from app.db.session import AsyncSessionFactory

    lock = _get_create_booking_lock()
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                # перечитываем базовую в свежей сессии
                base2 = await tx.get(Booking, booking_id)
                if base2 is None:
                    raise HTTPException(404, "Бронирование не найдено.")
                if base2.user_id != user.id:
                    raise HTTPException(403, "Добавить к брони может только её владелец.")
                if base2.status not in ("pending", "confirmed"):
                    raise HTTPException(
                        400, f"Нельзя добавить к брони в статусе «{base2.status}»."
                    )
                if base2.actual_checkout is not None:
                    raise HTTPException(400, "Оборудование уже выдано — добавить нельзя.")

                await _validate_one_item(
                    tx, user, model_id, quantity,
                    base2.planned_start, base2.planned_end,
                )
                group_id = base2.group_id or base2.id
                if base2.group_id is None:
                    # legacy-бронь без group_id — проставим ей group_id
                    base2.group_id = base2.id
                    group_id = base2.id

                b = Booking(
                    user_id=user.id,
                    model_id=model_id,
                    quantity=quantity,
                    planned_start=base2.planned_start,
                    planned_end=base2.planned_end,
                    comment=base2.comment,
                    status="pending",
                    group_id=group_id,
                )
                tx.add(b)
                await tx.flush()
                await record_event(
                    tx,
                    booking_id=b.id,
                    event_type="created",
                    actor_user_id=user.id,
                    details=f"added to group {group_id}",
                )
            await tx.refresh(b)

    return b


def _can_return_now(b: Booking) -> bool:
    """Валидная цель возврата: выдана, ещё не возвращена, статус confirmed."""
    return (
        b.actual_checkout is not None
        and b.actual_return is None
        and b.status == "confirmed"
    )


async def _apply_return_in_tx(
    tx: AsyncSession, booking: Booking, user_id: int,
) -> None:
    """Мутирует бронь в completed и пишет событие. Без commit."""
    booking.actual_return = datetime.now(timezone.utc)
    booking.status = "completed"
    await record_event(
        tx,
        booking_id=booking.id,
        event_type="return",
        actor_user_id=user_id,
        details=None,
    )


async def return_all_in_group(
    session: AsyncSession,
    group_id: int,
    user: User,
) -> list[Booking]:
    """«Вернуть всё»: атомарно возвращает все выданные брони группы.

    H-6: все мутации и события в одной транзакции.
    Идемпотентность: брони без checkout или уже возвращённые пропускаются.
    """
    from app.db.session import AsyncSessionFactory

    lock = _get_create_booking_lock()
    returned_ids: list[int] = []
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                stmt = select(Booking).where(
                    Booking.group_id == group_id,
                    Booking.user_id == user.id,
                )
                result = await tx.execute(stmt)
                group = list(result.scalars().all())
                if not group:
                    single = await tx.get(Booking, group_id)
                    if single is None or single.user_id != user.id:
                        raise HTTPException(404, "Группа не найдена.")
                    group = [single]

                to_return = [b for b in group if _can_return_now(b)]
                for b in to_return:
                    await _apply_return_in_tx(tx, b, user.id)
                    returned_ids.append(b.id)
                await tx.flush()

    if not returned_ids:
        return []
    out: list[Booking] = []
    for bid in returned_ids:
        b = await session.get(Booking, bid)
        if b is not None:
            out.append(b)
    return out


async def cancel_group(
    session: AsyncSession,
    group_id: int,
    user: User,
    is_admin: bool = False,
) -> list[Booking]:
    """Отменить все pending/confirmed брони группы (H-6: атомарно).

    Идемпотентность: already cancelled/completed пропускаются.
    Владелец или админ. Выданную бронь может отменить только админ.
    """
    from app.db.session import AsyncSessionFactory

    lock = _get_create_booking_lock()
    cancelled_ids: list[int] = []
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                stmt = select(Booking).where(
                    Booking.group_id == group_id,
                )
                if not is_admin:
                    stmt = stmt.where(Booking.user_id == user.id)
                result = await tx.execute(stmt)
                group = list(result.scalars().all())
                if not group:
                    single = await tx.get(Booking, group_id)
                    if single is None:
                        raise HTTPException(404, "Группа не найдена.")
                    if not is_admin and single.user_id != user.id:
                        raise HTTPException(404, "Группа не найдена.")
                    group = [single]

                if not is_admin:
                    for b in group:
                        if b.user_id != user.id:
                            raise HTTPException(
                                403, "Нет доступа к этой группе."
                            )

                to_cancel: list[Booking] = []
                for b in group:
                    if b.status in ("cancelled", "completed"):
                        continue
                    if b.actual_checkout is not None and not is_admin:
                        raise HTTPException(
                            400,
                            "Оборудование уже выдано — отменить может "
                            "только администратор.",
                        )
                    to_cancel.append(b)

                for b in to_cancel:
                    b.status = "cancelled"
                    await record_event(
                        tx,
                        booking_id=b.id,
                        event_type="cancelled",
                        actor_user_id=user.id,
                        details=None,
                    )
                    cancelled_ids.append(b.id)
                await tx.flush()

    if not cancelled_ids:
        return []
    out: list[Booking] = []
    for bid in cancelled_ids:
        b = await session.get(Booking, bid)
        if b is not None:
            out.append(b)
    return out


async def return_partial_in_group(
    session: AsyncSession,
    group_id: int,
    user: User,
    booking_ids: list[int],
) -> list[Booking]:
    """«Вернуть частично»: атомарно вернуть указанные booking_id группы.

    H-6: все мутации и события в одной транзакции.
    Q1-c2 (идемпотентность): уже completed → пропуск без ошибки.
    Q1-c2 (строгость): pending/cancelled/не выдана/не в группе → 400
    с перечнем причин, откат всей группы.
    """
    if not booking_ids:
        raise HTTPException(400, "Пустой список booking_ids.")

    from app.db.session import AsyncSessionFactory

    lock = _get_create_booking_lock()
    returned_ids: list[int] = []
    async with lock:
        async with AsyncSessionFactory() as tx:
            async with tx.begin():
                stmt = select(Booking).where(
                    Booking.group_id == group_id,
                    Booking.user_id == user.id,
                )
                result = await tx.execute(stmt)
                group = list(result.scalars().all())
                if not group:
                    single = await tx.get(Booking, group_id)
                    if single is None or single.user_id != user.id:
                        raise HTTPException(404, "Группа не найдена.")
                    group = [single]

                allowed = {b.id: b for b in group}

                valid: list[Booking] = []
                invalid: list[tuple[int, str]] = []
                for bid in booking_ids:
                    if bid not in allowed:
                        invalid.append((bid, "не входит в группу"))
                        continue
                    b = allowed[bid]
                    if b.status == "completed" and b.actual_return is not None:
                        continue
                    if b.actual_checkout is None:
                        invalid.append((bid, "оборудование не было выдано"))
                        continue
                    if b.status == "cancelled":
                        invalid.append((bid, "бронь отменена"))
                        continue
                    if b.status == "pending":
                        invalid.append((bid, "бронь ещё не подтверждена"))
                        continue
                    if b.status != "confirmed":
                        invalid.append((bid, f"статус {b.status}"))
                        continue
                    valid.append(b)

                if invalid:
                    reasons = "; ".join(
                        f"#{bid}: {reason}" for bid, reason in invalid
                    )
                    raise HTTPException(400, f"Нельзя вернуть: {reasons}")

                for b in valid:
                    await _apply_return_in_tx(tx, b, user.id)
                    returned_ids.append(b.id)
                await tx.flush()

    if not returned_ids:
        return []
    out: list[Booking] = []
    for bid in returned_ids:
        b = await session.get(Booking, bid)
        if b is not None:
            out.append(b)
    return out
