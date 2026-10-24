from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.models import Category, EquipmentModel


def main_menu_kb() -> InlineKeyboardMarkup:
    """Кнопка «Каталог» под приветствием /start."""
    kb = InlineKeyboardBuilder()
    kb.button(text="📦 Каталог", callback_data="catalog:root")
    return kb.as_markup()


def categories_kb(categories: list[Category]) -> InlineKeyboardMarkup:
    """Список категорий + кнопка «Назад» в главное меню (на /start)."""
    kb = InlineKeyboardBuilder()
    for cat in categories:
        kb.button(text=cat.name, callback_data=f"catalog:cat:{cat.id}")
    kb.adjust(1)
    return kb.as_markup()


def models_kb(category_id: int, models: list[EquipmentModel]) -> InlineKeyboardMarkup:
    """Список моделей в категории + «Назад» к категориям."""
    kb = InlineKeyboardBuilder()
    for m in models:
        kb.button(text=m.name, callback_data=f"catalog:model:{m.id}")
    kb.button(text="⬅️ Назад к категориям", callback_data="catalog:root")
    kb.adjust(1)
    return kb.as_markup()


def model_card_kb(
    model_id: int, category_id: int
) -> InlineKeyboardMarkup:
    """Карточка модели: кнопка «Назад» к списку моделей категории."""
    kb = InlineKeyboardBuilder()
    kb.button(
        text="⬅️ Назад к моделям",
        callback_data=f"catalog:cat:{category_id}",
    )
    kb.adjust(1)
    return kb.as_markup()
