import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.users import find_user_by_telegram_id

logger = logging.getLogger(__name__)
router = Router()

PARSE_HTML = "HTML"
ROLE_NOTE = "\n\n<i>Фильтрация по ролям будет добавлена позже.</i>"


async def _ensure_active(telegram_id: int) -> bool:
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, telegram_id)
    return bool(user and user.status == "active")


# --- /catalog как отдельная команда ---

@router.message(Command("catalog"))
async def cmd_catalog(message: Message) -> None:
    if message.from_user is None:
        return
    if not await _ensure_active(message.from_user.id):
        await message.answer(
            "🔒 Каталог доступен только одобренным пользователям.\n"
            "Отправьте /start, чтобы подать заявку.",
            parse_mode=PARSE_HTML,
        )
        return

    async with AsyncSessionFactory() as session:
        categories = await list_categories(session)

    if not categories:
        await message.answer("Каталог пока пуст.")
        return

    await message.answer(
        "📦 <b>Каталог</b>\n\nВыберите категорию:" + ROLE_NOTE,
        reply_markup=categories_kb(categories),
        parse_mode=PARSE_HTML,
    )


# --- callback'и каталога ---

@router.callback_query(F.data == "catalog:root")
async def show_categories(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        categories = await list_categories(session)

    if not categories:
        await callback.message.edit_text(
            "Каталог пока пуст." + ROLE_NOTE,
            reply_markup=None,
            parse_mode=PARSE_HTML,
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        "📦 <b>Каталог</b>\n\nВыберите категорию:" + ROLE_NOTE,
        reply_markup=categories_kb(categories),
        parse_mode=PARSE_HTML,
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
            parse_mode=PARSE_HTML,
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        "Выберите модель:" + ROLE_NOTE,
        reply_markup=models_kb(category_id, models),
        parse_mode=PARSE_HTML,
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
            parse_mode=PARSE_HTML,
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
        parse_mode=PARSE_HTML,
    )
    await callback.answer()
