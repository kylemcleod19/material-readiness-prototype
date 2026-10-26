"""Purchase orders, arrival information, shipments, and check-in tasks.

Manual entry and the simulated supplier/carrier feed call the same functions; only the
actor's channel differs, and it is stored with each arrival update.
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import clock
from app.models import (
    ARRIVAL_BASES,
    POCheckInTask,
    PurchaseOrder,
    PurchaseOrderLine,
    Shipment,
    ShipmentLine,
    new_id,
)
from app.services import allocations as alloc_service
from app.services import exceptions as exc_service
from app.services import history
from app.services.common import Actor, DomainError, get_or_404, lock
from app.services.supply import po_line_quantities, received_against_shipment_line
from app.services.warehouse import reconcile_line

ARRIVAL_FIELDS = ("expected_arrival", "arrival_basis", "arrival_channel")


def create_po(db: Session, actor: Actor, *, supplier_id: str, destination_warehouse_id: str, lines: list[dict],
              number: str | None = None, po_id: str | None = None, op_id=None) -> dict:
    """Create a PO; each line may carry allocations to several work-order items.

    Any quantity not allocated stays on the line as general-stock supply.
    """
    if not lines:
        raise DomainError("A PO needs at least one line")
    if number is None:
        count = db.scalar(select(func.count()).select_from(PurchaseOrder)) or 0
        number = f"PO-{6001 + count}"
    po = PurchaseOrder(id=po_id or new_id("po"), number=number, supplier_id=supplier_id,
                       destination_warehouse_id=destination_warehouse_id, status="open", buyer=actor.name)
    db.add(po)
    db.flush()
    history.record(db, actor, po, "po.create", after={"number": po.number, "supplier_id": supplier_id}, op_id=op_id)
    out_lines = []
    for i, spec in enumerate(lines, start=1):
        allocs = spec.get("allocations", [])
        if spec["qty"] <= 0:
            raise DomainError("Ordered quantity must be positive")
        if sum(a["qty"] for a in allocs) > spec["qty"]:
            raise DomainError("Allocations exceed the ordered quantity")
        line = PurchaseOrderLine(
            id=spec.get("id") or new_id("pol"), po_id=po.id, line_no=i, part_id=spec["part_id"],
            ordered_qty=spec["qty"], canceled_qty=0, closed_shortfall_qty=0,
            expected_arrival=spec.get("expected_arrival"), arrival_basis=spec.get("arrival_basis", "buyer_estimate"),
            arrival_channel=actor.channel, arrival_updated_at=clock.now(),
        )
        db.add(line)
        db.flush()
        for a in allocs:
            alloc_service.assign_supply(db, actor, a["work_order_item_id"], "po_line", line.id, a["qty"], op_id)
        out_lines.append(line.id)
    return {"po_id": po.id, "number": po.number, "line_ids": out_lines}


def update_arrival(db: Session, actor: Actor, *, target_type: str, target_id: str, expected_arrival: date | None,
                   basis: str, note: str | None = None, op_id=None) -> dict:
    """Explicitly set the current expected arrival. Production start dates are never changed here."""
    if basis not in ARRIVAL_BASES:
        raise DomainError(f"Arrival basis must be one of {ARRIVAL_BASES}")
    if target_type == "po_line":
        obj = lock(db, PurchaseOrderLine, target_id)
        if basis == "supplier_promise":
            obj.supplier_promised_date = expected_arrival
    elif target_type == "shipment":
        obj = lock(db, Shipment, target_id)
        if obj.status == "received":
            raise DomainError("Shipment already received")
        if basis == "carrier_estimate":
            obj.carrier_eta = expected_arrival
    else:
        raise DomainError("Arrival updates target a PO line or a shipment")
    before = history.snap(obj, *ARRIVAL_FIELDS)
    obj.expected_arrival = expected_arrival
    obj.arrival_basis = basis
    obj.arrival_channel = actor.channel
    obj.arrival_updated_at = clock.now()
    history.record(db, actor, obj, "arrival.update", before, history.snap(obj, *ARRIVAL_FIELDS), note=note, op_id=op_id)
    return {"target_type": target_type, "target_id": target_id, "expected_arrival": expected_arrival}


def acknowledge_line(db: Session, actor: Actor, line_id: str, promised_date: date | None, op_id=None) -> dict:
    line = lock(db, PurchaseOrderLine, line_id)
    line.acknowledged_at = clock.now()
    history.record(db, actor, line, "po_line.acknowledge", after={"promised": str(promised_date)}, op_id=op_id)
    return update_arrival(db, actor, target_type="po_line", target_id=line.id, expected_arrival=promised_date,
                          basis="supplier_promise", note="supplier acknowledgment", op_id=op_id)


def create_shipment(db: Session, actor: Actor, *, lines: list[dict], expected_arrival: date | None,
                    carrier: str | None, tracking_number: str | None, number: str | None = None,
                    shipment_id: str | None = None, op_id=None) -> dict:
    """Ship-notice: quantities move from the PO line's unshipped balance onto this shipment."""
    if not lines:
        raise DomainError("A shipment needs at least one line")
    first = get_or_404(db, PurchaseOrderLine, lines[0]["po_line_id"])
    po = get_or_404(db, PurchaseOrder, first.po_id)
    if number is None:
        count = db.scalar(select(func.count()).select_from(Shipment)) or 0
        number = f"SH-{8001 + count}"
    sh = Shipment(id=shipment_id or new_id("sh"), number=number, supplier_id=po.supplier_id,
                  destination_warehouse_id=po.destination_warehouse_id, status="in_transit", carrier=carrier,
                  tracking_number=tracking_number, expected_arrival=expected_arrival,
                  arrival_basis="carrier_estimate" if carrier else "supplier_promise", carrier_eta=expected_arrival,
                  arrival_channel=actor.channel, arrival_updated_at=clock.now())
    db.add(sh)
    db.flush()
    for spec in lines:
        line = lock(db, PurchaseOrderLine, spec["po_line_id"])
        if get_or_404(db, PurchaseOrder, line.po_id).destination_warehouse_id != sh.destination_warehouse_id:
            raise DomainError("All shipment lines must share a destination")
        q = po_line_quantities(db, line)
        if spec["qty"] <= 0 or spec["qty"] > q.unshipped:
            raise DomainError(f"Only {q.unshipped} unshipped on this line")
        db.add(ShipmentLine(id=spec.get("id") or new_id("shl"), shipment_id=sh.id, po_line_id=line.id, qty=spec["qty"]))
    db.flush()
    history.record(db, actor, sh, "shipment.create",
                   after=history.snap(sh, "number", "expected_arrival", "tracking_number"), op_id=op_id)
    return {"shipment_id": sh.id, "number": sh.number}


