from aiogram.types import InlineKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder


def main_menu_kb(*, webapp_url: str | None = None) -> InlineKeyboardMarkup:
    """Главное меню пользователя."""
    kb = InlineKeyboardBuilder()
    kb.button(text="📦 Каталог", callback_data="catalog:root")
    kb.button(text="👤 Профиль", callback_data="menu:profile")
    kb.button(text="📖 Правила", callback_data="menu:rules")
    kb.button(text="❓ Помощь", callback_data="menu:help")
    if webapp_url:
        kb.button(text="📱 Открыть Mini App", web_app=WebAppInfo(url=webapp_url))
    kb.adjust(1)
    return kb.as_markup()


def back_to_menu_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="🏠 В меню", callback_data="menu:root")
    kb.adjust(1)
    return kb.as_markup()


def profile_kb(*, webapp_url: str | None = None) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    if webapp_url:
        kb.button(text="📱 Открыть Mini App", web_app=WebAppInfo(url=webapp_url))
    kb.button(text="🏠 В меню", callback_data="menu:root")
    kb.adjust(1)
    return kb.as_markup()
