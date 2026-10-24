from sqlalchemy import select, text
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

    INSERT ... ON CONFLICT (telegram_id) DO UPDATE:
    - безопасен при параллельных /start;
    - обновляет актуальные full_name и username у существующего пользователя.

    Признак «создан сейчас» вычисляется через PostgreSQL-трюк (xmax = 0):
    у только что вставленной строки системный столбец xmax = 0,
    у обновлённой — xmax <> 0. Это документированный приём PostgreSQL.
    """
    stmt = (
        pg_insert(User)
        .values(telegram_id=telegram_id, full_name=full_name, username=username)
        .on_conflict_do_update(
            index_elements=[User.telegram_id],
            set_={
                "full_name": full_name,
                "username": username,
            },
        )
        .returning(User, text("(xmax = 0) AS inserted"))
    )
    result = await session.execute(stmt)
    row = result.one()
    user: User = row[0]
    created: bool = bool(row[1])
    return user, created
