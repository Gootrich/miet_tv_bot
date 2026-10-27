"""Главное меню, профиль, правила, справка."""
import html
import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message

from app.bot.keyboards.auth import CLUB_EMOJI, CLUB_LABELS, CLUB_ORDER
from app.bot.keyboards.menu import back_to_menu_kb, main_menu_kb, profile_kb
from app.core.config import settings
from app.db.session import AsyncSessionFactory
from app.services import registrations as reg
from app.services.users import find_user_by_telegram_id

logger = logging.getLogger(__name__)
router = Router()

PARSE_HTML = "HTML"

APPROVED_CHECKLIST = (
    "<b>Чек-лист участника:</b>\n"
    "1. Соблюдайте правила клуба и техники безопасности.\n"
    "2. Бронируйте оборудование заранее и отменяйте ненужные брони.\n"
    "3. Возвращайте технику вовремя и в исправном состоянии.\n"
    "4. Сообщайте администратору о поломках и потерях.\n"
    "5. Не передавайте оборудование третьим лицам.\n\n"
    "Открыть Mini App: /start → «Открыть приложение»."
)

RULES_EXTENDED = (
    "<b>Правила MIET MediaHub</b>\n\n"
    "1. Соблюдайте правила клуба и техники безопасности.\n"
    "2. Бронируйте оборудование заранее и отменяйте ненужные брони.\n"
    "3. Возвращайте технику вовремя и в исправном состоянии.\n"
    "4. Сообщайте администратору о поломках и потерях.\n"
    "5. Не передавайте оборудование третьим лицам.\n\n"
    "<b>Что умеет сервис</b>\n"
    "• Каталог оборудования с фильтрами и доступностью.\n"
    "• Календарь бронирований и управление своими бронями.\n"
    "• Заявки на вступление в клубы InFocus и МИЭТ-ТВ.\n"
    "• Администраторам — управление пользователями и заявками.\n\n"
    "Полноценный интерфейс — в Telegram Mini App."
)


def _menu_markup() -> object:
    return main_menu_kb(webapp_url=settings.webapp_url or None)


def _menu_text(user) -> str:
    name = html.escape(user.full_name or "друг")
    return (
        f"🏠 <b>Главное меню</b>\n\n"
        f"Привет, <b>{name}</b>!\n"
        f"Выбери действие или используй команды: /start, /clubs, /catalog, /help."
    )


def _profile_text(user, approved, pending) -> str:
    lines = ["👤 <b>Профиль</b>", ""]
    lines.append(f"Имя: <b>{html.escape(user.full_name or '—')}</b>")
    if user.username:
        lines.append(f"Username: @{html.escape(user.username)}")
    lines.append(f"Telegram ID: <code>{user.telegram_id}</code>")
    status_map = {
        "active": "✅ одобрен",
        "pending": "⏳ на рассмотрении",
        "rejected": "❌ отклонён",
        "blocked": "🚫 заблокирован",
    }
    lines.append(f"Статус: {status_map.get(user.status, user.status)}")
    if approved:
        labels = ", ".join(
            f"{CLUB_EMOJI[c]} {CLUB_LABELS[c]}"
            for c in CLUB_ORDER if c in approved
        )
        lines.append(f"Клубы: {labels}")
    else:
        lines.append("Клубы: <i>пока нет</i>")
    if pending:
        labels = ", ".join(
            f"{CLUB_EMOJI[c]} {CLUB_LABELS[c]}"
            for c in CLUB_ORDER if c in pending
        )
        lines.append(f"На рассмотрении: {labels}")
    roles = user.role_codes() if user.roles is not None else []
    if roles:
        lines.append(f"Роли: {', '.join(roles)}")
    return "\n".join(lines)


def build_help_text(user) -> str:
    """Текст справки по фактическим правам пользователя."""
    is_blocked = user is not None and user.status == "blocked"
    is_active = user is not None and user.status == "active"
    is_reg_admin = user is not None and (
        user.has_scope("admin:super")
        or user.has_scope("admin:registrations:photographer")
        or user.has_scope("admin:registrations:videographer")
    )
    is_users_admin = user is not None and (
        user.has_scope("admin:super") or user.has_scope("admin:users")
    )

    lines: list[str] = []
    if is_blocked:
        lines.append("🚫 <b>Доступ заблокирован.</b>")
        lines.append("")
    lines.append("<b>Что умеет бот</b>")
    lines.append("")
    lines.append("• /start — регистрация и главное меню")
    lines.append("• /menu — главное меню с кнопками")
    if is_active:
        lines.append("• /clubs — подать заявку во второй клуб")
        lines.append("• /catalog — каталог оборудования")
    lines.append("• /help — эта справка")

    if is_reg_admin or is_users_admin:
        lines.append("")
        lines.append("<b>Администратору:</b>")
        if is_reg_admin:
            lines.append("• /pending — заявки на рассмотрении")
        if is_users_admin:
            lines.append("• /users — список пользователей")
            lines.append(
                "• /block &lt;telegram_id&gt; &lt;часы|0&gt; &lt;причина&gt; "
                "— заблокировать"
            )
            lines.append("• /unblock &lt;telegram_id&gt; — разблокировать")

    return "\n".join(lines)


@router.message(Command("menu"))
async def cmd_menu(message: Message) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, tg_user.id)
    if user is None:
        await message.answer(
            "Отправь /start, чтобы начать.", parse_mode=PARSE_HTML,
        )
        return
    if user.status == "blocked":
        await message.answer(
            "🚫 Доступ заблокирован.", parse_mode=PARSE_HTML,
        )
        return
    if user.status == "pending":
        await message.answer(
            "Сначала заверши регистрацию: /start", parse_mode=PARSE_HTML,
        )
        return
    if user.status == "rejected":
        await message.answer(
            "Твоя заявка была отклонена. Подай новую: /start",
            parse_mode=PARSE_HTML,
        )
        return
    await message.answer(
        _menu_text(user),
        reply_markup=_menu_markup(),
        parse_mode=PARSE_HTML,
    )


@router.callback_query(F.data == "menu:root")
async def menu_root(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, callback.from_user.id)
    if user is None or user.status != "active":
        await callback.answer(
            "Доступно только одобренным пользователям", show_alert=True,
        )
        return
    await callback.message.edit_text(
        _menu_text(user),
        reply_markup=_menu_markup(),
        parse_mode=PARSE_HTML,
    )
    await callback.answer()


@router.callback_query(F.data == "menu:profile")
async def menu_profile(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, callback.from_user.id)
        if user is None or user.status != "active":
            await callback.answer("Недоступно", show_alert=True)
            return
        reqs = await reg.list_all_for_user(session, user.id)
        approved = {r.club_code for r in reqs if r.status == "approved"}
        pending = {r.club_code for r in reqs if r.status == "pending"}
        text = _profile_text(user, approved, pending)
    await callback.message.edit_text(
        text,
        reply_markup=profile_kb(webapp_url=settings.webapp_url or None),
        parse_mode=PARSE_HTML,
    )
    await callback.answer()


@router.callback_query(F.data == "menu:rules")
async def menu_rules(callback: CallbackQuery) -> None:
    await callback.message.edit_text(
        RULES_EXTENDED,
        reply_markup=back_to_menu_kb(),
        parse_mode=PARSE_HTML,
    )
    await callback.answer()


@router.callback_query(F.data == "menu:help")
async def menu_help(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, callback.from_user.id)
    text = build_help_text(user)
    await callback.message.edit_text(
        text,
        reply_markup=back_to_menu_kb(),
        parse_mode=PARSE_HTML,
    )
    await callback.answer()
