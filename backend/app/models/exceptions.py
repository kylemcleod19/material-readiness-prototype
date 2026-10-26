from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked

EXCEPTION_TYPES = (
    "qa_rejection",
    "supply_deficit",
    "over_receipt",
    "unmatched_receipt",
    "picking_discrepancy",
    "demand_change",
)


class MaterialException(Tracked, Base):
    """One source-level issue. Shared deficits link affected requirements; no losing order is invented."""

    __tablename__ = "material_exceptions"
    __table_args__ = (
        CheckConstraint("state IN ('open','acknowledged','closed')", name="exc_state"),
        CheckConstraint("affected_qty >= 0", name="exc_qty_nonneg"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    type: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(16), default="open")
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[str] = mapped_column(String(40))
    part_id: Mapped[str | None] = mapped_column(ForeignKey("parts.id"))
    affected_qty: Mapped[int] = mapped_column(Integer, default=0)
    # Blocking exceptions keep a linked work order from being ready.
    blocking: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_role: Mapped[str] = mapped_column(String(30))
    raised_by: Mapped[str] = mapped_column(String(80))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MaterialExceptionLink(Tracked, Base):
    __tablename__ = "material_exception_links"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    exception_id: Mapped[str] = mapped_column(ForeignKey("material_exceptions.id"), index=True)
    work_order_item_id: Mapped[str] = mapped_column(ForeignKey("work_order_items.id"), index=True)
    claimed_qty: Mapped[int | None] = mapped_column(Integer)
