import logging
from html import escape

from aiogram import Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message
from sqlalchemy import select

from app.bot.keyboards.auth import CLUB_LABELS
from app.core.config import settings
from app.db.session import AsyncSessionFactory
from app.models.user import RegistrationRequest
from app.services.users import (
    block_user,
    find_user_by_telegram_id,
    list_all_users,
    list_pending_users,
    unblock_user,
)

logger = logging.getLogger(__name__)
router = Router()

PARSE_HTML = "HTML"


async def _is_users_admin(telegram_id: int) -> bool:
    async with AsyncSessionFactory() as session:
        user = await find_user_by_telegram_id(session, telegram_id)
        return bool(user and (user.has_scope("admin:users") or user.has_scope("admin:super")))


@router.message(Command("pending"))
async def cmd_pending(message: Message) -> None:
    if message.from_user is None:
        return
    async with AsyncSessionFactory() as session:
        me = await find_user_by_telegram_id(session, message.from_user.id)
        if me is None:
            await message.answer("Нет прав.")
            return
        if me.has_scope("admin:super"):
            allowed_clubs = {"photographer", "videographer"}
        else:
            allowed_clubs = set()
            if me.has_scope("admin:registrations:photographer"):
                allowed_clubs.add("photographer")
            if me.has_scope("admin:registrations:videographer"):
                allowed_clubs.add("videographer")
        if not allowed_clubs:
            await message.answer("Нет прав.")
            return

        result = await session.execute(
            select(RegistrationRequest)
            .where(
                RegistrationRequest.status == "pending",
                RegistrationRequest.club_code.in_(allowed_clubs),
            )
            .order_by(RegistrationRequest.created_at.asc())
        )
        reqs = list(result.scalars().all())

        # Имена пользователей
        user_ids = {r.user_id for r in reqs}
        users_by_id: dict[int, object] = {}
        if user_ids:
            from app.models.user import User
            users_result = await session.execute(
                select(User).where(User.id.in_(user_ids))
            )
            for u in users_result.scalars().all():
                users_by_id[u.id] = u

    if not reqs:
        await message.answer("Нет заявок на рассмотрении.")
        return

    lines = ["<b>Заявки на рассмотрении:</b>"]
    for r in reqs:
        u = users_by_id.get(r.user_id)
        if u is None:
            continue
        lines.append(
            f"• [{CLUB_LABELS.get(r.club_code, r.club_code)}] "
            f"<code>{u.telegram_id}</code> — {escape(u.full_name)} "
            f"(@{escape(u.username or '—')})"
        )
    await message.answer("\n".join(lines), parse_mode=PARSE_HTML)


@router.message(Command("users"))
async def cmd_users(message: Message) -> None:
    if message.from_user is None or not await _is_users_admin(message.from_user.id):
        await message.answer("Нет прав.")
        return
    async with AsyncSessionFactory() as session:
        users = await list_all_users(session)
    lines = ["<b>Пользователи:</b>"]
    for u in users[:50]:
        roles = ",".join(u.role_codes()) or "—"
        lines.append(
            f"• <code>{u.telegram_id}</code> {escape(u.full_name)} — "
            f"{u.status} [{escape(roles)}]"
        )
    await message.answer("\n".join(lines), parse_mode=PARSE_HTML)


@router.message(Command("block"))
async def cmd_block(message: Message, command: CommandObject) -> None:
    if message.from_user is None or not await _is_users_admin(message.from_user.id):
        await message.answer("Нет прав.")
        return
    if not command.args:
        await message.answer(
            "Формат: <code>/block &lt;telegram_id&gt; &lt;часы|0&gt; &lt;причина&gt;</code>\n"
            "Пример: <code>/block 123456789 24 нарушение правил</code>\n"
            "<code>0</code> — бессрочно.",
            parse_mode=PARSE_HTML,
        )
        return
    parts = command.args.split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Нужно: telegram_id, часы, причина.")
        return
    try:
        tg_id = int(parts[0])
        hours = int(parts[1])
    except ValueError:
        await message.answer("telegram_id и часы должны быть числами.")
        return
    reason = parts[2]

    async with AsyncSessionFactory() as session:
        async with session.begin():
            target = await find_user_by_telegram_id(session, tg_id)
            if target is None:
                await message.answer("Пользователь не найден.")
                return
            if message.from_user is not None and target.telegram_id == message.from_user.id:
                await message.answer("Нельзя заблокировать самого себя.")
                return
            if target.telegram_id in settings.admin_ids:
                await message.answer(
                    "Нельзя заблокировать администратора через бота. "
                    "Используйте другой канал управления."
                )
                return
            user = await block_user(
                session,
                user_id=target.id,
                hours=hours if hours > 0 else None,
                reason=reason,
            )
    await message.answer(
        f"🚫 Заблокирован: {escape(user.full_name)} "
        f"(<code>{user.telegram_id}</code>)\n"
        f"До: {user.blocked_until or 'бессрочно'}\n"
        f"Причина: {escape(user.block_reason or '')}",
        parse_mode=PARSE_HTML,
    )


@router.message(Command("unblock"))
async def cmd_unblock(message: Message, command: CommandObject) -> None:
    if message.from_user is None or not await _is_users_admin(message.from_user.id):
        await message.answer("Нет прав.")
        return
    if not command.args:
        await message.answer(
            "Формат: <code>/unblock &lt;telegram_id&gt;</code>",
            parse_mode=PARSE_HTML,
        )
        return
    try:
        tg_id = int(command.args.strip())
    except ValueError:
        await message.answer("telegram_id должен быть числом.")
        return
    async with AsyncSessionFactory() as session:
        async with session.begin():
            target = await find_user_by_telegram_id(session, tg_id)
            if target is None:
                await message.answer("Пользователь не найден.")
                return
            user = await unblock_user(session, user_id=target.id)
    await message.answer(
        f"✅ Разблокирован: {escape(user.full_name)}",
        parse_mode=PARSE_HTML,
    )