def tracking_update(db: Session, actor: Actor, shipment_id: str, carrier_eta: date | None, status: str | None,
                    op_id=None) -> dict:
    """Carrier feed. 'arrived' means at the dock, not received or released."""
    sh = lock(db, Shipment, shipment_id)
    if status:
        if status not in ("in_transit", "arrived"):
            raise DomainError("Tracking can only report in_transit or arrived")
        sh.status = status
    return update_arrival(db, actor, target_type="shipment", target_id=sh.id, expected_arrival=carrier_eta,
                          basis="carrier_estimate", note="carrier tracking update", op_id=op_id)


def close_shortfall(db: Session, actor: Actor, line_id: str, qty: int, note: str, op_id=None) -> dict:
    """Record that a short delivery will not be fulfilled; never silently delete the units."""
    line = lock(db, PurchaseOrderLine, line_id)
    q = po_line_quantities(db, line)
    if qty <= 0 or qty > q.outstanding:
        raise DomainError(f"Shortfall must be between 1 and {q.outstanding} outstanding")
    before = {"closed_shortfall_qty": line.closed_shortfall_qty}
    line.closed_shortfall_qty += qty
    history.record(db, actor, line, "po_line.close_shortfall", before,
                   {"closed_shortfall_qty": line.closed_shortfall_qty}, note=note, op_id=op_id)
    result = reconcile_line(db, actor, line.id, op_id)
    if result["deficit"]:
        po = get_or_404(db, PurchaseOrder, line.po_id)
        exc_service.raise_exception(
            db, actor, type="supply_deficit", owner_role="purchasing", part_id=line.part_id,
            title=f"{po.number}-{line.line_no} short {result['deficit']} after closing {qty} undelivered",
            detail=note, source_type="po_line", source_id=line.id, affected_qty=result["deficit"],
            links=result["affected"], op_id=op_id,
        )
    return {"po_line_id": line.id, "deficit": result["deficit"]}


