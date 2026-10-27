import html
import logging
from datetime import datetime, timezone

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message

from app.bot.keyboards.auth import (
    CLUB_EMOJI,
    CLUB_LABELS,
    CLUB_ORDER,
    admin_request_kb,
    clubs_choice_kb,
    extra_clubs_kb,
    open_webapp_kb,
    pending_after_submit_kb,
    restart_after_reject_kb,
)
from app.bot.keyboards.catalog import main_menu_kb
from app.core.config import settings
from app.db.session import AsyncSessionFactory
from app.models.user import RegistrationRequest, User
from app.services import registrations as reg
from app.services.users import (
    ensure_admin_bootstrap,
    find_user_by_telegram_id,
    get_or_create_user,
    reload_with_roles,
)

logger = logging.getLogger(__name__)
router = Router()

PARSE_HTML = "HTML"

# TODO(координатор): согласовать формулировки чек-листа перед публикацией.
APPROVED_CHECKLIST = (
    "<b>Чек-лист участника:</b>\n"
    "1. Соблюдайте правила клуба и техники безопасности.\n"
    "2. Бронируйте оборудование заранее и отменяйте ненужные брони.\n"
    "3. Возвращайте технику вовремя и в исправном состоянии.\n"
    "4. Сообщайте администратору о поломках и потерях.\n"
    "5. Не передавайте оборудование третьим лицам.\n\n"
    "Открыть Mini App: /start → «Открыть приложение»."
)

# Человекочитаемые статусы заявок для пользователя и админа.
_STATUS_HUMAN = {
    "pending": "на рассмотрении",
    "approved": "одобрена",
    "rejected": "отклонена",
    "cancelled": "отменена",
}

_STATUS_HUMAN_ADMIN = {
    "approved": "уже одобрена",
    "rejected": "уже отклонена",
    "cancelled": "отменена пользователем",
}


def _selected_from_requests(reqs) -> set[str]:
    return {r.club_code for r in reqs if r.club_code in CLUB_ORDER}


async def _status_text(session, user) -> str:
    if user.status == "blocked":
        reason = html.escape(user.block_reason or "Доступ заблокирован.")
        if user.blocked_until:
            reason += f"\n\nДо: {user.blocked_until.strftime('%d.%m.%Y %H:%M UTC')}"
        return f"🚫 <b>Доступ заблокирован.</b>\n\n{reason}"
    if user.status == "rejected":
        reason = "Заявка отклонена."
        for r in await reg.list_all_for_user(session, user.id):
            if r.status == "rejected" and r.decision_reason:
                reason = r.decision_reason
                break
        return f"❌ <b>Заявка отклонена.</b>\n\n{html.escape(reason)}"
    if user.status == "active":
        text = f"Привет, <b>{html.escape(user.full_name or '')}</b>!"
        pending_reqs = await reg.list_pending_for_user(session, user.id)
        if pending_reqs:
            lines = ["", "", "⏳ <b>Заявки на рассмотрении:</b>"]
            for r in pending_reqs:
                label = CLUB_LABELS.get(r.club_code, r.club_code)
                emoji = CLUB_EMOJI.get(r.club_code, "")
                lines.append(f"⏳ {emoji} {label} — на рассмотрении")
            text += "\n".join(lines)
        return text
    return (
        "👋 <b>Добро пожаловать!</b>\n\n"
        "Выбери один или оба клуба, в которых ты состоишь."
    )


async def _requests_summary(session, user_id: int) -> str:
    reqs = await reg.list_all_for_user(session, user_id)
    if not reqs:
        return ""
    status_icons = {
        "pending": "⏳",
        "approved": "✅",
        "rejected": "❌",
        "cancelled": "↩️",
    }
    lines = ["<b>Твои заявки:</b>"]
    for r in reqs:
        label = CLUB_LABELS.get(r.club_code, r.club_code)
        emoji = CLUB_EMOJI.get(r.club_code, "")
        icon = status_icons.get(r.status, "•")
        text = _STATUS_HUMAN.get(r.status, r.status)
        lines.append(f"{icon} {emoji} {label} — {text}")
    return "\n".join(lines)


def _active_hint() -> str:
    return (
        "Используй <code>/catalog</code>, чтобы посмотреть оборудование, "
        "или <code>/clubs</code>, чтобы подать заявку во второй клуб."
    )


