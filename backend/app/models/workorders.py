from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked


class WorkOrder(Tracked, Base):
    __tablename__ = "work_orders"
    __table_args__ = (CheckConstraint("state IN ('draft','finalized','canceled')", name="wo_state"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"))
    warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    build_qty: Mapped[int] = mapped_column(Integer, default=1)
    production_start_date: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(16), default="draft")
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)


class WorkOrderItem(Tracked, Base):
    __tablename__ = "work_order_items"
    __table_args__ = (CheckConstraint("required_qty >= 0", name="woi_required_nonneg"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    work_order_id: Mapped[str] = mapped_column(ForeignKey("work_orders.id"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"), index=True)
    required_qty: Mapped[int] = mapped_column(Integer)


class FixtureRequirement(Tracked, Base):
    """Reusable resource requirement. Reviewed manually by purchasing; never auto-reserved."""

    __tablename__ = "fixture_requirements"
    __table_args__ = (
        CheckConstraint("coverage_state IN ('pending','covered','action_needed')", name="fixture_state"),
        CheckConstraint("quantity > 0", name="fixture_qty_pos"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    work_order_id: Mapped[str] = mapped_column(ForeignKey("work_orders.id"), index=True)
    operation: Mapped[str] = mapped_column(String(80))
    fixture_type: Mapped[str] = mapped_column(String(120))
    quantity: Mapped[int] = mapped_column(Integer)
    coverage_state: Mapped[str] = mapped_column(String(20), default="pending")
    note: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[str | None] = mapped_column(String(80))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
