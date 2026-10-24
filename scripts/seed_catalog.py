"""Идемпотентный seed каталога оборудования.

Запуск:
    python -m scripts.seed_catalog

Повторный запуск безопасен: дубликаты не создаются (проверка по name
для категорий, по (category, name) для моделей, по inventory_number
для экземпляров).
"""

import asyncio
import logging

from sqlalchemy import select

from app.db.session import AsyncSessionFactory, close_database_connection
from app.models import Category, EquipmentItem, EquipmentModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Минимальный тестовый набор. Завтра дополним реальным списком со студии.
SEED = [
    {
        "category": "Камеры",
        "models": [
            {
                "name": "Sony A7 III",
                "manufacturer": "Sony",
                "description": "Полнокадровая беззеркальная камера, 24 Мп.",
                "access_policy": "all",
                "items": [
                    {"inventory_number": "CAM-001", "serial_number": "SN-A7III-001"},
                    {"inventory_number": "CAM-002", "serial_number": None},
                ],
            },
            {
                "name": "Canon EOS R6",
                "manufacturer": "Canon",
                "description": "Полнокадровая беззеркальная камера, 20 Мп.",
                "access_policy": "all",
                "items": [
                    {"inventory_number": "CAM-010", "serial_number": "SN-R6-010"},
                ],
            },
        ],
    },
    {
        "category": "Свет",
        "models": [
            {
                "name": "Godox SL-60W",
                "manufacturer": "Godox",
                "description": "LED-моноблок 60 Вт, регулировка 5600K.",
                "access_policy": "all",
                "items": [
                    {"inventory_number": "LGT-001", "serial_number": None},
                    {"inventory_number": "LGT-002", "serial_number": None},
                ],
            },
        ],
    },
]


async def seed() -> None:
    async with AsyncSessionFactory() as session:
        async with session.begin():
            for cat_data in SEED:
                cat = (
                    await session.execute(
                        select(Category).where(Category.name == cat_data["category"])
                    )
                ).scalar_one_or_none()

                if cat is None:
                    cat = Category(name=cat_data["category"])
                    session.add(cat)
                    await session.flush()
                    logger.info("Создана категория: %s (id=%s)", cat.name, cat.id)

                for model_data in cat_data["models"]:
                    model = (
                        await session.execute(
                            select(EquipmentModel).where(
                                EquipmentModel.category_id == cat.id,
                                EquipmentModel.name == model_data["name"],
                            )
                        )
                    ).scalar_one_or_none()

                    if model is None:
                        model = EquipmentModel(
                            category_id=cat.id,
                            name=model_data["name"],
                            manufacturer=model_data.get("manufacturer"),
                            description=model_data.get("description"),
                            access_policy=model_data.get("access_policy", "all"),
                        )
                        session.add(model)
                        await session.flush()
                        logger.info(
                            "Создана модель: %s (id=%s)", model.name, model.id
                        )

                    for item_data in model_data["items"]:
                        item = (
                            await session.execute(
                                select(EquipmentItem).where(
                                    EquipmentItem.inventory_number
                                    == item_data["inventory_number"]
                                )
                            )
                        ).scalar_one_or_none()

                        if item is None:
                            item = EquipmentItem(
                                model_id=model.id,
                                inventory_number=item_data["inventory_number"],
                                serial_number=item_data.get("serial_number"),
                                status="active",
                            )
                            session.add(item)
                            logger.info(
                                "Создан экземпляр: %s", item.inventory_number
                            )

    logger.info("Seed завершён.")


async def main() -> None:
    try:
        await seed()
    finally:
        await close_database_connection()


if __name__ == "__main__":
    asyncio.run(main())
