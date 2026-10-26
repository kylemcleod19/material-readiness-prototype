from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked

ACTIVE_STATES = ("committed", "remote_hold")


class Allocation(Tracked, Base):
    """A quantity of one supply source committed (or provisionally held) for one requirement."""

    __tablename__ = "allocations"
    __table_args__ = (
        CheckConstraint("qty >= 0", name="alloc_qty_nonneg"),
        CheckConstraint("state IN ('remote_hold','committed','released')", name="alloc_state"),
        CheckConstraint(
            "(po_line_id IS NOT NULL)::int + (inventory_record_id IS NOT NULL)::int"
            " + (transfer_line_id IS NOT NULL)::int = 1",
            name="alloc_exactly_one_source",
        ),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    work_order_item_id: Mapped[str] = mapped_column(ForeignKey("work_order_items.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16))
    # Claim on shared supply that no longer covers every commitment; needs a manual decision.
    review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    po_line_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    inventory_record_id: Mapped[str | None] = mapped_column(ForeignKey("inventory_records.id"), index=True)
    transfer_line_id: Mapped[str | None] = mapped_column(ForeignKey("transfer_lines.id"), index=True)
    predecessor_id: Mapped[str | None] = mapped_column(ForeignKey("allocations.id"))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_reason: Mapped[str | None] = mapped_column(Text)

    @property
    def source_type(self) -> str:
        if self.po_line_id:
            return "po_line"
        if self.transfer_line_id:
            return "transfer_line"
        return "inventory"

    @property
    def source_id(self) -> str:
        return self.po_line_id or self.transfer_line_id or self.inventory_record_id
