"""Pydantic-схемы ответов API каталога.

Схемы описывают безопасный публичный формат ответов и не являются
ORM-моделями. Внутренние поля (например, telegram_id) сюда не попадают.
"""

from pydantic import BaseModel, ConfigDict, Field


class EquipmentItemOut(BaseModel):
    """Физический экземпляр оборудования."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    inventory_number: str
    serial_number: str | None = None
    status: str = Field(description="active | maintenance | retired")
    notes: str | None = None


class EquipmentModelOut(BaseModel):
    """Модель оборудования в каталоге (краткий вид)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    name: str
    manufacturer: str | None = None
    description: str | None = None
    access_policy: str = Field(
        description="all | photographer | videographer",
    )


class EquipmentModelDetailOut(EquipmentModelOut):
    """Модель оборудования с физическими экземплярами."""

    items: list[EquipmentItemOut] = Field(default_factory=list)


class CategoryWithModelsOut(BaseModel):
    """Категория вместе со списком моделей."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    models: list[EquipmentModelOut] = Field(default_factory=list)


class HealthOut(BaseModel):
    """Ответ health-check."""

    status: str
    database: str
