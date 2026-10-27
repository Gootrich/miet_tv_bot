from aiogram.types import (
    InlineKeyboardMarkup,
    WebAppInfo,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.core.config import settings


# Внутренние коды клубов (совпадают с roles.code из БД).
# ВАЖНО:
#   videographer = МИЭТ-ТВ (видеографы)
#   photographer = InFocus  (фотографы)
CLUB_ROLE_VIDEOGRAPHER = "videographer"   # МИЭТ-ТВ
CLUB_ROLE_PHOTOGRAPHER = "photographer"   # InFocus

CLUB_LABELS = {
    CLUB_ROLE_VIDEOGRAPHER: "МИЭТ-ТВ",
    CLUB_ROLE_PHOTOGRAPHER: "InFocus",
}

# Эмодзи-идентификатор клуба для кнопок, сводок и уведомлений.
CLUB_EMOJI = {
    CLUB_ROLE_VIDEOGRAPHER: "📹",
    CLUB_ROLE_PHOTOGRAPHER: "📷",
}

# Эмодзи-идентификатор клуба для кнопок, сводок и уведомлений.
CLUB_EMOJI = {
    CLUB_ROLE_VIDEOGRAPHER: "📹",
    CLUB_ROLE_PHOTOGRAPHER: "📷",
}

# Порядок отображения клубов: МИЭТ-ТВ, InFocus
CLUB_ORDER = [CLUB_ROLE_VIDEOGRAPHER, CLUB_ROLE_PHOTOGRAPHER]


def _toggle_mark(active: bool) -> str:
    return "✅" if active else "⬜"


def clubs_choice_kb(selected: set[str]) -> InlineKeyboardMarkup:
    """Клавиатура выбора клубов: toggle-кнопки + Подтвердить + вернуться при необходимости."""
    kb = InlineKeyboardBuilder()
    for code in CLUB_ORDER:
        kb.button(
            text=f"{_toggle_mark(code in selected)} {CLUB_EMOJI[code]} {CLUB_LABELS[code]}",
            callback_data=f"register:toggle:{code}",
        )
    kb.adjust(1)
    # Подтвердить показываем всегда: если ничего не выбрано, бот объяснит.
    kb.button(text="✅ Подтвердить", callback_data="register:confirm")
    kb.adjust(1)
    return kb.as_markup()


def pending_after_submit_kb() -> InlineKeyboardMarkup:
    """Под заявкой после подтверждения."""
    kb = InlineKeyboardBuilder()
    kb.button(
        text="✏️ Изменить выбор",
        callback_data="register:edit",
    )
    kb.adjust(1)
    return kb.as_markup()


def restart_after_reject_kb() -> InlineKeyboardMarkup:
    """Кнопка для отклонённого пользователя: попробовать подать заявку снова."""
    kb = InlineKeyboardBuilder()
    kb.button(text="🔁 Подать заново", callback_data="register:restart")
    kb.adjust(1)
    return kb.as_markup()


def extra_clubs_kb(available: list[str], selected: set[str]) -> InlineKeyboardMarkup:
    """Клавиатура для active-пользователя: подать заявку во второй клуб.

    available — клубы, в которых пользователь ещё не состоит.
    selected — текущий выбор в этом диалоге (включая pending).
    """
    kb = InlineKeyboardBuilder()
    for code in available:
        kb.button(
            text=(
                f"{_toggle_mark(code in selected)} "
                f"{CLUB_EMOJI[code]} {CLUB_LABELS[code]}"
            ),
            callback_data=f"register:extra_toggle:{code}",
        )
    kb.adjust(1)
    kb.button(text="✅ Отправить", callback_data="register:extra_confirm")
    kb.adjust(1)
    return kb.as_markup()


def open_webapp_kb() -> InlineKeyboardMarkup | None:
    if not settings.webapp_url:
        return None
    kb = InlineKeyboardBuilder()
    kb.button(text="📱 Открыть приложение", web_app=WebAppInfo(url=settings.webapp_url))
    return kb.as_markup()


def admin_request_kb(request_id: int, club_code: str) -> InlineKeyboardMarkup:
    """Кнопки под уведомлением об одной заявке."""
    label = CLUB_LABELS.get(club_code, club_code)
    kb = InlineKeyboardBuilder()
    kb.button(
        text=f"✅ Одобрить ({label})",
        callback_data=f"admin:req:approve:{request_id}",
    )
    kb.button(
        text=f"❌ Отклонить ({label})",
        callback_data=f"admin:req:reject:{request_id}",
    )
    kb.adjust(1)
    return kb.as_markup()


# Оставляем старое имя как алиас для обратной совместимости (не используется).
def admin_moderation_kb(user_id: int, roles: list[str]) -> InlineKeyboardMarkup:  # noqa: ARG001
    raise RuntimeError("admin_moderation_kb устарел, используйте admin_request_kb")
