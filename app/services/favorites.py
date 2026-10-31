"""CRUD избранного оборудования."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EquipmentModel, User, UserFavorite


async def list_favorites(session: AsyncSession, user: User) -> list[int]:
    result = await session.execute(
        select(UserFavorite.model_id).where(UserFavorite.user_id == user.id)
    )
    return [row[0] for row in result.all()]


async def add_favorite(
    session: AsyncSession, user: User, model_id: int
) -> int:
    model = await session.get(EquipmentModel, model_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Модель не найдена.",
        )
    existing = await session.execute(
        select(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.model_id == model_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return model_id
    fav = UserFavorite(user_id=user.id, model_id=model_id)
    session.add(fav)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
    return model_id


async def remove_favorite(
    session: AsyncSession, user: User, model_id: int
) -> None:
    result = await session.execute(
        select(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.model_id == model_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()
