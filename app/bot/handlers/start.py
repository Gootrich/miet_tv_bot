from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from app.db.session import AsyncSessionFactory
from app.services.users import get_or_create_user

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    tg_user = message.from_user
    if tg_user is None:
        return

    async with AsyncSessionFactory() as session:
        async with session.begin():
            user, created = await get_or_create_user(
                session,
                telegram_id=tg_user.id,
                full_name=tg_user.full_name,
                username=tg_user.username,
            )

    if created:
        text = f"Привет, {user.full_name}! Вы зарегистрированы в системе бронирования."
    else:
        text = f"С возвращением, {user.full_name}!"
    await message.answer(text)