def _markup_for(user, pending_reqs):
    if user.status == "active":
        return open_webapp_kb() or main_menu_kb()
    if user.status == "pending":
        if pending_reqs:
            return pending_after_submit_kb()
        return clubs_choice_kb(set())
    if user.status == "rejected":
        return restart_after_reject_kb()
    return None


def _choice_screen_text(selected: set[str]) -> str:
    if not selected:
        hint = "<b>Твой выбор:</b> <i>пока пусто</i>"
    else:
        labels = ", ".join(
            f"{CLUB_EMOJI[c]} {CLUB_LABELS[c]}"
            for c in CLUB_ORDER if c in selected
        )
        hint = f"<b>Твой выбор:</b> {labels}"
    return (
        "👋 <b>Добро пожаловать!</b>\n\n"
        "Выбери один или оба клуба, в которых ты состоишь.\n\n"
        f"{hint}"
    )


# --- /start ---

@router.message(CommandStart())
async def cmd_start(message: Message, bot: Bot) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return

    async with AsyncSessionFactory() as session:
        async with session.begin():
            user, _created = await get_or_create_user(
                session,
                telegram_id=tg_user.id,
                full_name=tg_user.full_name,
                username=tg_user.username,
            )
            # Автоматическое снятие истёкшего временного бана.
            if (
                user.status == "blocked"
                and user.blocked_until is not None
                and user.blocked_until <= datetime.now(timezone.utc)
            ):
                user.blocked_until = None
                user.block_reason = None
                user.status = "pending"
                user.is_active = False
                await session.flush()
                await reg.recompute_user_status(session, user.id)
            user = await ensure_admin_bootstrap(session, user)
        user = await reload_with_roles(session, user.id)

        if user is None:
            await message.answer("Ошибка регистрации, попробуйте позже.")
            return

        pending = await reg.list_pending_for_user(session, user.id)
        text = await _status_text(session, user)
        if user.status == "active":
            text += "\n\n" + _active_hint()
        elif user.status == "pending" and pending:
            summary = await _requests_summary(session, user.id)
            if summary:
                text += "\n\n" + summary

    await message.answer(
        text,
        reply_markup=_markup_for(user, pending),
        parse_mode=PARSE_HTML,
    )


async def _summary_for_user(user_id: int) -> str:
    async with AsyncSessionFactory() as session:
        return await _requests_summary(session, user_id)


# --- /help ---

@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return

    is_blocked = False
    is_active_user = False
    is_reg_admin = False
    is_users_admin = False

    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, tg_user.id)
        if user is not None:
            is_blocked = user.status == "blocked"
            is_active_user = user.status == "active"
            # has_scope читается внутри сессии, роли уже загружены selectin.
            is_reg_admin = (
                user.has_scope("admin:super")
                or user.has_scope("admin:registrations:photographer")
                or user.has_scope("admin:registrations:videographer")
            )
            is_users_admin = (
                user.has_scope("admin:super")
                or user.has_scope("admin:users")
            )

    lines: list[str] = []
    if is_blocked:
        lines.append("🚫 <b>Доступ заблокирован.</b>")
        lines.append("")
    lines.append("<b>Что умеет бот</b>")
    lines.append("")
    lines.append("• /start — регистрация и главное меню")
    if is_active_user:
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

    await message.answer("\n".join(lines), parse_mode=PARSE_HTML)


# --- Toggle клуба ---

@router.callback_query(F.data.startswith("register:toggle:"))
async def toggle_club(callback: CallbackQuery) -> None:
    code = callback.data.split(":", 2)[2]
    if code not in CLUB_ORDER:
        await callback.answer("Неизвестный клуб")
        return

    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "pending":
                await callback.answer("Регистрация уже завершена")
                return
            raw = user.requested_role_code or ""
            selected = {c for c in raw.split(",") if c in CLUB_ORDER}
            if code in selected:
                selected.discard(code)
            else:
                selected.add(code)
            # Сохраняем промежуточный выбор в буфер (users.requested_role_code).
            user.requested_role_code = ",".join(
                c for c in CLUB_ORDER if c in selected
            ) or None
            await session.flush()
            await callback.message.edit_text(
                _choice_screen_text(selected),
                reply_markup=clubs_choice_kb(selected),
                parse_mode=PARSE_HTML,
            )
            await callback.answer()


