from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked

# Where the current expected arrival came from (basis) and how it was entered (channel).
ARRIVAL_BASES = ("supplier_promise", "carrier_estimate", "buyer_estimate")
ARRIVAL_CHANNELS = ("seed", "manual", "simulated")


class PurchaseOrder(Tracked, Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (CheckConstraint("status IN ('open','closed','canceled')", name="po_status"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id"))
    destination_warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(16), default="open")
    buyer: Mapped[str] = mapped_column(String(80))
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_note: Mapped[str | None] = mapped_column(Text)


class PurchaseOrderLine(Tracked, Base):
    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        CheckConstraint("ordered_qty > 0", name="pol_ordered_pos"),
        CheckConstraint("canceled_qty >= 0 AND closed_shortfall_qty >= 0", name="pol_nonneg"),
        CheckConstraint("canceled_qty + closed_shortfall_qty <= ordered_qty", name="pol_reconcile"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    po_id: Mapped[str] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"), index=True)
    ordered_qty: Mapped[int] = mapped_column(Integer)
    canceled_qty: Mapped[int] = mapped_column(Integer, default=0)
    # A short delivery recorded as closed rather than silently dropped.
    closed_shortfall_qty: Mapped[int] = mapped_column(Integer, default=0)
    # Current expected arrival for quantity not yet on a shipment.
    expected_arrival: Mapped[date | None] = mapped_column(Date)
    arrival_basis: Mapped[str | None] = mapped_column(String(30))
    arrival_channel: Mapped[str] = mapped_column(String(20), default="seed")
    arrival_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    supplier_promised_date: Mapped[date | None] = mapped_column(Date)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Shipment(Tracked, Base):
    __tablename__ = "shipments"
    __table_args__ = (
        CheckConstraint("status IN ('in_transit','arrived','received')", name="shipment_status"),
    )
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id"))
    destination_warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(16), default="in_transit")
    carrier: Mapped[str | None] = mapped_column(String(80))
    tracking_number: Mapped[str | None] = mapped_column(String(80))
    # Current expected arrival governs this shipment's quantities.
    expected_arrival: Mapped[date | None] = mapped_column(Date)
    arrival_basis: Mapped[str | None] = mapped_column(String(30))
    arrival_channel: Mapped[str] = mapped_column(String(20), default="seed")
    arrival_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    carrier_eta: Mapped[date | None] = mapped_column(Date)


class ShipmentLine(Tracked, Base):
    __tablename__ = "shipment_lines"
    __table_args__ = (CheckConstraint("qty > 0", name="shipment_line_qty_pos"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    shipment_id: Mapped[str] = mapped_column(ForeignKey("shipments.id"), index=True)
    po_line_id: Mapped[str] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    qty: Mapped[int] = mapped_column(Integer)


class POCheckInTask(Tracked, Base):
    """Follow-up reminder. Its due date is independent of any arrival date."""

    __tablename__ = "po_checkin_tasks"
    __table_args__ = (CheckConstraint("state IN ('open','completed')", name="checkin_state"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    po_id: Mapped[str] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    po_line_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_order_lines.id"))
    due_date: Mapped[date] = mapped_column(Date)
    owner: Mapped[str] = mapped_column(String(80))
    note: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), default="open")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(Text)
