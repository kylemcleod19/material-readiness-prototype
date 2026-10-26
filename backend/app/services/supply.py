"""Database-backed quantity lookups for services working inside a transaction."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ACTIVE_STATES,
    Allocation,
    InventoryRecord,
    PurchaseOrderLine,
    ReceiptLine,
    Shipment,
    ShipmentLine,
    TransferLine,
)
from app.services.quantities import LineQuantities, line_quantities


def _sum(db: Session, stmt) -> int:
    return int(db.scalar(stmt) or 0)


def allocated_to_inventory(db: Session, record_id: str) -> int:
    return _sum(
        db,
        select(func.sum(Allocation.qty)).where(
            Allocation.inventory_record_id == record_id, Allocation.state.in_(ACTIVE_STATES)
        ),
    )


def allocated_to_transfer(db: Session, transfer_id: str) -> int:
    return _sum(
        db,
        select(func.sum(Allocation.qty)).where(
            Allocation.transfer_line_id == transfer_id, Allocation.state.in_(ACTIVE_STATES)
        ),
    )


def allocated_to_item(db: Session, item_id: str) -> int:
    return _sum(
        db,
        select(func.sum(Allocation.qty)).where(
            Allocation.work_order_item_id == item_id, Allocation.state.in_(ACTIVE_STATES)
        ),
    )


def received_against_shipment_line(db: Session, shipment_line_id: str) -> int:
    return _sum(db, select(func.sum(ReceiptLine.qty)).where(ReceiptLine.shipment_line_id == shipment_line_id))


def po_line_quantities(db: Session, line: PurchaseOrderLine) -> LineQuantities:
    received = _sum(db, select(func.sum(ReceiptLine.qty)).where(ReceiptLine.po_line_id == line.id))
    open_shipments = []
    rows = db.execute(
        select(ShipmentLine, Shipment)
        .join(Shipment, Shipment.id == ShipmentLine.shipment_id)
        .where(ShipmentLine.po_line_id == line.id)
        .order_by(Shipment.expected_arrival.nulls_last(), Shipment.id)
    ).all()
    for sl, sh in rows:
        open_qty = sl.qty - received_against_shipment_line(db, sl.id)
        open_shipments.append((open_qty, sh.expected_arrival, sh.number))
    pooled = [
        (r.qty, r.quality_state)
        for r in db.scalars(select(InventoryRecord).where(InventoryRecord.pool_po_line_id == line.id))
    ]
    claims = _sum(
        db,
        select(func.sum(Allocation.qty)).where(
            Allocation.po_line_id == line.id, Allocation.state.in_(ACTIVE_STATES)
        ),
    )
    return line_quantities(
        ordered=line.ordered_qty,
        canceled=line.canceled_qty,
        shortfall=line.closed_shortfall_qty,
        expected_arrival=line.expected_arrival,
        received=received,
        open_shipments=open_shipments,
        pooled=pooled,
        claims=claims,
    )


def eligible_free_stock_filter():
    """Accepted, unstaged, unpooled, not reserved for a transfer: the only stock that can be reserved."""
    return (
        InventoryRecord.quality_state == "accepted",
        InventoryRecord.stage.in_(("received", "stored")),
        InventoryRecord.pool_po_line_id.is_(None),
        InventoryRecord.reserved_transfer_line_id.is_(None),
        InventoryRecord.qty > 0,
    )


def transfer_open(t: TransferLine) -> bool:
    return t.status in ("planned", "in_transit")
