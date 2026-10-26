from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked


class Receipt(Tracked, Base):
    __tablename__ = "receipts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    shipment_id: Mapped[str | None] = mapped_column(ForeignKey("shipments.id"))
    received_by: Mapped[str] = mapped_column(String(80))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReceiptLine(Tracked, Base):
    __tablename__ = "receipt_lines"
    __table_args__ = (CheckConstraint("qty > 0", name="receipt_line_qty_pos"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    receipt_id: Mapped[str] = mapped_column(ForeignKey("receipts.id"), index=True)
    po_line_id: Mapped[str] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    shipment_line_id: Mapped[str | None] = mapped_column(ForeignKey("shipment_lines.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)
    lot: Mapped[str | None] = mapped_column(String(60))


class QABatch(Tracked, Base):
    __tablename__ = "qa_batches"
    __table_args__ = (
        CheckConstraint("status IN ('pending','completed')", name="qa_status"),
        CheckConstraint("input_qty > 0", name="qa_input_pos"),
        CheckConstraint(
            "status <> 'completed' OR (accepted_qty >= 0 AND rejected_qty >= 0 "
            "AND accepted_qty + rejected_qty = input_qty)",
            name="qa_balances",
        ),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    receipt_line_id: Mapped[str] = mapped_column(ForeignKey("receipt_lines.id"), index=True)
    input_qty: Mapped[int] = mapped_column(Integer)
    accepted_qty: Mapped[int | None] = mapped_column(Integer)
    rejected_qty: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    inspector: Mapped[str | None] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TransferLine(Tracked, Base):
    __tablename__ = "transfer_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="transfer_qty_pos"),
        CheckConstraint("status IN ('planned','in_transit','received','canceled')", name="transfer_status"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"))
    qty: Mapped[int] = mapped_column(Integer)
    source_warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    dest_warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(16), default="planned")
    expected_arrival: Mapped[date | None] = mapped_column(Date)
    arrival_channel: Mapped[str] = mapped_column(String(20), default="manual")
    arrival_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryRecord(Tracked, Base):
    """Physical units at one location in one quality state and warehouse stage.

    Records split when part of the quantity changes state; quantity is never duplicated.
    """

    __tablename__ = "inventory_records"
    __table_args__ = (
        CheckConstraint("qty >= 0", name="inv_qty_nonneg"),
        CheckConstraint("quality_state IN ('pending','accepted','scrapped')", name="inv_quality"),
        CheckConstraint("stage IN ('received','stored','picked','staged')", name="inv_stage"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"), index=True)
    warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"), index=True)
    location: Mapped[str] = mapped_column(String(40))
    lot: Mapped[str | None] = mapped_column(String(60))
    qty: Mapped[int] = mapped_column(Integer)
    quality_state: Mapped[str] = mapped_column(String(16))
    stage: Mapped[str] = mapped_column(String(16))
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("inventory_records.id"))
    receipt_line_id: Mapped[str | None] = mapped_column(ForeignKey("receipt_lines.id"))
    qa_batch_id: Mapped[str | None] = mapped_column(ForeignKey("qa_batches.id"))
    origin_po_line_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_order_lines.id"))
    # Received units still backing their PO line's commitments, awaiting handoff to
    # specific work-order allocations. Never carries allocations itself.
    pool_po_line_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    # Source units reserved for an outbound transfer; the transfer line represents them.
    reserved_transfer_line_id: Mapped[str | None] = mapped_column(ForeignKey("transfer_lines.id"))
    origin_transfer_line_id: Mapped[str | None] = mapped_column(ForeignKey("transfer_lines.id"))
    received_on: Mapped[date | None] = mapped_column(Date)
