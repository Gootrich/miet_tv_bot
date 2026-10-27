from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import verify_telegram_init_data
from app.db.session import get_session
from app.models.user import User, UserRole
from app.services.users import (
    assign_role,
    ensure_admin_bootstrap,
    get_or_create_user,
    reload_with_roles,
)


def _user_with_roles_stmt(where_clause):
    return (
        select(User)
        .options(selectinload(User.roles).selectinload(UserRole.role))
        .where(where_clause)
    )


async def get_current_user(
    x_telegram_init_data: str | None = Header(
        None, description="Telegram WebApp initData"
    ),
    x_dev_user: str | None = Header(
        None, description="Dev: выбор роли (superadmin|miettv_head|...)"
    ),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Аутентификация через Telegram initData либо dev-mode (только при DEBUG=true)."""

    # ---------- dev-mode ----------
    if not x_telegram_init_data or x_telegram_init_data == "dev-mode":
        if not settings.allow_dev_mode:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Требуется авторизация через Telegram.",
            )

        # X-Dev-User — выбор конкретного dev-пользователя.
        # Если не передан — используем дефолтного суперадмина 123456789.
        dev_role = (x_dev_user or "").strip().lower() or "superadmin"

        DEV_PRESETS: dict[str, dict] = {
            "superadmin": dict(
                telegram_id=123456789,
                full_name="Dev Superadmin",
                username="dev_superadmin",
                roles=("admin",),
            ),
            "miettv_head": dict(
                telegram_id=900000001,
                full_name="Dev Глава МИЭТ-ТВ",
                username="dev_miettv_head",
                roles=("videographer", "miettv_head"),
            ),
            "infocus_head": dict(
                telegram_id=900000002,
                full_name="Dev Глава InFocus",
                username="dev_infocus_head",
                roles=("photographer", "infocus_head"),
            ),
            "photographer": dict(
                telegram_id=900000003,
                full_name="Dev Фотограф (InFocus)",
                username="dev_photographer",
                roles=("photographer",),
            ),
            "videographer": dict(
                telegram_id=900000004,
                full_name="Dev Видеограф (МИЭТ-ТВ)",
                username="dev_videographer",
                roles=("videographer",),
            ),
            "both": dict(
                telegram_id=900000005,
                full_name="Dev Обе роли",
                username="dev_both",
                roles=("photographer", "videographer"),
            ),
            "pending": dict(
                telegram_id=900000006,
                full_name="Dev Pending User",
                username="dev_pending",
                roles=(),
            ),
            "blocked": dict(
                telegram_id=900000007,
                full_name="Dev Blocked User",
                username="dev_blocked",
                roles=(),
            ),
        }

        preset = DEV_PRESETS.get(dev_role)
        if preset is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Неизвестная dev-роль: {dev_role}",
            )

        result = await session.execute(
            _user_with_roles_stmt(User.telegram_id == preset["telegram_id"])
        )
        user = result.scalar_one_or_none()

        if user is None:
            user, _ = await get_or_create_user(
                session,
                telegram_id=preset["telegram_id"],
                full_name=preset["full_name"],
                username=preset["username"],
            )

        # Привести к нужному состоянию
        if dev_role == "blocked":
            user.status = "blocked"
            user.is_active = False
            user.block_reason = "Dev: заблокирован для тестирования."
        elif dev_role == "pending":
            user.status = "pending"
            user.is_active = False
            user.block_reason = None
        else:
            user.status = "active"
            user.is_active = True
            user.block_reason = None

        await session.flush()

        # --- Синхронизировать роли с preset (убрать лишние, добавить недостающие) ---
        from sqlalchemy import delete as _delete, select as _select
        from app.models.user import Role as _Role, UserRole as _UserRole

        preset_roles = set(preset["roles"])
        current_roles = set(user.role_codes())

        # Удалить лишние
        roles_to_remove = current_roles - preset_roles
        if roles_to_remove:
            role_ids_res = await session.execute(
                _select(_Role.id).where(_Role.code.in_(roles_to_remove))
            )
            role_ids = [row[0] for row in role_ids_res.all()]
            if role_ids:
                await session.execute(
                    _delete(_UserRole).where(
                        _UserRole.user_id == user.id,
                        _UserRole.role_id.in_(role_ids),
                    )
                )
                await session.flush()

        # Добавить недостающие
        for role_code in preset_roles:
            if role_code not in current_roles:
                await assign_role(session, user.id, role_code)
        await session.commit()

        fresh = await reload_with_roles(session, user.id)
        assert fresh is not None
        return fresh

    # ---------- Telegram initData ----------
    bot_token = settings.bot_token
    if not bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Токен бота не настроен на сервере.",
        )

    user_data = verify_telegram_init_data(
        x_telegram_init_data,
        bot_token,
        max_age_seconds=settings.init_data_max_age_seconds,
    )
    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный ID пользователя в Telegram данных.",
        )

    full_name = (
        f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}"
    ).strip() or "User"

    user, _created = await get_or_create_user(
        session,
        telegram_id=int(telegram_id),
        full_name=full_name,
        username=user_data.get("username"),
    )
    user = await ensure_admin_bootstrap(session, user)

    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Заявка на рассмотрении администратора.",
        )
    if user.status == "rejected":
        reason = user.block_reason or "Заявка отклонена администратором."
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Заявка отклонена: {reason}",
        )
    if user.status == "blocked":
        reason = user.block_reason or "Доступ заблокирован администратором."
        if user.blocked_until is not None:
            reason = (
                f"{reason} (до {user.blocked_until.strftime('%d.%m.%Y %H:%M UTC')})"
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=reason,
        )

    return user


async def get_optional_approved_user(
    x_telegram_init_data: str | None = Header(
        None, description="Telegram WebApp initData"
    ),
    x_dev_user: str | None = Header(
        None, description="Dev: выбор роли (superadmin|miettv_head|...)"
    ),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """Опциональная аутентификация для публичных эндпоинтов.

    Возвращает User со status='active', если initData/dev-заголовки
    валидны; иначе None. Никогда не выбрасывает 401/403: публичный
    просмотр не должен ломаться из-за отсутствия авторизации.
    """
    if not x_telegram_init_data and not x_dev_user:
        return None
    try:
        user = await get_current_user(
            x_telegram_init_data=x_telegram_init_data,
            x_dev_user=x_dev_user,
            session=session,
        )
    except HTTPException:
        return None
    if user.status != "active":
        return None
    return user


def require_scope(*scopes: str):
    """Фабрика зависимости: пропускает, если у user есть admin:super
    или хотя бы один из указанных scopes.
    """
    async def _dep(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not current_user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Требуются права администратора.",
            )
        if any(current_user.has_scope(s) for s in scopes):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав.",
        )
    return _dep


# Алиасы для удобства
require_admin = require_scope("admin:super")
require_users_admin = require_scope("admin:users")
require_registrations_photographer = require_scope("admin:registrations:photographer")
require_registrations_videographer = require_scope("admin:registrations:videographer")
require_any_registration_manager = require_scope(
    "admin:registrations:photographer",
    "admin:registrations:videographer",
)
