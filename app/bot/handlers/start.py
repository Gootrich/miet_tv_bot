import logging

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from app.db.session import AsyncSessionFactory
from app.services.users import get_or_create_user

logger = logging.getLogger(__name__)
router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    tg_user = message.from_user
    if tg_user is None:
        logger.warning("Received /start without from_user (update_id=%s)", message.message_id)
        return

    try:
        async with AsyncSessionFactory() as session:
            async with session.begin():
                user, created = await get_or_create_user(
                    session,
                    telegram_id=tg_user.id,
                    full_name=tg_user.full_name,
                    username=tg_user.username,
                )
    except Exception:
        # Технические детали — только в лог. Пользователю — нейтральный текст.
        logger.exception("Failed to register user telegram_id=%s on /start", tg_user.id)
        await message.answer(
            "Не удалось обработать запрос. Попробуйте позже."
        )
        return

    logger.info(
        "User telegram_id=%s %s (db_id=%s)",
        tg_user.id,
        "created" if created else "updated",
        user.id,
    )
    await message.answer(f"Привет, {user.full_name}!")
