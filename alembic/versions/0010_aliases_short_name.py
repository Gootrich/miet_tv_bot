"""short_name + equipment_model_aliases

Revision ID: 0010_aliases_short_name
Revises: 0009_model_image
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_aliases_short_name"
down_revision = "0009_model_image"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_models",
        sa.Column("short_name", sa.String(length=60), nullable=True),
    )
    op.create_table(
        "equipment_model_aliases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "model_id", sa.Integer(),
            sa.ForeignKey("equipment_models.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("value", sa.String(length=120), nullable=False),
        sa.Column("value_normalized", sa.String(length=120), nullable=False),
        sa.Column(
            "created_by_user_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "model_id", "value_normalized",
            name="uq_model_alias_normalized",
        ),
    )
    op.create_index(
        "ix_equipment_model_aliases_model_id",
        "equipment_model_aliases", ["model_id"],
    )
    op.create_index(
        "ix_equipment_model_aliases_value_normalized",
        "equipment_model_aliases", ["value_normalized"],
    )


def downgrade() -> None:
    op.drop_index("ix_equipment_model_aliases_value_normalized", table_name="equipment_model_aliases")
    op.drop_index("ix_equipment_model_aliases_model_id", table_name="equipment_model_aliases")
    op.drop_table("equipment_model_aliases")
    op.drop_column("equipment_models", "short_name")
