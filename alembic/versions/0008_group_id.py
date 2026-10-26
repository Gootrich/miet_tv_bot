"""bookings.group_id — пакетная бронь (одиночная = группа из 1)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("group_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_bookings_group",
        "bookings",
        ["group_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_bookings_group", table_name="bookings")
    op.drop_column("bookings", "group_id")
