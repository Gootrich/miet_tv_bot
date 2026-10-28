"""model image_filename

Revision ID: 0009_model_image
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_model_image"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_models",
        sa.Column("image_filename", sa.String(length=80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("equipment_models", "image_filename")
