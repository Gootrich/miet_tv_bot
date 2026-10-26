"""Логика заявок на вступление в клубы (registration_requests).

Одна заявка — один (user_id, club_code). Если пользователь выбрал оба
клуба, у него две независимые заявки. Approve/reject каждой независимы.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import RegistrationRequest, User, UserRole

VALID_CLUBS = ("photographer", "videographer")


async def list_pending_for_user(
    session: AsyncSession, user_id: int
) -> list[RegistrationRequest]:
    result = await session.execute(
        select(RegistrationRequest)
        .where(
            RegistrationRequest.user_id == user_id,
            RegistrationRequest.status == "pending",
        )
    )
    return list(result.scalars().all())


async def list_all_for_user(
    session: AsyncSession, user_id: int
) -> list[RegistrationRequest]:
    result = await session.execute(
        select(RegistrationRequest)
        .where(RegistrationRequest.user_id == user_id)
        .order_by(RegistrationRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def sync_requests(
    session: AsyncSession, user_id: int, club_codes: set[str]
) -> list[RegistrationRequest]:
    """Приводит набор pending-заявок к указанному.

    - Клубы, которых нет в club_codes — pending-заявки удаляются (cancel).
    - Клубы, которых нет в pending — создаются новые pending.
    - Уже approved/rejected/cancelled заявки НЕ трогаются.
    """
    club_codes = {c for c in club_codes if c in VALID_CLUBS}

    existing = await list_pending_for_user(session, user_id)
    by_club = {r.club_code: r for r in existing}

    # 1. Отменить pending, которых больше нет в выборе
    for club, req in by_club.items():
        if club not in club_codes:
            req.status = "cancelled"
            req.updated_at = datetime.now(timezone.utc)
            req.decision_reason = "Отменено пользователем при редактировании."

    # 2. Создать новые pending, которых нет
    created: list[RegistrationRequest] = []
    for club in club_codes:
        if club not in by_club:
            req = RegistrationRequest(
                user_id=user_id, club_code=club, status="pending",
            )
            session.add(req)
            created.append(req)

    await session.flush()

    # Возвращаем актуальный pending-набор
    return await list_pending_for_user(session, user_id)


async def cancel_pending(session: AsyncSession, user_id: int) -> None:
    """Отменить все pending-заявки пользователя. Одобренные не трогаем."""
    now = datetime.now(timezone.utc)
    for req in await list_pending_for_user(session, user_id):
        req.status = "cancelled"
        req.updated_at = now
        req.decision_reason = "Отменено пользователем."
    await session.flush()


async def recompute_user_status(session: AsyncSession, user_id: int) -> User:
    """Пересчитать users.status по заявкам.

    - Если есть хотя бы одна approved → active.
    - Иначе если есть pending → pending.
    - Иначе если есть rejected → rejected.
    - Иначе — оставить как есть (не должно случаться, но на всякий случай).
    """
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")

    result = await session.execute(
        select(RegistrationRequest)
        .where(RegistrationRequest.user_id == user_id)
    )
    reqs = list(result.scalars().all())
    statuses = [r.status for r in reqs]

    if "approved" in statuses:
        user.status = "active"
        user.is_active = True
    elif "pending" in statuses:
        user.status = "pending"
        user.is_active = False
    elif "rejected" in statuses:
        user.status = "rejected"
        user.is_active = False

    await session.flush()
    return user


async def approve_request(
    session: AsyncSession,
    request_id: int,
    approver_id: int | None,
) -> RegistrationRequest:
    """Одобрить заявку, выдать роль, пересчитать статус пользователя."""
    req = await session.get(RegistrationRequest, request_id)
    if req is None:
        raise ValueError("Заявка не найдена.")
    if req.status != "pending":
        raise ValueError(f"Заявка уже в статусе '{req.status}'.")

    now = datetime.now(timezone.utc)
    req.status = "approved"
    req.decided_at = now
    req.updated_at = now
    req.decided_by_id = approver_id

    # Выдать роль, если её ещё нет
    await _assign_role_if_missing(session, req.user_id, req.club_code)
    await session.flush()

    await recompute_user_status(session, req.user_id)
    return req


async def reject_request(
    session: AsyncSession,
    request_id: int,
    approver_id: int | None,
    reason: str = "",
) -> RegistrationRequest:
    req = await session.get(RegistrationRequest, request_id)
    if req is None:
        raise ValueError("Заявка не найдена.")
    if req.status != "pending":
        raise ValueError(f"Заявка уже в статусе '{req.status}'.")

    now = datetime.now(timezone.utc)
    req.status = "rejected"
    req.decided_at = now
    req.updated_at = now
    req.decided_by_id = approver_id
    req.decision_reason = reason or "Заявка отклонена администратором."
    await session.flush()

    await recompute_user_status(session, req.user_id)
    return req


async def _assign_role_if_missing(
    session: AsyncSession, user_id: int, role_code: str
) -> None:
    from app.services.users import assign_role
    await assign_role(session, user_id, role_code)