def clear_po_review(db: Session, actor: Actor, po_id: str, note: str, op_id=None) -> dict:
    po = lock(db, PurchaseOrder, po_id)
    if not po.needs_review:
        raise DomainError("PO is not flagged for review")
    po.needs_review = False
    history.record(db, actor, po, "po.review_done", {"needs_review": True}, {"needs_review": False}, note=note,
                   op_id=op_id)
    po.review_note = note
    return {"po_id": po.id}


# ---------------------------------------------------------------- check-in tasks


def create_checkin(db: Session, actor: Actor, *, po_id: str, po_line_id: str | None, due_date: date, owner: str,
                   note: str | None, task_id: str | None = None, op_id=None) -> dict:
    get_or_404(db, PurchaseOrder, po_id)
    task = POCheckInTask(id=task_id or new_id("ck"), po_id=po_id, po_line_id=po_line_id, due_date=due_date,
                         owner=owner, note=note, state="open")
    db.add(task)
    db.flush()
    history.record(db, actor, task, "checkin.create", after=history.snap(task, "due_date", "owner"), op_id=op_id)
    return {"task_id": task.id}


def complete_checkin(db: Session, actor: Actor, task_id: str, outcome: str, new_arrival: dict | None,
                     op_id=None) -> dict:
    """Close a follow-up. A revised arrival goes through update_arrival like any other change."""
    task = lock(db, POCheckInTask, task_id)
    if task.state != "open":
        raise DomainError("Check-in already completed")
    if not outcome:
        raise DomainError("Record the check-in outcome")
    task.state = "completed"
    task.completed_at = clock.now()
    task.outcome = outcome
    history.record(db, actor, task, "checkin.complete", {"state": "open"}, {"state": "completed"}, note=outcome,
                   op_id=op_id)
    if new_arrival:
        update_arrival(db, actor, target_type=new_arrival["target_type"], target_id=new_arrival["target_id"],
                       expected_arrival=new_arrival.get("expected_arrival"),
                       basis=new_arrival.get("basis", "supplier_promise"), note=f"check-in: {outcome}", op_id=op_id)
    return {"task_id": task.id}


def open_shipment_qty(db: Session, sl: ShipmentLine) -> int:
    return sl.qty - received_against_shipment_line(db, sl.id)


def record_supplier_update(db: Session, actor: Actor, po_id: str, *, note: str, arrivals: list[dict],
                           complete_checkin_ids: list[str], next_checkin: dict | None, mark_reviewed: bool,
                           op_id=None) -> dict:
    """One interaction for supplier follow-up (PRD §4.18): outcome note, revised arrivals for the chosen
    shipments/PO lines, completion of the related check-ins, an optional next check-in, and PO review.

    Production start is never changed; a later date leaves the conflict visible.
    """
    if not note or not note.strip():
        raise DomainError("Record what the supplier said")
    po = lock(db, PurchaseOrder, po_id)
    line_ids = {l.id for l in db.scalars(select(PurchaseOrderLine).where(PurchaseOrderLine.po_id == po.id))}
    for a in arrivals:
        if a["target_type"] == "po_line":
            ok = a["target_id"] in line_ids
        else:
            sh_lines = db.scalars(select(ShipmentLine).where(ShipmentLine.shipment_id == a["target_id"])).all()
            ok = bool(sh_lines) and all(sl.po_line_id in line_ids for sl in sh_lines)
        if not ok:
            raise DomainError("Arrival update must target this PO's shipments or lines")
        update_arrival(db, actor, target_type=a["target_type"], target_id=a["target_id"],
                       expected_arrival=a.get("expected_arrival"), basis=a.get("basis", "supplier_promise"),
                       note=note, op_id=op_id)
    for task_id in complete_checkin_ids:
        task = get_or_404(db, POCheckInTask, task_id)
        if task.po_id != po.id:
            raise DomainError("Check-in belongs to a different PO")
        complete_checkin(db, actor, task_id, note, None, op_id)
    if next_checkin and next_checkin.get("due_date"):
        create_checkin(db, actor, po_id=po.id, po_line_id=None, due_date=next_checkin["due_date"], owner=actor.name,
                       note=next_checkin.get("note"), op_id=op_id)
    if mark_reviewed and po.needs_review:
        clear_po_review(db, actor, po.id, note, op_id)
    history.record(db, actor, po, "po.supplier_update", note=note, op_id=op_id)
    return {"po_id": po.id}
