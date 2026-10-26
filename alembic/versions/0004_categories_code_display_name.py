"""categories: add code (slug), move slug to code, name -> Russian display

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# slug (текущее categories.name) -> человекочитаемое имя
DISPLAY_NAMES = {
    "cameras":     "Камеры",
    "lenses":      "Оптика",
    "stabilizers": "Крепления",
    "lighting":    "Свет",
    "audio":       "Звук",
    "stands":      "Стойки",
    "power":       "Питание",
    "studio":      "Студия",
}


def upgrade() -> None:
    # 1. Добавляем колонку code (пока nullable)
    op.add_column("categories", sa.Column("code", sa.String(length=32), nullable=True))

    # 2. Переносим текущее name в code: slug остаётся slug'ом
    op.execute("UPDATE categories SET code = name")

    # 3. Обновляем name на русские имена по code
    for slug, display in DISPLAY_NAMES.items():
        op.execute(
            sa.text("UPDATE categories SET name = :name WHERE code = :code")
            .bindparams(name=display, code=slug)
        )

    # 4. После переноса — code NOT NULL + unique
    op.alter_column("categories", "code", nullable=False)
    op.create_unique_constraint("uq_categories_code", "categories", ["code"])


def downgrade() -> None:
    # Обратный перенос: name вернуть в slug (по code), удалить code
    op.execute("UPDATE categories SET name = code")
    op.drop_constraint("uq_categories_code", "categories", type_="unique")
    op.drop_column("categories", "code")
