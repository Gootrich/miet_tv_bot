from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings


engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
)

AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Предоставляет асинхронную сессию SQLAlchemy."""
    async with AsyncSessionFactory() as session:
        yield session


async def check_database_connection() -> bool:
    """Проверяет подключение к PostgreSQL."""
    from sqlalchemy import text

    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT 1"))
        return result.scalar_one() == 1


async def close_database_connection() -> None:
    """Закрывает пул соединений при остановке приложения."""
    await engine.dispose()
