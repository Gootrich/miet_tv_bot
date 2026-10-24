import logging

from aiogram import F, Router
from aiogram.types import CallbackQuery

from app.bot.keyboards.catalog import (
    categories_kb,
    model_card_kb,
    models_kb,
)
from app.db.session import AsyncSessionFactory
from app.services.catalog import (
    get_model_with_items,
    list_categories,
    list_models_by_category,
)

logger = logging.getLogger(__name__)
router = Router()

ROLE_NOTE = "\n\n<i>Фильтрация по ролям будет добавлена позже.</i>"


@router.callback_query(F.data == "catalog:root")
async def show_categories(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        categories = await list_categories(session)

    if not categories:
        await callback.message.edit_text(
            "Каталог пока пуст." + ROLE_NOTE,
            reply_markup=None,
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        "📦 <b>Каталог</b>\n\nВыберите категорию:" + ROLE_NOTE,
        reply_markup=categories_kb(categories),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("catalog:cat:"))
async def show_models(callback: CallbackQuery) -> None:
    category_id = int(callback.data.split(":")[2])
    async with AsyncSessionFactory() as session:
        models = await list_models_by_category(session, category_id)

    if not models:
        await callback.message.edit_text(
            "В этой категории пока нет моделей." + ROLE_NOTE,
            reply_markup=categories_kb([]),
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        "Выберите модель:" + ROLE_NOTE,
        reply_markup=models_kb(category_id, models),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("catalog:model:"))
async def show_model_card(callback: CallbackQuery) -> None:
    model_id = int(callback.data.split(":")[2])
    async with AsyncSessionFactory() as session:
        model = await get_model_with_items(session, model_id)

    if model is None:
        await callback.message.edit_text(
            "Модель не найдена.",
            reply_markup=categories_kb([]),
        )
        await callback.answer()
        return

    lines = [f"<b>{model.name}</b>"]
    if model.manufacturer:
        lines.append(f"Производитель: {model.manufacturer}")
    lines.append(f"Категория: {model.category.name}")
    lines.append(f"Политика доступа: <code>{model.access_policy}</code>")
    if model.description:
        lines.append("")
        lines.append(model.description)

    lines.append("")
    lines.append("<b>Экземпляры:</b>")
    if not model.items:
        lines.append("— нет")
    else:
        for item in model.items:
            status_note = {
                "active": "✅ доступен",
                "maintenance": "🛠 на обслуживании",
                "retired": "❌ списан",
            }.get(item.status, item.status)
            serial = f", S/N {item.serial_number}" if item.serial_number else ""
            lines.append(
                f"• {item.inventory_number}{serial} — {status_note}"
            )

    await callback.message.edit_text(
        "\n".join(lines) + ROLE_NOTE,
        reply_markup=model_card_kb(model.id, model.category_id),
    )
    await callback.answer()
