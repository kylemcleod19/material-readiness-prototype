"""Receiving, QA, the PO-to-inventory handoff, and picking/staging."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.models import (
    ACTIVE_STATES,
    Allocation,
    InventoryRecord,
    MaterialException,
    Part,
    PurchaseOrder,
    PurchaseOrderLine,
    QABatch,
    Receipt,
    ReceiptLine,
    Shipment,
    ShipmentLine,
    WorkOrder,
    WorkOrderItem,
    new_id,
)
from app.services import allocations as alloc_service
from app.services import exceptions as exc_service
from app.services import history
from app.services.common import Actor, DomainError, get_or_404, lock, lock_all
from app.services.supply import allocated_to_inventory, po_line_quantities, received_against_shipment_line

INV_FIELDS = ("qty", "quality_state", "stage", "location", "warehouse_id", "pool_po_line_id")


def _line_label(db: Session, line: PurchaseOrderLine) -> str:
    po = db.get(PurchaseOrder, line.po_id)
    return f"{po.number}-{line.line_no}"


# ---------------------------------------------------------------- handoff


def reconcile_line(db: Session, actor: Actor, line_id: str, op_id=None) -> dict:
    """Re-balance a PO line's claims against what it can still supply.

    - Accepted units cover every claim: move the claims onto inventory, release the pool.
    - Exactly one claim: move what is accepted to it; no choice is involved.
    - Several claims and enough remaining supply: keep the commitments; the available subset
      waits for a manual handoff because choosing an order would be a priority decision.
    - Not enough supply for all claims: flag every claim for allocation review. No losing
      order is chosen; scenario Apply resolves it.
    """
    line = lock(db, PurchaseOrderLine, line_id)
    claims = lock_all(db, select(Allocation).where(Allocation.po_line_id == line.id,
                                                   Allocation.state.in_(ACTIVE_STATES)).order_by(Allocation.created_at))
    pooled = lock_all(db, select(InventoryRecord).where(InventoryRecord.pool_po_line_id == line.id)
                      .order_by(InventoryRecord.created_at))
    accepted = [r for r in pooled if r.quality_state == "accepted"]
    total_claims = sum(c.qty for c in claims)
    available = sum(r.qty for r in accepted)
    label = _line_label(db, line)

    if claims and (total_claims <= available or len(claims) == 1) and available > 0:
        for c in claims:
            alloc_service.move_to_inventory(db, actor, c, min(c.qty, available), accepted, f"handoff from {label}", op_id)
            available -= min(c.qty, available)
        db.flush()

    remaining_claims = lock_all(db, select(Allocation).where(Allocation.po_line_id == line.id,
                                                             Allocation.state.in_(ACTIVE_STATES)))
    _settle_pool(db, line.id, accepted, keep_pool=bool(remaining_claims))
    q = po_line_quantities(db, line)
    in_review = q.deficit > 0
    for c in remaining_claims:
        if c.review_required != in_review:
            before = {"review_required": c.review_required}
            c.review_required = in_review
            history.record(db, actor, c, "allocation.review_flag", before, {"review_required": in_review}, op_id=op_id)
    return {"deficit": q.deficit, "claims": q.claims, "supply": q.supply,
            "affected": [(c.work_order_item_id, c.qty) for c in remaining_claims] if in_review else []}


def manual_handoff(db: Session, actor: Actor, allocation_id: str, qty: int, op_id=None) -> dict:
    """Planner picks which claim receives accepted units waiting in a PO line's pool."""
    alloc = lock(db, Allocation, allocation_id)
    if alloc.state != "committed" or not alloc.po_line_id:
        raise DomainError("Only committed PO-line claims can be handed off")
    if alloc.review_required:
        raise DomainError("This supply needs an allocation review; use a scenario")
    if qty <= 0 or qty > alloc.qty:
        raise DomainError("Invalid quantity")
    pooled = lock_all(db, select(InventoryRecord).where(InventoryRecord.pool_po_line_id == alloc.po_line_id,
                                                        InventoryRecord.quality_state == "accepted")
                      .order_by(InventoryRecord.created_at))
    if qty > sum(r.qty for r in pooled):
        raise DomainError("Not enough accepted units waiting for handoff")
    line_id = alloc.po_line_id
    alloc_service.move_to_inventory(db, actor, alloc, qty, pooled, "manual handoff", op_id)
    _settle_pool(db, line_id, pooled, keep_pool=True)
    reconcile_line(db, actor, line_id, op_id)
    return {"moved": qty}


