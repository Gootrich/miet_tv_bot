"""roles: scopes JSONB + head roles (miettv_head, infocus_head)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "roles",
        sa.Column(
            "scopes", JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    # admin = superadmin
    op.execute(
        "UPDATE roles SET scopes = '[\"admin:super\"]'::jsonb WHERE code = 'admin'"
    )

    # Роли глав клубов. Только права на заявки своего клуба.
    # Членство в клубе (photographer/videographer) выдаётся отдельно и независимо.
    op.execute(
        "INSERT INTO roles (code, name, scopes) VALUES "
        "('miettv_head', 'Глава МИЭТ-ТВ', '[\"admin:registrations:photographer\"]'::jsonb), "
        "('infocus_head', 'Глава InFocus', '[\"admin:registrations:videographer\"]'::jsonb) "
        "ON CONFLICT (code) DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM roles WHERE code IN ('miettv_head','infocus_head')")
    op.drop_column("roles", "scopes")
