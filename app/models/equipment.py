from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Category(Base):
    """Категория оборудования."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    models: Mapped[list["EquipmentModel"]] = relationship(
        back_populates="category",
        order_by="EquipmentModel.name",
    )


class EquipmentModel(Base):
    """Модель оборудования в каталоге."""

    __tablename__ = "equipment_models"

    __table_args__ = (
        CheckConstraint(
            "access_policy IN ('all', 'photographer', 'videographer')",
            name="valid_access_policy",
        ),
        CheckConstraint(
            "tracking_type IN ('individual', 'quantity')",
            name="valid_tracking_type",
        ),
        CheckConstraint(
            "tracking_type = 'individual' OR total_quantity >= 0",
            name="valid_total_quantity",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    manufacturer: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    access_policy: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="all",
        server_default="all",
    )

    tracking_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="individual",
        server_default="individual",
    )

    total_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    category: Mapped["Category"] = relationship(
        back_populates="models",
    )

    items: Mapped[list["EquipmentItem"]] = relationship(
        back_populates="model",
    )


class EquipmentItem(Base):
    """Конкретный физический экземпляр оборудования."""

    __tablename__ = "equipment_items"

    __table_args__ = (
        UniqueConstraint(
            "inventory_number",
            name="unique_inventory_number",
        ),
        CheckConstraint(
            "status IN ('active', 'maintenance', 'retired')",
            name="valid_item_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    model_id: Mapped[int] = mapped_column(
        ForeignKey("equipment_models.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    inventory_number: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    serial_number: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="active",
        server_default="active",
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    model: Mapped["EquipmentModel"] = relationship(
        back_populates="items",
    )