def _settle_pool(db: Session, line_id: str, accepted: list[InventoryRecord], keep_pool: bool) -> None:
    """Keep the invariant that pooled records carry no allocations.

    Records that received handed-off allocations leave the pool; any unallocated remainder is
    split off and stays pooled while the line still has claims. With no claims left, the
    whole pool becomes ordinary free stock.
    """
    db.flush()
    for r in accepted:
        if r.pool_po_line_id != line_id:
            continue
        allocated = allocated_to_inventory(db, r.id)
        if not keep_pool:
            r.pool_po_line_id = None
        elif allocated > 0:
            if r.qty > allocated:
                alloc_service.split_record(db, r, r.qty - allocated)  # child inherits the pool link
            r.pool_po_line_id = None
    db.flush()


# ---------------------------------------------------------------- receiving


def receive(db: Session, actor: Actor, *, warehouse_id: str, lines: list[dict], shipment_id: str | None = None,
            op_id=None) -> dict:
    """Record physically received quantities. Receipt never implies quality release."""
    if not lines:
        raise DomainError("Nothing to receive")
    receipt = Receipt(id=new_id("rc"), warehouse_id=warehouse_id, shipment_id=shipment_id,
                      received_by=actor.name, received_at=clock.now())
    db.add(receipt)
    db.flush()
    created = []
    touched_lines = []
    for spec in lines:
        qty = spec["qty"]
        if qty <= 0:
            raise DomainError("Received quantity must be positive")
        line = lock(db, PurchaseOrderLine, spec["po_line_id"])
        po = get_or_404(db, PurchaseOrder, line.po_id)
        if po.destination_warehouse_id != warehouse_id:
            raise DomainError("PO line is destined for a different warehouse")
        q = po_line_quantities(db, line)
        if qty > q.outstanding:
            raise DomainError(
                f"Over-receipt: {qty} exceeds {q.outstanding} outstanding on {_line_label(db, line)}. "
                "Record a discrepancy for manual review."
            )
        sl_id = spec.get("shipment_line_id")
        if sl_id:
            sl = lock(db, ShipmentLine, sl_id)
            if sl.po_line_id != line.id:
                raise DomainError("Shipment line does not belong to this PO line")
            open_qty = sl.qty - received_against_shipment_line(db, sl.id)
            if qty > open_qty:
                raise DomainError(f"Only {open_qty} open on this shipment line")
        part = get_or_404(db, Part, line.part_id)
        if part.lot_tracked and not spec.get("lot"):
            raise DomainError(f"{part.part_number} is lot-tracked; enter the lot")
        rl = ReceiptLine(id=new_id("rl"), receipt_id=receipt.id, po_line_id=line.id, shipment_line_id=sl_id,
                         qty=qty, lot=spec.get("lot"))
        db.add(rl)
        db.flush()
        rec = InventoryRecord(
            id=new_id("inv"), part_id=part.id, warehouse_id=warehouse_id, location="DOCK", lot=spec.get("lot"),
            qty=qty, quality_state="pending" if part.requires_qa else "accepted", stage="received",
            receipt_line_id=rl.id, origin_po_line_id=line.id, pool_po_line_id=line.id, received_on=clock.today(),
        )
        db.add(rec)
        db.flush()
        batch_id = None
        if part.requires_qa:
            batch = QABatch(id=new_id("qa"), receipt_line_id=rl.id, input_qty=qty, status="pending")
            db.add(batch)
            db.flush()
            rec.qa_batch_id = batch.id
            batch_id = batch.id
        history.record(db, actor, rl, "receipt.line", after={"qty": qty, "po_line_id": line.id, "lot": rl.lot},
                       op_id=op_id)
        created.append({"receipt_line_id": rl.id, "inventory_record_id": rec.id, "qa_batch_id": batch_id})
        if not part.requires_qa:
            touched_lines.append(line.id)
    if shipment_id:
        _update_shipment_status(db, shipment_id)
    for line_id in touched_lines:
        reconcile_line(db, actor, line_id, op_id)
    return {"receipt_id": receipt.id, "lines": created}


