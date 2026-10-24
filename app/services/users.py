from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def get_or_create_user(
    session: AsyncSession,
    telegram_id: int,
    full_name: str,
    username: str | None,
) -> tuple[User, bool]:
    """Возвращает (пользователь, создан_ли_сейчас).

    INSERT ... ON CONFLICT DO NOTHING безопасен при параллельных /start.
    """
    stmt = (
        pg_insert(User)
        .values(telegram_id=telegram_id, full_name=full_name, username=username)
        .on_conflict_do_nothing(index_elements=[User.telegram_id])
        .returning(User.id)
    )
    created = (await session.execute(stmt)).scalar_one_or_none() is not None
    user = (
        await session.execute(select(User).where(User.telegram_id == telegram_id))
    ).scalar_one()
    return user, created
