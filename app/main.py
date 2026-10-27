import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand, BotCommandScopeChat, BotCommandScopeDefault

from app.bot.handlers.admin import router as admin_router  # добавлено
from app.bot.handlers.catalog import router as catalog_router
from app.bot.handlers.start import router as start_router
from app.bot.middlewares.throttling import SimpleThrottlingMiddleware
from app.core.config import settings
from app.db.session import check_database_connection, close_database_connection

logger = logging.getLogger(__name__)


async def _setup_bot_commands(bot: Bot) -> None:
    """Устанавливает меню команд по scope.

    Default — пользовательские команды. Главам клубов и суперадминам
    ставим расширенный набор отдельным BotCommandScopeChat.
    """
    user_commands = [
        BotCommand(command="start", description="Регистрация и главное меню"),
        BotCommand(command="clubs", description="Подать заявку во второй клуб"),
        BotCommand(command="catalog", description="Каталог оборудования"),
        BotCommand(command="help", description="Справка по боту"),
    ]
    reg_admin_commands = user_commands + [
        BotCommand(command="pending", description="Заявки на рассмотрении"),
    ]
    super_commands = reg_admin_commands + [
        BotCommand(command="users", description="Список пользователей"),
        BotCommand(command="block", description="Заблокировать пользователя"),
        BotCommand(command="unblock", description="Разблокировать пользователя"),
    ]
    try:
        await bot.set_my_commands(user_commands, scope=BotCommandScopeDefault())
    except Exception:
        logger.exception("Не удалось установить меню команд (default)")
        return

    reg_admins = settings.videographer_admin_ids | settings.photographer_admin_ids
    for admin_id in reg_admins - settings.admin_ids:
        try:
            await bot.set_my_commands(
                reg_admin_commands,
                scope=BotCommandScopeChat(chat_id=admin_id),
            )
        except Exception:
            logger.exception("Не удалось установить меню команд для %s", admin_id)
    for admin_id in settings.admin_ids:
        try:
            await bot.set_my_commands(
                super_commands,
                scope=BotCommandScopeChat(chat_id=admin_id),
            )
        except Exception:
            logger.exception("Не удалось установить меню команд для %s", admin_id)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)

    if not await check_database_connection():
        raise RuntimeError("Нет подключения к PostgreSQL")

    bot = Bot(token=settings.bot_token)
    dp = Dispatcher()
    # Callback'ов у пользователя может быть много подряд (toggle), даём запас.
    dp.callback_query.middleware(
        SimpleThrottlingMiddleware(limit=15, window_seconds=10),
    )
    # Команды — реже.
    dp.message.middleware(
        SimpleThrottlingMiddleware(limit=5, window_seconds=10),
    )
    dp.include_router(start_router)
    dp.include_router(admin_router)
    dp.include_router(catalog_router)

    await _setup_bot_commands(bot)

    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        await close_database_connection()


if __name__ == "__main__":
    asyncio.run(main())
