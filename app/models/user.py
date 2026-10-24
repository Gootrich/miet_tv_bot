from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    """Пользователь системы бронирования."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)

    telegram_id: Mapped[int] = mapped_column(
        BigInteger,
        unique=True,
        nullable=False,
    )

    full_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    username: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    roles: Mapped[list["UserRole"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Role(Base):
    """Роль пользователя."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)

    code: Mapped[str] = mapped_column(
        String(32),
        unique=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
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

    user: Mapped["User"] = relationship(
        back_populates="roles",
    )

    role: Mapped["Role"] = relationship(
        back_populates="users",
    )
