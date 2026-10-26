from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked


class PlanningScenario(Tracked, Base):
    """Draft re-allocation of one shared PO-line supply. Never touches live allocations until Apply."""

    __tablename__ = "planning_scenarios"
    __table_args__ = (CheckConstraint("state IN ('draft','applied','discarded')", name="scenario_state"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    po_line_id: Mapped[str] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    state: Mapped[str] = mapped_column(String(16), default="draft")
    owner: Mapped[str] = mapped_column(String(80))
    # Versions of the rows the draft was based on: {"po_line": v, "inventory": {id: v}, ...}
    baseline: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScenarioAllocation(Tracked, Base):
    __tablename__ = "scenario_allocations"
    __table_args__ = (
        CheckConstraint("available_qty >= 0 AND incoming_qty >= 0", name="scenario_alloc_nonneg"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("planning_scenarios.id"), index=True)
    work_order_item_id: Mapped[str] = mapped_column(ForeignKey("work_order_items.id"))
    # Proposed quantity from units already accepted (available) vs. still incoming on the PO line.
    available_qty: Mapped[int] = mapped_column(Integer, default=0)
    incoming_qty: Mapped[int] = mapped_column(Integer, default=0)
    claimed_qty: Mapped[int] = mapped_column(Integer, default=0)
