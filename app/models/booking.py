from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Booking(Base):
    """Бронирование конкретного экземпляра оборудования."""

    __tablename__ = "bookings"

    __table_args__ = (
        CheckConstraint(
            "planned_end > planned_start",
            name="valid_planned_interval",
        ),
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'cancelled', 'completed')",
            name="valid_booking_status",
        ),
        CheckConstraint(
            "actual_return IS NULL OR actual_checkout IS NOT NULL",
            name="return_requires_checkout",
        ),
        CheckConstraint(
            "actual_return IS NULL OR actual_return >= actual_checkout",
            name="valid_actual_interval",
        ),
        # Шаг времени 15 минут: границы кратны 15 мин, секунд нет.
        CheckConstraint(
            "mod(EXTRACT(MINUTE FROM planned_start AT TIME ZONE 'UTC')::int, 15) = 0 "
            "AND mod(EXTRACT(MINUTE FROM planned_end AT TIME ZONE 'UTC')::int, 15) = 0 "
            "AND EXTRACT(SECOND FROM planned_start AT TIME ZONE 'UTC') = 0 "
            "AND EXTRACT(SECOND FROM planned_end AT TIME ZONE 'UTC') = 0",
            name="planned_time_step_15min",
        ),
        Index("ix_bookings_item_status", "item_id", "status"),
        Index("ix_bookings_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    item_id: Mapped[int] = mapped_column(
        ForeignKey("equipment_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    planned_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    planned_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    actual_checkout: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    actual_return: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )

    comment: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    item: Mapped["EquipmentItem"] = relationship()

    user: Mapped["User"] = relationship()
