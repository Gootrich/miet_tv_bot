import asyncio
import logging

from aiogram import Bot, Dispatcher

from app.bot.handlers.start import router as start_router
from app.core.config import settings
from app.db.session import check_database_connection, close_database_connection


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    if not await check_database_connection():
        raise RuntimeError("Нет подключения к PostgreSQL")

    bot = Bot(token=settings.bot_token)
    dp = Dispatcher()
    dp.include_router(start_router)

    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        await close_database_connection()


if __name__ == "__main__":
    asyncio.run(main())
