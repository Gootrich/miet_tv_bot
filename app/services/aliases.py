"""CRUD для альтернативных названий моделей оборудования."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EquipmentModelAlias, User


def normalize_alias(value: str) -> str:
    """Нормализация для дедупликации: NFC + lower + collapse spaces."""
    v = unicodedata.normalize("NFC", value).strip().lower()
    v = re.sub(r"\s+", " ", v)
    return v


def _require_approved(user: User) -> None:
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аккаунт заблокирован.",
        )
    if not getattr(user, "approved_at", None) and not getattr(user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Действие доступно только одобренным участникам.",
        )


async def list_aliases(
    session: AsyncSession, model_id: int
) -> list[EquipmentModelAlias]:
    result = await session.execute(
        select(EquipmentModelAlias)
        .where(EquipmentModelAlias.model_id == model_id)
        .order_by(EquipmentModelAlias.value)
    )
    return list(result.scalars().all())


async def add_alias(
    session: AsyncSession,
    model_id: int,
    value: str,
    actor: User,
) -> EquipmentModelAlias:
    _require_approved(actor)
    display = value.strip()
    if not display:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустое значение.",
        )
    if len(display) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Слишком длинное значение.",
        )
    normalized = normalize_alias(display)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Значение после нормализации пустое.",
        )

    # Проверка дубликата на модели
    existing = await session.execute(
        select(EquipmentModelAlias).where(
            EquipmentModelAlias.model_id == model_id,
            EquipmentModelAlias.value_normalized == normalized,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Такое название уже добавлено.",
        )

    alias = EquipmentModelAlias(
        model_id=model_id,
        value=display,
        value_normalized=normalized,
        created_by_user_id=actor.id,
        created_at=datetime.now(timezone.utc),
    )
    session.add(alias)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Такое название уже добавлено.",
        )
    await session.refresh(alias)
    return alias


async def delete_alias(
    session: AsyncSession,
    model_id: int,
    alias_id: int,
    actor: User,
) -> None:
    result = await session.execute(
        select(EquipmentModelAlias).where(
            EquipmentModelAlias.id == alias_id,
            EquipmentModelAlias.model_id == model_id,
        )
    )
    alias = result.scalar_one_or_none()
    if alias is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Название не найдено.",
        )
    is_admin = bool(getattr(actor, "is_admin", False))
    is_author = alias.created_by_user_id == actor.id
    if not is_admin and not is_author:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Удалить может только автор или администратор.",
        )
    await session.delete(alias)
    await session.commit()
