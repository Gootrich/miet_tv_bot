from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import Role, User, UserRole
from sqlalchemy.orm import selectinload as _selectinload
from sqlalchemy.orm import selectinload


ROLE_NAMES = {
    "admin": "Администратор",
    "photographer": "Фотограф",
    "videographer": "Видеограф",
    "universal": "Универсал",
}


async def get_or_create_user(
    session: AsyncSession,
    telegram_id: int,
    full_name: str,
    username: str | None,
) -> tuple[User, bool]:
    """Upsert по telegram_id. Новые пользователи — со статусом pending."""
    stmt = (
        pg_insert(User)
        .values(
            telegram_id=telegram_id,
            full_name=full_name,
            username=username,
            status="pending",
            is_active=False,
        )
        .on_conflict_do_update(
            index_elements=[User.telegram_id],
            set_={"full_name": full_name, "username": username},
        )
        .returning(User, text("(xmax = 0) AS inserted"))
    )
    result = await session.execute(stmt)
    row = result.one()
    user: User = row[0]
    created: bool = bool(row[1])
    return user, created


async def reload_with_roles(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(
        select(User).options(selectinload(User.roles).selectinload(UserRole.role)).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def list_all_users(session: AsyncSession) -> list[User]:
    result = await session.execute(
        select(User).options(selectinload(User.roles).selectinload(UserRole.role)).order_by(User.created_at.desc())
    )
    return list(result.scalars().all())


async def list_pending_users(session: AsyncSession) -> list[User]:
    result = await session.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(UserRole.role))
        .where(User.status == "pending")
        .order_by(User.created_at.asc())
    )
    return list(result.scalars().all())


async def _ensure_role(session: AsyncSession, code: str) -> Role:
    result = await session.execute(select(Role).where(Role.code == code))
    role = result.scalar_one_or_none()
    if role is None:
        role = Role(code=code, name=ROLE_NAMES.get(code, code))
        session.add(role)
        await session.flush()
    return role


async def assign_role(session: AsyncSession, user_id: int, code: str) -> None:
    """Идемпотентно назначает роль пользователю."""
    role = await _ensure_role(session, code)
    exists = await session.execute(
        select(UserRole).where(
            UserRole.user_id == user_id, UserRole.role_id == role.id
        )
    )
    if exists.scalar_one_or_none() is None:
        session.add(UserRole(user_id=user_id, role_id=role.id))
        await session.flush()


async def approve_user(
    session: AsyncSession,
    user_id: int,
    role_codes: list[str],
    approver_id: int | None,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    if not role_codes:
        raise ValueError("Не переданы роли для одобрения.")
    user.status = "active"
    user.is_active = True
    user.approved_at = datetime.now(timezone.utc)
    user.approved_by_id = approver_id
    for code in role_codes:
        await assign_role(session, user.id, code)
    await session.flush()
    fresh = await reload_with_roles(session, user.id)
    assert fresh is not None
    return fresh


async def reject_user(
    session: AsyncSession,
    user_id: int,
    reason: str,
    approver_id: int | None,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    user.status = "rejected"
    user.is_active = False
    user.block_reason = reason or "Заявка отклонена."
    user.approved_by_id = approver_id
    user.approved_at = datetime.now(timezone.utc)
    await session.flush()
    fresh = await reload_with_roles(session, user.id)
    assert fresh is not None
    return fresh


async def block_user(
    session: AsyncSession,
    user_id: int,
    hours: int | None,
    reason: str,
) -> User:
    """hours=None → бессрочно; hours>0 → до now+hours."""
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    user.status = "blocked"
    user.is_active = False
    user.block_reason = reason or "Заблокирован администратором."
    if hours and hours > 0:
        user.blocked_until = datetime.now(timezone.utc) + timedelta(hours=hours)
    else:
        user.blocked_until = None
    await session.flush()
    fresh = await reload_with_roles(session, user.id)
    assert fresh is not None
    return fresh


async def unblock_user(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise ValueError("Пользователь не найден.")
    user.blocked_until = None
    user.block_reason = None
    # Восстанавливаем статус по истории заявок: иначе пользователь окажется
    # active без ролей, что даст доступ к каталогу в обход одобрения.
    from app.models.user import RegistrationRequest

    result = await session.execute(
        select(RegistrationRequest.status).where(
            RegistrationRequest.user_id == user_id
        )
    )
    statuses = {row[0] for row in result.all()}
    if "approved" in statuses:
        user.status = "active"
        user.is_active = True
    elif "pending" in statuses:
        user.status = "pending"
        user.is_active = False
    elif "rejected" in statuses:
        user.status = "rejected"
        user.is_active = False
    else:
        user.status = "pending"
        user.is_active = False
    await session.flush()
    fresh = await reload_with_roles(session, user.id)
    assert fresh is not None
    return fresh


async def ensure_admin_bootstrap(session: AsyncSession, user: User) -> User:
    """Если telegram_id в settings.admin_ids — переводит в active и даёт admin."""
    from app.core.config import settings

    if user.telegram_id not in settings.admin_ids:
        return user
    if user.status == "blocked":
        # Заблокированный админ не обходит блокировку через /start.
        return user
    if user.status != "active":
        user.status = "active"
        user.is_active = True
        user.approved_at = datetime.now(timezone.utc)
        await session.flush()
    await assign_role(session, user.id, "admin")
    fresh = await reload_with_roles(session, user.id)
    assert fresh is not None
    return fresh


async def find_user_by_telegram_id(session: AsyncSession, telegram_id: int) -> User | None:
    result = await session.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(UserRole.role))
        .where(User.telegram_id == telegram_id)
    )
    return result.scalar_one_or_none()