# --- Подтверждение заявки ---

@router.callback_query(F.data == "register:confirm")
async def confirm_registration(callback: CallbackQuery, bot: Bot) -> None:
    # Из текста сообщения вытащить выбранное нельзя надёжно — используем
    # callback.data из клавиатуры: при каждом toggle мы обновляем клавиатуру
    # с актуальным selected. Но в callback.data выбора нет.
    #
    # Простое решение: пересобрать выбранные из текста сообщения по метке.
    # Надёжнее — сохранять выбор при каждом toggle в users.requested_role_code
    # как временный буфер. Так и делаем.
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "pending":
                await callback.answer("Регистрация уже завершена")
                return
            raw = user.requested_role_code or ""
            selected = {c for c in raw.split(",") if c in CLUB_ORDER}
            if not selected:
                await callback.answer("Выберите хотя бы один клуб", show_alert=True)
                return
            user.requested_role_code = None  # очищаем буфер
            new_reqs = await reg.sync_requests(session, user.id, selected)

    # Уведомления — только по вновь созданным заявкам
    for req in new_reqs:
        await _notify_admins_about_request(bot, user.id, req.club_code, req.id)

    summary = await _summary_for_user(user.id)
    await callback.message.edit_text(
        "⏳ <b>Заявка отправлена.</b>\n\n" + summary,
        reply_markup=pending_after_submit_kb(),
        parse_mode=PARSE_HTML,
    )
    await callback.answer("Заявка отправлена")


# --- Редактирование (вернуться назад) ---

@router.callback_query(F.data == "register:edit")
async def edit_registration(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "pending":
                await callback.answer("Редактирование недоступно")
                return
            await reg.cancel_pending(session, user.id)
            user.requested_role_code = None

    await callback.message.edit_text(
        _choice_screen_text(set()),
        reply_markup=clubs_choice_kb(set()),
        parse_mode=PARSE_HTML,
    )
    await callback.answer("Предыдущая заявка отменена, выберите заново")


# --- Подать заявку заново после отказа ---

@router.callback_query(F.data == "register:restart")
async def restart_registration(callback: CallbackQuery) -> None:
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "rejected":
                await callback.answer(
                    "Сейчас это действие недоступно", show_alert=True,
                )
                return
            user.status = "pending"
            user.is_active = False
            user.block_reason = None
            user.requested_role_code = None
            await session.flush()

    await callback.message.edit_text(
        _choice_screen_text(set()),
        reply_markup=clubs_choice_kb(set()),
        parse_mode=PARSE_HTML,
    )
    await callback.answer("Выберите клубы и отправьте заявку")


# --- Подать заявку во второй клуб (для active-пользователя) ---

def _extra_clubs_screen_text(approved: set[str], selected: set[str]) -> str:
    parts = ["📋 <b>Твои клубы</b>"]
    if approved:
        labels = ", ".join(
            f"{CLUB_EMOJI[c]} {CLUB_LABELS[c]}"
            for c in CLUB_ORDER if c in approved
        )
        parts.append(f"\n\n✅ Уже состоишь: {labels}")
    parts.append("\n\nВыбери клуб, в который хочешь подать заявку:")
    if selected:
        labels = ", ".join(
            f"{CLUB_EMOJI[c]} {CLUB_LABELS[c]}"
            for c in CLUB_ORDER if c in selected
        )
        parts.append(f"\n\n<b>Твой выбор:</b> {labels}")
    return "".join(parts)


@router.message(Command("clubs"))
async def cmd_clubs(message: Message) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, tg_user.id)
        if user is None:
            await message.answer("Отправь /start, чтобы начать.")
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
        reqs = await reg.list_all_for_user(session, user.id)
        approved = {r.club_code for r in reqs if r.status == "approved"}
        pending = {r.club_code for r in reqs if r.status == "pending"}
        available = [c for c in CLUB_ORDER if c not in approved]
        if not available:
            await message.answer(
                "Ты уже состоишь во всех доступных клубах.",
                parse_mode=PARSE_HTML,
            )
            return
        async with session.begin():
            user.requested_role_code = ",".join(
                c for c in CLUB_ORDER if c in pending
            ) or None

    await message.answer(
        _extra_clubs_screen_text(approved, pending),
        reply_markup=extra_clubs_kb(available, pending),
        parse_mode=PARSE_HTML,
    )