def _update_shipment_status(db: Session, shipment_id: str) -> None:
    sh = lock(db, Shipment, shipment_id)
    sls = db.scalars(select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id)).all()
    db.flush()
    fully = all(received_against_shipment_line(db, sl.id) >= sl.qty for sl in sls)
    sh.status = "received" if fully else "arrived"


# ---------------------------------------------------------------- QA


def complete_qa(db: Session, actor: Actor, batch_id: str, accepted_qty: int, rejected_qty: int,
                note: str | None = None, op_id=None) -> dict:
    """Accepted units become available. Rejected units are scrapped (kept only as a traceable record)
    and always raise a purchasing exception."""
    batch = lock(db, QABatch, batch_id)
    if batch.status != "pending":
        raise DomainError("QA batch already completed")
    if accepted_qty < 0 or rejected_qty < 0 or accepted_qty + rejected_qty != batch.input_qty:
        raise DomainError(f"Accepted + rejected must equal the {batch.input_qty} inspected")
    rec = db.scalars(select(InventoryRecord).where(InventoryRecord.qa_batch_id == batch.id,
                                                   InventoryRecord.quality_state == "pending").with_for_update()).first()
    if rec is None or rec.qty != batch.input_qty:
        raise DomainError("Pending inventory for this batch is missing or already split")
    rl = get_or_404(db, ReceiptLine, batch.receipt_line_id)
    line = get_or_404(db, PurchaseOrderLine, rl.po_line_id)
    part = get_or_404(db, Part, line.part_id)

    before = history.snap(rec, *INV_FIELDS)
    scrap_id = None
    if accepted_qty == 0:
        rec.quality_state = "scrapped"
        rec.pool_po_line_id = None
        rec.location = "SCRAP"
        scrap_id = rec.id
    else:
        if rejected_qty:
            scrap = alloc_service.split_record(db, rec, rejected_qty, quality_state="scrapped", pool_po_line_id=None,
                                               location="SCRAP")
            scrap_id = scrap.id
        rec.quality_state = "accepted"
    batch.status = "completed"
    batch.accepted_qty = accepted_qty
    batch.rejected_qty = rejected_qty
    batch.inspector = actor.name
    batch.note = note
    batch.completed_at = clock.now()
    db.flush()
    history.record(db, actor, batch, "qa.complete", after={"accepted": accepted_qty, "rejected": rejected_qty},
                   note=note, op_id=op_id)
    history.record(db, actor, rec, "inventory.qa_result", before, history.snap(rec, *INV_FIELDS), op_id=op_id)

    result = reconcile_line(db, actor, line.id, op_id)
    exception_id = None
    if rejected_qty:
        label = _line_label(db, line)
        deficit = result["deficit"]
        detail = f"{rejected_qty} {part.uom} scrapped from receipt on {label}."
        if deficit:
            detail += (f" {result['claims']} allocated to work orders but only {result['supply']} remain: "
                       f"short {deficit}. Decide how to split the remaining supply; no order was chosen automatically.")
        else:
            detail += " Remaining supply still covers every allocation. Replace the scrapped quantity if needed."
        exc = exc_service.raise_exception(
            db, actor, type="qa_rejection", owner_role="purchasing", part_id=part.id,
            title=f"QA scrapped {rejected_qty} of {batch.input_qty} {part.part_number} ({label})",
            detail=detail, source_type="qa_batch", source_id=batch.id, affected_qty=rejected_qty,
            links=result["affected"], op_id=op_id,
        )
        exception_id = exc.id
    return {"qa_batch_id": batch.id, "accepted_inventory_id": rec.id if accepted_qty else None,
            "scrap_inventory_id": scrap_id, "deficit": result["deficit"], "exception_id": exception_id}


