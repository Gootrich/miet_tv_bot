"""HTTP-маршруты API каталога оборудования.

Реализованы только операции чтения. Бизнес-логика переиспользуется
из app.services.catalog, подключение к БД — из app.db.session.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    CategoryWithModelsOut,
    EquipmentModelDetailOut,
    HealthOut,
)
from app.db.session import check_database_connection, get_session
from app.services import catalog as catalog_service

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    """Проверяет, что API живо и соединение с БД работает."""
    try:
        db_ok = await check_database_connection()
    except Exception:  # noqa: BLE001 — health не должен падать исключением
        db_ok = False
    if not db_ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database unavailable",
        )
    return HealthOut(status="ok", database="ok")


@router.get(
    "/catalog",
    response_model=list[CategoryWithModelsOut],
)
async def get_catalog(
    session: AsyncSession = Depends(get_session),
):
    """Возвращает категории с их моделями (без экземпляров)."""
    return await catalog_service.list_categories_with_models(session)


@router.get(
    "/catalog/models/{model_id}",
    response_model=EquipmentModelDetailOut,
)
async def get_model(
    model_id: int,
    session: AsyncSession = Depends(get_session),
):
    """Возвращает модель вместе с физическими экземплярами."""
    model = await catalog_service.get_model_with_items(session, model_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="model not found",
        )
    return model

from app.api.deps import get_current_user
from app.api.schemas import BookingOut, BookingRequest
from app.models.user import User
from app.services import booking as booking_service


@router.post("/bookings", response_model=BookingOut)
async def create_booking_endpoint(
    payload: BookingRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Создает новое бронирование оборудования."""
    return await booking_service.create_booking(
        session=session,
        user_id=current_user.id,
        planned_start=payload.planned_start,
        planned_end=payload.planned_end,
        item_id=payload.item_id,
        model_id=payload.model_id,
        quantity=payload.quantity,
        comment=payload.comment,
    )


@router.get("/bookings", response_model=list[BookingOut])
async def get_bookings_endpoint(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Возвращает список бронирований текущего пользователя (или всех для администратора)."""
    is_admin = any(r.role.code == "admin" for r in current_user.roles) if hasattr(current_user, "roles") else False
    return await booking_service.get_user_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=is_admin,
    )


@router.post("/bookings/{booking_id}/checkout", response_model=BookingOut)
async def checkout_booking_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Подтверждает получение оборудования."""
    is_admin = any(r.role.code == "admin" for r in current_user.roles) if hasattr(current_user, "roles") else False
    return await booking_service.checkout_booking(
        session=session,
        booking_id=booking_id,
        user_id=current_user.id,
        is_admin=is_admin,
    )


@router.post("/bookings/{booking_id}/return", response_model=BookingOut)
async def return_booking_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Подтверждает возврат оборудования."""
    is_admin = any(r.role.code == "admin" for r in current_user.roles) if hasattr(current_user, "roles") else False
    return await booking_service.return_booking(
        session=session,
        booking_id=booking_id,
        user_id=current_user.id,
        is_admin=is_admin,
    )
