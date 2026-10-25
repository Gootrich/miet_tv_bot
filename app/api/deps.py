from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_session
from app.core.config import settings
from app.core.security import verify_telegram_init_data
from app.models.user import User


async def get_current_user(
    x_telegram_init_data: str | None = Header(None, description="Telegram WebApp initData"),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Аутентифицирует пользователя через Telegram initData.
    Тестовый пользователь доступен только при DEBUG=true.
    """
    if not x_telegram_init_data or x_telegram_init_data == "dev-mode":
        if not settings.debug:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Требуется авторизация через Telegram.",
            )

        result = await session.execute(
            select(User)
            .options(selectinload(User.roles))
            .where(User.telegram_id == 123456789)
        )
        user = result.scalar_one_or_none()

        if not user:
            user = User(
                telegram_id=123456789,
                full_name="Test Developer",
                username="test_dev",
                is_active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            result = await session.execute(
                select(User)
                .options(selectinload(User.roles))
                .where(User.telegram_id == 123456789)
            )
            user = result.scalar_one()

        return user

    bot_token = getattr(settings, "bot_token", None)
    if not bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Токен бота не настроен на сервере.",
        )

    user_data = verify_telegram_init_data(x_telegram_init_data, bot_token)
    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный ID пользователя в Telegram данных.",
        )

    result = await session.execute(
        select(User)
        .options(selectinload(User.roles))
        .where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        full_name = (
            f"{user_data.get('first_name', '')} "
            f"{user_data.get('last_name', '')}"
        ).strip() or "User"

        user = User(
            telegram_id=telegram_id,
            full_name=full_name,
            username=user_data.get("username"),
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        result = await session.execute(
            select(User)
            .options(selectinload(User.roles))
            .where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
    else:
        updated = False
        new_full_name = (
            f"{user_data.get('first_name', '')} "
            f"{user_data.get('last_name', '')}"
        ).strip()

        if new_full_name and user.full_name != new_full_name:
            user.full_name = new_full_name
            updated = True

        if user_data.get("username") and user.username != user_data.get("username"):
            user.username = user_data.get("username")
            updated = True

        if updated:
            await session.commit()
            await session.refresh(user)

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пользователь заблокирован в системе.",
        )

    return user