# ---------------------------------------------------------------- putaway, picking, staging


def putaway(db: Session, actor: Actor, record_id: str, location: str, op_id=None) -> dict:
    rec = lock(db, InventoryRecord, record_id)
    if rec.stage not in ("received", "stored"):
        raise DomainError("Picked or staged material is moved through picking")
    before = history.snap(rec, *INV_FIELDS)
    rec.stage = "stored"
    rec.location = location
    history.record(db, actor, rec, "inventory.putaway", before, history.snap(rec, *INV_FIELDS), op_id=op_id)
    return {"inventory_record_id": rec.id}


def pick(db: Session, actor: Actor, allocation_id: str, qty: int, location: str, stage_direct: bool = False,
         op_id=None) -> dict:
    """Pick committed, accepted units for a kit. Stage changes; quantity is never added."""
    alloc = lock(db, Allocation, allocation_id)
    if alloc.state != "committed" or not alloc.inventory_record_id:
        raise DomainError("Only committed inventory allocations can be picked")
    if alloc.review_required:
        raise DomainError("An allocation decision is needed before picking")
    item = get_or_404(db, WorkOrderItem, alloc.work_order_item_id)
    wo = get_or_404(db, WorkOrder, item.work_order_id)
    if wo.state != "finalized":
        raise DomainError("Work order is not finalized")
    rec = lock(db, InventoryRecord, alloc.inventory_record_id)
    if rec.quality_state != "accepted":
        raise DomainError("Pending-QA or held material cannot be picked")
    if rec.stage not in ("received", "stored"):
        raise DomainError("Material already picked")
    if rec.pool_po_line_id or rec.reserved_transfer_line_id:
        raise DomainError("Material is not free to pick")
    if qty <= 0 or qty > alloc.qty:
        raise DomainError(f"Pick quantity must be between 1 and {alloc.qty}")
    new_stage = "staged" if stage_direct else "picked"
    before = history.snap(rec, *INV_FIELDS)
    others = allocated_to_inventory(db, rec.id) - alloc.qty
    if qty == rec.qty and others == 0:
        target = rec
        rec.stage = new_stage
        rec.location = location
    else:
        target = alloc_service.split_record(db, rec, qty, stage=new_stage, location=location)
        if qty == alloc.qty:
            alloc.inventory_record_id = target.id
        else:
            alloc_service.reduce(db, actor, alloc, qty, "partial pick", op_id)
            alloc_service._new_allocation(db, actor, item.id, qty, "committed", inventory_record_id=target.id,
                                          predecessor_id=alloc.id, note="partial pick", op_id=op_id)
    history.record(db, actor, target, f"inventory.{new_stage}", before, history.snap(target, *INV_FIELDS),
                   note=f"for {wo.number}", op_id=op_id)
    return {"inventory_record_id": target.id}


def stage(db: Session, actor: Actor, record_id: str, location: str, op_id=None) -> dict:
    rec = lock(db, InventoryRecord, record_id)
    if rec.stage != "picked":
        raise DomainError("Only picked material can be staged")
    before = history.snap(rec, *INV_FIELDS)
    rec.stage = "staged"
    rec.location = location
    history.record(db, actor, rec, "inventory.staged", before, history.snap(rec, *INV_FIELDS), op_id=op_id)
    return {"inventory_record_id": rec.id}


def report_discrepancy(db: Session, actor: Actor, *, type: str, title: str, detail: str | None,
                       source_type: str, source_id: str, affected_qty: int, item_ids: list[str],
                       op_id=None) -> MaterialException:
    """Warehouse records the facts; purchasing/program management decide what to do."""
    if type not in ("over_receipt", "unmatched_receipt", "picking_discrepancy"):
        raise DomainError("Unsupported discrepancy type")
    return exc_service.raise_exception(
        db, actor, type=type, title=title, detail=detail, source_type=source_type, source_id=source_id,
        affected_qty=affected_qty, owner_role="purchasing", blocking=type == "picking_discrepancy",
        links=[(i, None) for i in item_ids], op_id=op_id,
    )
