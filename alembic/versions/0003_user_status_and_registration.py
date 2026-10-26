"""user status, registration workflow and admin bootstrap

Revision ID: 0003
Revises: e2bfebbe1bce
Create Date: 2026-10-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "e2bfebbe1bce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Новые поля. server_default='pending' безопасен: существующие пользователи
    # явно переводятся в 'active'/'blocked' апдейтом ниже по is_active.
    op.add_column(
        "users",
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "users",
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("users", sa.Column("block_reason", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column("requested_role_code", sa.String(length=32), nullable=True),
    )
    op.add_column("users", sa.Column("approved_by_id", sa.Integer(), nullable=True))
    op.add_column(
        "users",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_check_constraint(
        "ck_users_valid_status",
        "users",
        "status IN ('pending', 'active', 'blocked', 'rejected')",
    )
    op.create_foreign_key(
        "fk_users_approved_by_id_users",
        "users",
        "users",
        ["approved_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_status", "users", ["status"], unique=False)

    # Базовый набор ролей. Существующие (если были) не трогаем.
    op.execute(
        "INSERT INTO roles (code, name) VALUES "
        "('admin', 'Администратор'), "
        "('photographer', 'Фотограф'), "
        "('videographer', 'Видеограф'), "
        "('universal', 'Универсал') "
        "ON CONFLICT (code) DO NOTHING"
    )

    # Сохранить текущее состояние: активные остаются активными,
    # всё, что было деактивировано, — блокируется без срока.
    op.execute(
        "UPDATE users "
        "SET status = CASE WHEN is_active THEN 'active' ELSE 'blocked' END"
    )


def downgrade() -> None:
    op.drop_index("ix_users_status", table_name="users")
    op.drop_constraint("fk_users_approved_by_id_users", "users", type_="foreignkey")
    op.drop_constraint("ck_users_valid_status", "users", type_="check")
    op.drop_column("users", "approved_at")
    op.drop_column("users", "approved_by_id")
    op.drop_column("users", "requested_role_code")
    op.drop_column("users", "block_reason")
    op.drop_column("users", "blocked_until")
    op.drop_column("users", "status")
