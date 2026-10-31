import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.booking import Booking
from app.models.booking_history import BookingHistory
from app.models.equipment import EquipmentItem, EquipmentModel
from app.models.user import RegistrationRequest, Role, User, UserRole
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


# --- Полное удаление пользователя ---

logger = logging.getLogger(__name__)


class UserNotFoundError(ValueError):
    """Пользователь не найден."""


class UserDeletionBlocked(Exception):
    """Удаление запрещено правилами безопасности."""


class UserHasUnreturnedEquipment(Exception):
    """За пользователем числятся активные брони (pending/confirmed) на будущее."""


async def _count_other_active_admins(session: AsyncSession, exclude_user_id: int) -> int:
    result = await session.execute(
        select(func.count(func.distinct(User.id)))
        .select_from(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            Role.code == "admin",
            User.status == "active",
            User.id != exclude_user_id,
        )
    )
    return int(result.scalar_one())


async def _unreturned_labels(session: AsyncSession, user_id: int) -> list[str]:
    """Активные брони, за которые пользователь ещё отвечает.

    Этап 2: ответственность привязана к интервалу planned_start..planned_end.
    Блокируем удаление, если есть pending/confirmed брони с planned_end > now.
    Фактическая выдача/возврат (actual_*) больше не используется.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(Booking.quantity, EquipmentModel.name, EquipmentItem.inventory_number)
        .select_from(Booking)
        .outerjoin(EquipmentItem, EquipmentItem.id == Booking.item_id)
        .outerjoin(
            EquipmentModel,
            EquipmentModel.id == func.coalesce(Booking.model_id, EquipmentItem.model_id),
        )
        .where(
            Booking.user_id == user_id,
            Booking.status.in_(("pending", "confirmed")),
            Booking.planned_end > now,
        )
        .order_by(Booking.id)
    )
    rows = (await session.execute(stmt)).all()
    labels: list[str] = []
    for qty, name, inv in rows:
        label = name or "Позиция"
        label += f" (инв. №{inv})" if inv else f" ×{qty}"
        labels.append(label)
    return labels


async def delete_user_completely(
    session: AsyncSession,
    user_id: int,
    *,
    actor_id: int,
    force: bool = False,
) -> dict[str, int]:
    """Полностью удаляет пользователя. Коммит делает вызывающий код.

    Удаляются: сам пользователь, его роли и заявки, все его брони и история
    этих броней. События, которые он совершил над чужими бронями,
    остаются с пустым автором (actor_user_id = NULL).
    Всё выполняется в одной транзакции вызывающего кода.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise UserNotFoundError("Пользователь не найден.")

    if (
        user.has_role("admin")
        and user.status == "active"
        and await _count_other_active_admins(session, user_id) == 0
    ):
        raise UserDeletionBlocked("Нельзя удалить единственного активного администратора.")

    labels = await _unreturned_labels(session, user_id)
    if labels and not force:
        raise UserHasUnreturnedEquipment("; ".join(labels))

    no_sync = {"synchronize_session": False}

    own_bookings = select(Booking.id).where(Booking.user_id == user_id)
    hist_deleted = await session.execute(
        delete(BookingHistory)
        .where(BookingHistory.booking_id.in_(own_bookings))
        .execution_options(**no_sync)
    )
    hist_anon = await session.execute(
        update(BookingHistory)
        .where(BookingHistory.actor_user_id == user_id)
        .values(actor_user_id=None)
        .execution_options(**no_sync)
    )
    bookings_deleted = await session.execute(
        delete(Booking).where(Booking.user_id == user_id).execution_options(**no_sync)
    )
    await session.execute(
        update(User)
        .where(User.approved_by_id == user_id)
        .values(approved_by_id=None)
        .execution_options(**no_sync)
    )
    await session.execute(
        update(RegistrationRequest)
        .where(RegistrationRequest.decided_by_id == user_id)
        .values(decided_by_id=None)
        .execution_options(**no_sync)
    )
    await session.execute(
        delete(RegistrationRequest)
        .where(RegistrationRequest.user_id == user_id)
        .execution_options(**no_sync)
    )
    await session.execute(
        delete(UserRole).where(UserRole.user_id == user_id).execution_options(**no_sync)
    )
    await session.execute(
        delete(User).where(User.id == user_id).execution_options(**no_sync)
    )
    await session.flush()

    result = {
        "deleted_user_id": user_id,
        "bookings": int(getattr(bookings_deleted, "rowcount", 0) or 0),
        "history_deleted": int(getattr(hist_deleted, "rowcount", 0) or 0),
        "history_anonymized": int(getattr(hist_anon, "rowcount", 0) or 0),
    }
    logger.warning(
        "Пользователь id=%s удалён админом id=%s (брони=%s, история удалена=%s, обезличена=%s, force=%s)",
        user_id, actor_id, result["bookings"], result["history_deleted"],
        result["history_anonymized"], force,
    )
    return result