@router.callback_query(F.data.startswith("register:extra_toggle:"))
async def extra_toggle(callback: CallbackQuery) -> None:
    code = callback.data.split(":", 2)[2]
    if code not in CLUB_ORDER:
        await callback.answer("Неизвестный клуб")
        return
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "active":
                await callback.answer("Недоступно", show_alert=True)
                return
            reqs = await reg.list_all_for_user(session, user.id)
            approved = {r.club_code for r in reqs if r.status == "approved"}
            if code in approved:
                await callback.answer(
                    "Ты уже состоишь в этом клубе", show_alert=True,
                )
                return
            available = [c for c in CLUB_ORDER if c not in approved]
            raw = user.requested_role_code or ""
            selected = {c for c in raw.split(",") if c in CLUB_ORDER}
            if code in selected:
                selected.discard(code)
            else:
                selected.add(code)
            user.requested_role_code = ",".join(
                c for c in CLUB_ORDER if c in selected
            ) or None
            await session.flush()
            await callback.message.edit_text(
                _extra_clubs_screen_text(approved, selected),
                reply_markup=extra_clubs_kb(available, selected),
                parse_mode=PARSE_HTML,
            )
            await callback.answer()


@router.callback_query(F.data == "register:extra_confirm")
async def extra_confirm(callback: CallbackQuery, bot: Bot) -> None:
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user = await find_user_by_telegram_id(session, callback.from_user.id)
            if user is None or user.status != "active":
                await callback.answer("Недоступно", show_alert=True)
                return
            reqs = await reg.list_all_for_user(session, user.id)
            approved = {r.club_code for r in reqs if r.status == "approved"}
            raw = user.requested_role_code or ""
            selected = {c for c in raw.split(",") if c in CLUB_ORDER} - approved
            user.requested_role_code = None
            user_id = user.id
            new_reqs = await reg.sync_requests(session, user_id, selected)

    for req in new_reqs:
        await _notify_admins_about_request(bot, user_id, req.club_code, req.id)

    summary = await _summary_for_user(user_id)
    if new_reqs:
        await callback.message.edit_text(
            "⏳ <b>Заявка отправлена.</b>\n\n" + summary,
            parse_mode=PARSE_HTML,
        )
        await callback.answer("Заявка отправлена")
    else:
        await callback.message.edit_text(
            "Статус заявок обновлён.\n\n" + summary,
            parse_mode=PARSE_HTML,
        )
        await callback.answer("Обновлено")


# --- Хелпер для устаревших заявок у админа ---

async def _mark_request_message_done(callback: CallbackQuery, note: str) -> None:
    """Помечает сообщение админа как обработанное и убирает кнопки."""
    try:
        msg = callback.message
        if msg is None:
            return
        base = getattr(msg, "html_text", None) or getattr(msg, "text", "") or ""
        await msg.edit_text(
            base + f"\n\n<i>↩️ {html.escape(note)}</i>",
            parse_mode=PARSE_HTML,
            reply_markup=None,
        )
    except Exception:
        # Сообщение недоступно — не страшно, alert уже показан.
        pass


# --- Уведомления админам ---

async def _notify_admins_about_request(
    bot: Bot, user_id: int, club_code: str, request_id: int,
) -> None:
    admin_ids = settings.admin_ids_for_club(club_code)
    if not admin_ids:
        logger.warning("Нет админов для клуба %s — уведомление не отправлено", club_code)
        return
    async with AsyncSessionFactory() as session:
        user = await session.get(__import__("app.models.user", fromlist=["User"]).User, user_id)
    if user is None:
        return
    label = CLUB_LABELS.get(club_code, club_code)
    emoji = CLUB_EMOJI.get(club_code, "")
    text = (
        f"🔔 <b>Заявка в клуб {emoji} {label}</b>\n\n"
        f"Имя: {html.escape(user.full_name or '')}\n"
        f"Username: @{html.escape(user.username or '—')}\n"
        f"Telegram ID: <code>{user.telegram_id}</code>"
    )
    for admin_id in admin_ids:
        try:
            await bot.send_message(
                admin_id, text,
                reply_markup=admin_request_kb(request_id, club_code),
                parse_mode=PARSE_HTML,
            )
        except Exception:
            logger.exception("Не удалось уведомить админа %s", admin_id)


