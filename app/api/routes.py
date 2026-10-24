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
