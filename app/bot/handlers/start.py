import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message

from app.bot.keyboards.auth import (
    CLUB_LABELS,
    CLUB_ORDER,
    admin_request_kb,
    clubs_choice_kb,
    open_webapp_kb,
    pending_after_submit_kb,
)
from app.bot.keyboards.catalog import main_menu_kb
from app.core.config import settings
from app.db.session import AsyncSessionFactory
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


def _selected_from_requests(reqs) -> set[str]:
    return {r.club_code for r in reqs if r.club_code in CLUB_ORDER}


def _status_text(user) -> str:
    if user.status == "blocked":
        reason = user.block_reason or "Доступ заблокирован."
        if user.blocked_until:
            reason += f"\n\nДо: {user.blocked_until.strftime('%d.%m.%Y %H:%M UTC')}"
        return f"🚫 <b>Доступ заблокирован.</b>\n\n{reason}"
    if user.status == "rejected":
        reason = user.block_reason or "Заявка отклонена."
        return f"❌ <b>Заявка отклонена.</b>\n\n{reason}"
    if user.status == "active":
        return f"Привет, <b>{user.full_name}</b>!"
    return (
        "👋 <b>Регистрация</b>\n\n"
        "Выберите, в каких клубах вы состоите.\n"
        "Можно выбрать оба."
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
    lines = ["<b>Заявки:</b>"]
    for r in reqs:
        label = CLUB_LABELS.get(r.club_code, r.club_code)
        icon = status_icons.get(r.status, "•")
        lines.append(f"{icon} {label} — {r.status}")
    return "\n".join(lines)


def _active_hint() -> str:
    return "Используйте <code>/catalog</code>, чтобы посмотреть оборудование."


def _markup_for(user, pending_reqs):
    if user.status == "active":
        return open_webapp_kb() or main_menu_kb()
    if user.status == "pending":
        if pending_reqs:
            return pending_after_submit_kb()
        return clubs_choice_kb(set())
    return None


def _choice_screen_text(selected: set[str]) -> str:
    if not selected:
        hint = "<i>Пока ничего не выбрано.</i>"
    else:
        labels = ", ".join(CLUB_LABELS[c] for c in CLUB_ORDER if c in selected)
        hint = f"Выбрано: <b>{labels}</b>"
    return (
        "👋 <b>Регистрация</b>\n\n"
        "Выберите, в каких клубах вы состоите.\n"
        "Можно выбрать оба.\n\n"
        f"{hint}"
    )


# --- /start ---

@router.message(CommandStart())
async def cmd_start(message: Message, bot: Bot) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return

    created = False
    async with AsyncSessionFactory() as session:
        async with session.begin():
            user, created = await get_or_create_user(
                session,
                telegram_id=tg_user.id,
                full_name=tg_user.full_name,
                username=tg_user.username,
            )
            user = await ensure_admin_bootstrap(session, user)
        user = await reload_with_roles(session, user.id)

        if user is None:
            await message.answer("Ошибка регистрации, попробуйте позже.")
            return

        pending = await reg.list_pending_for_user(session, user.id)

    text = _status_text(user)
    if user.status == "active":
        text += "\n\n" + _active_hint()
    elif user.status == "pending" and pending:
        summary = await _summary_for_user(user.id)
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
    text = (
        "<b>Что умеет бот</b>\n\n"
        "• /start — регистрация и главное меню\n"
        "• /catalog — каталог оборудования\n"
        "• /pending — (для админов) заявки на рассмотрении\n"
        "• /users — (для админов) список пользователей\n"
        "• /block &lt;telegram_id&gt; &lt;часы|0&gt; &lt;причина&gt; — заблокировать\n"
        "• /unblock &lt;telegram_id&gt; — разблокировать"
    )
    await message.answer(text, parse_mode=PARSE_HTML)


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
        await session.commit()

    # Уведомления — по одной на заявку
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
        await session.commit()

    await callback.message.edit_text(
        _choice_screen_text(set()),
        reply_markup=clubs_choice_kb(set()),
        parse_mode=PARSE_HTML,
    )
    await callback.answer("Предыдущая заявка отменена, выберите заново")


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
    text = (
        f"🔔 <b>Заявка в клуб «{label}»</b>\n\n"
        f"Имя: {user.full_name}\n"
        f"Username: @{user.username or '—'}\n"
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
            # Проверка scope по клубу конкретной заявки
            from app.models.user import RegistrationRequest
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
            try:
                req = await reg.approve_request(
                    session, request_id=request_id, approver_id=admin_user.id,
                )
                target_user = await session.get(
                    __import__("app.models.user", fromlist=["User"]).User, req.user_id,
                )
            except ValueError as exc:
                await callback.answer(str(exc), show_alert=True)
                return
        await session.commit()

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
                f"«{CLUB_LABELS.get(req.club_code, req.club_code)}» одобрена.",
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
            from app.models.user import RegistrationRequest
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
            try:
                req = await reg.reject_request(
                    session, request_id=request_id, approver_id=admin_user.id,
                )
                target_user = await session.get(
                    __import__("app.models.user", fromlist=["User"]).User, req.user_id,
                )
            except ValueError as exc:
                await callback.answer(str(exc), show_alert=True)
                return
        await session.commit()

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
            await bot.send_message(
                target_user.telegram_id,
                f"❌ Заявка в клуб "
                f"«{CLUB_LABELS.get(req.club_code, req.club_code)}» отклонена.",
                parse_mode=PARSE_HTML,
            )
        except Exception:
            logger.exception("Не удалось уведомить %s", target_user.telegram_id)
