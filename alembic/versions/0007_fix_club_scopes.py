"""fix club scopes: miettv_head->videographer, infocus_head->photographer

МИЭТ-ТВ = видеографы (videographer)
InFocus = фотографы (photographer)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-26

"""
from typing import Sequence, Union

from alembic import op


revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # miettv_head -> заявки видеографов (МИЭТ-ТВ)
    op.execute(
        "UPDATE roles SET scopes = '[\"admin:registrations:videographer\"]'::jsonb "
        "WHERE code = 'miettv_head'"
    )
    # infocus_head -> заявки фотографов (InFocus)
    op.execute(
        "UPDATE roles SET scopes = '[\"admin:registrations:photographer\"]'::jsonb "
        "WHERE code = 'infocus_head'"
    )


def downgrade() -> None:
    # Откат к «старому» (ошибочному) маппингу, чтобы миграция была обратимой
    op.execute(
        "UPDATE roles SET scopes = '[\"admin:registrations:photographer\"]'::jsonb "
        "WHERE code = 'miettv_head'"
    )
    op.execute(
        "UPDATE roles SET scopes = '[\"admin:registrations:videographer\"]'::jsonb "
        "WHERE code = 'infocus_head'"
    )
