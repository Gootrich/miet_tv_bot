from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Category, EquipmentItem, EquipmentModel


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
