from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


USER_STATUSES = ("pending", "active", "blocked", "rejected")

# Настройки загрузки связей: всегда тянем роль вместе с user_role,
# иначе has_role/is_admin упадут в async-контексте с MissingGreenlet.
_USER_ROLES_LOAD = "selectin"


class User(Base):
    """Пользователь системы бронирования."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'active', 'blocked', 'rejected')",
            name="valid_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        unique=True,
        nullable=False,
    )

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )

    blocked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    requested_role_code: Mapped[str | None] = mapped_column(
        String(32), nullable=True,
    )
    approved_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # selectin + selectin(UserRole.role) — грузит UserRole и Role вместе,
    # не оставляя ленивых загрузок для has_role/is_admin.
    roles: Mapped[list["UserRole"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def role_codes(self) -> list[str]:
        return [ur.role.code for ur in self.roles if ur.role is not None]

    def has_role(self, code: str) -> bool:
        return any(ur.role is not None and ur.role.code == code for ur in self.roles)

    def has_scope(self, scope: str) -> bool:
        """True, если у пользователя есть admin:super или указанный scope."""
        for ur in self.roles:
            if ur.role is None:
                continue
            scopes = ur.role.scopes or []
            if "admin:super" in scopes:
                return True
            if scope in scopes:
                return True
        return False

    @property
    def scopes(self) -> set[str]:
        result: set[str] = set()
        for ur in self.roles:
            if ur.role and ur.role.scopes:
                result.update(ur.role.scopes)
        return result

    @property
    def is_admin(self) -> bool:
        return self.has_role("admin")

    @property
    def is_blocked(self) -> bool:
        return self.status == "blocked"

    @property
    def is_pending(self) -> bool:
        return self.status == "pending"


class Role(Base):
    """Роль пользователя."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]",
    )

    users: Mapped[list["UserRole"]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
    )


class UserRole(Base):
    """Связь пользователя с ролью."""

    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"),
        primary_key=True,
    )

    user: Mapped["User"] = relationship(back_populates="roles")
    # Вот это ключевое: без selectin здесь .role подгружается лениво.
    role: Mapped["Role"] = relationship(back_populates="users", lazy="selectin")


class RegistrationRequest(Base):
    """Заявка пользователя на вступление в клуб.

    Одна запись = одна независимая заявка. Если пользователь выбрал оба
    клуба — создаются две записи (photographer, videographer), каждая
    проходит approve/reject независимо.
    """

    __tablename__ = "registration_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','approved','rejected','cancelled')",
            name="valid_status",
        ),
        CheckConstraint(
            "club_code IN ('photographer','videographer')",
            name="valid_club",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    club_code: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
