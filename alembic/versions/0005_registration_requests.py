"""registration_requests: independent club applications

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "registration_requests",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("club_code", sa.String(length=32), nullable=False),
        sa.Column(
            "status", sa.String(length=20),
            nullable=False, server_default="pending",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.text("now()"),
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected','cancelled')",
            name="ck_registration_requests_valid_status",
        ),
        sa.CheckConstraint(
            "club_code IN ('photographer','videographer')",
            name="ck_registration_requests_valid_club",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name="fk_registration_requests_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by_id"], ["users.id"],
            name="fk_registration_requests_decided_by_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_registration_requests"),
    )
    op.create_index(
        "ix_registration_requests_user_id",
        "registration_requests", ["user_id"],
    )
    op.create_index(
        "ix_registration_requests_status_club",
        "registration_requests", ["status", "club_code"],
    )
    # Один pending на (user, club). Частичный уникальный индекс.
    op.execute(
        "CREATE UNIQUE INDEX uq_registration_requests_one_pending "
        "ON registration_requests (user_id, club_code) "
        "WHERE status = 'pending'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_registration_requests_one_pending")
    op.drop_index("ix_registration_requests_status_club", table_name="registration_requests")
    op.drop_index("ix_registration_requests_user_id", table_name="registration_requests")
    op.drop_table("registration_requests")
