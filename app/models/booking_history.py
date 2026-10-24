from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class BookingHistory(Base):
    """История событий конкретного бронирования."""

    __tablename__ = "booking_history"

    id: Mapped[int] = mapped_column(primary_key=True)

    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    details: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    booking: Mapped["Booking"] = relationship()

    actor: Mapped["User | None"] = relationship()