# --- Approve / reject по request_id ---

@router.callback_query(F.data.startswith("admin:req:approve:"))
async def admin_req_approve(callback: CallbackQuery, bot: Bot) -> None:
    request_id = int(callback.data.split(":")[3])
    async with AsyncSessionFactory() as session:
        async with session.begin():
            admin_user = await find_user_by_telegram_id(session, callback.from_user.id)
            if not admin_user:
                await callback.answer("Нет прав", show_alert=True)
                return
            req_check = await session.get(RegistrationRequest, request_id)
            if req_check is None:
                await callback.answer("Заявка не найдена", show_alert=True)
                return
            if not (
                admin_user.has_scope("admin:super")
                or admin_user.has_scope(f"admin:registrations:{req_check.club_code}")
            ):
                await callback.answer("Нет прав на заявки этого клуба", show_alert=True)
                return
            if req_check.status != "pending":
                label = _STATUS_HUMAN_ADMIN.get(req_check.status, req_check.status)
                await callback.answer(
                    f"Заявка {label}. Действие не требуется.", show_alert=True,
                )
                await _mark_request_message_done(callback, label.capitalize())
                return
            try:
                req = await reg.approve_request(
                    session, request_id=request_id, approver_id=admin_user.id,
                )
                target_user = await session.get(User, req.user_id)
            except ValueError as exc:
                await callback.answer(str(exc), show_alert=True)
                return

    try:
        await callback.message.edit_text(
            (callback.message.html_text or callback.message.text or "")
            + "\n\n✅ <b>Одобрено</b>",
            parse_mode=PARSE_HTML,
        )
    except Exception:
        pass
    await callback.answer("Одобрено")

    if target_user is not None:
        try:
            await bot.send_message(
                target_user.telegram_id,
                f"✅ Ваша заявка в клуб "
                f"«{CLUB_LABELS.get(req.club_code, req.club_code)}» одобрена.\n\n"
                + APPROVED_CHECKLIST,
                parse_mode=PARSE_HTML,
            )
        except Exception:
            logger.exception("Не удалось уведомить %s", target_user.telegram_id)


@router.callback_query(F.data.startswith("admin:req:reject:"))
async def admin_req_reject(callback: CallbackQuery, bot: Bot) -> None:
    request_id = int(callback.data.split(":")[3])
    async with AsyncSessionFactory() as session:
        async with session.begin():
            admin_user = await find_user_by_telegram_id(session, callback.from_user.id)
            if not admin_user:
                await callback.answer("Нет прав", show_alert=True)
                return
            req_check = await session.get(RegistrationRequest, request_id)
            if req_check is None:
                await callback.answer("Заявка не найдена", show_alert=True)
                return
            if not (
                admin_user.has_scope("admin:super")
                or admin_user.has_scope(f"admin:registrations:{req_check.club_code}")
            ):
                await callback.answer("Нет прав на заявки этого клуба", show_alert=True)
                return
            if req_check.status != "pending":
                label = _STATUS_HUMAN_ADMIN.get(req_check.status, req_check.status)
                await callback.answer(
                    f"Заявка {label}. Действие не требуется.", show_alert=True,
                )
                await _mark_request_message_done(callback, label.capitalize())
                return
            try:
                req = await reg.reject_request(
                    session, request_id=request_id, approver_id=admin_user.id,
                )
                target_user = await session.get(User, req.user_id)
            except ValueError as exc:
                await callback.answer(str(exc), show_alert=True)
                return

    try:
        await callback.message.edit_text(
            (callback.message.html_text or callback.message.text or "")
            + "\n\n❌ <b>Отклонено</b>",
            parse_mode=PARSE_HTML,
        )
    except Exception:
        pass
    await callback.answer("Отклонено")

    if target_user is not None:
        try:
            reason_suffix = ""
            if req.decision_reason:
                reason_suffix = f"\n\nПричина: {html.escape(req.decision_reason)}"
            await bot.send_message(
                target_user.telegram_id,
                f"❌ Заявка в клуб "
                f"«{CLUB_LABELS.get(req.club_code, req.club_code)}» отклонена."
                + reason_suffix,
                parse_mode=PARSE_HTML,
            )
        except Exception:
            logger.exception("Не удалось уведомить %s", target_user.telegram_id)
