"""Work-order requirements and the allocations that cover them."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.models import (
    ACTIVE_STATES,
    Allocation,
    FixtureRequirement,
    InventoryRecord,
    PurchaseOrder,
    PurchaseOrderLine,
    TransferLine,
    WorkOrder,
    WorkOrderItem,
    new_id,
)
from app.services import exceptions as exc_service
from app.services import history
from app.services.common import Actor, DomainError, get_or_404, lock, lock_all
from app.services.supply import (
    allocated_to_inventory,
    allocated_to_item,
    allocated_to_transfer,
    eligible_free_stock_filter,
    po_line_quantities,
    transfer_open,
)

ALLOC_FIELDS = ("qty", "state", "review_required", "po_line_id", "inventory_record_id", "transfer_line_id")


def _new_allocation(db: Session, actor: Actor, item_id: str, qty: int, state: str, *, op_id=None,
                    predecessor_id=None, note=None, **source) -> Allocation:
    alloc = Allocation(
        id=new_id("al"), work_order_item_id=item_id, qty=qty, state=state,
        review_required=False, predecessor_id=predecessor_id, **source,
    )
    db.add(alloc)
    db.flush()
    history.record(db, actor, alloc, "allocation.create", after=history.snap(alloc, *ALLOC_FIELDS),
                   note=note, op_id=op_id)
    return alloc


def release(db: Session, actor: Actor, alloc: Allocation, reason: str, op_id=None) -> None:
    before = history.snap(alloc, *ALLOC_FIELDS)
    alloc.state = "released"
    alloc.review_required = False
    alloc.released_at = clock.now()
    alloc.release_reason = reason
    history.record(db, actor, alloc, "allocation.release", before, history.snap(alloc, *ALLOC_FIELDS),
                   note=reason, op_id=op_id)


def reduce(db: Session, actor: Actor, alloc: Allocation, by: int, reason: str, op_id=None) -> None:
    """Shrink an allocation, releasing it when nothing is left."""
    if by >= alloc.qty:
        release(db, actor, alloc, reason, op_id)
        return
    before = history.snap(alloc, *ALLOC_FIELDS)
    alloc.qty -= by
    history.record(db, actor, alloc, "allocation.reduce", before, history.snap(alloc, *ALLOC_FIELDS),
                   note=reason, op_id=op_id)


def move_to_inventory(db: Session, actor: Actor, alloc: Allocation, qty: int,
                      records: list[InventoryRecord], reason: str, op_id=None) -> int:
    """Hand off qty of a PO-line/transfer claim to accepted inventory records, conserving quantity.

    Fills records in order up to their unallocated quantity. Returns the quantity moved.
    """
    moved = 0
    for rec in records:
        if moved >= qty:
            break
        room = rec.qty - allocated_to_inventory(db, rec.id)
        take = min(room, qty - moved)
        if take <= 0:
            continue
        _new_allocation(db, actor, alloc.work_order_item_id, take, "committed",
                        inventory_record_id=rec.id, predecessor_id=alloc.id, note=reason, op_id=op_id)
        moved += take
    if moved:
        reduce(db, actor, alloc, moved, reason, op_id)
    return moved


# ---------------------------------------------------------------- work orders


def create_work_order(db: Session, actor: Actor, *, number: str, title: str, program_id: str,
                      warehouse_id: str, production_start_date: date, build_qty: int,
                      items: list[dict], fixtures: list[dict] | None = None, wo_id: str | None = None) -> WorkOrder:
    if not items:
        raise DomainError("A work order needs at least one required part")
    wo = WorkOrder(id=wo_id or new_id("wo"), number=number, title=title, program_id=program_id,
                   warehouse_id=warehouse_id, production_start_date=production_start_date,
                   build_qty=build_qty, state="draft")
    db.add(wo)
    db.flush()
    for i, it in enumerate(items, start=1):
        if it["required_qty"] <= 0:
            raise DomainError("Required quantities must be positive")
        db.add(WorkOrderItem(id=it.get("id") or new_id("woi"), work_order_id=wo.id, line_no=i,
                             part_id=it["part_id"], required_qty=it["required_qty"]))
    for fx in fixtures or []:
        db.add(FixtureRequirement(id=fx.get("id") or new_id("fx"), work_order_id=wo.id,
                                  operation=fx["operation"], fixture_type=fx["fixture_type"],
                                  quantity=fx["quantity"], coverage_state="pending"))
    db.flush()
    history.record(db, actor, wo, "work_order.create",
                   after=history.snap(wo, "number", "state", "production_start_date"))
    return wo


def finalize_work_order(db: Session, actor: Actor, wo_id: str, op_id=None) -> dict:
    """Commit the work order: reserve eligible local stock, then hold remote stock provisionally."""
    wo = lock(db, WorkOrder, wo_id)
    if wo.state != "draft":
        raise DomainError(f"Work order is {wo.state}; only drafts can be finalized")
    wo.state = "finalized"
    wo.finalized_at = clock.now()
    history.record(db, actor, wo, "work_order.finalize", {"state": "draft"}, {"state": "finalized"}, op_id=op_id)
    reserved, held = 0, 0
    items = db.scalars(select(WorkOrderItem).where(WorkOrderItem.work_order_id == wo.id)
                       .order_by(WorkOrderItem.line_no))
    for item in items:
        r, h = _reserve_item(db, actor, wo, item, op_id)
        reserved += r
        held += h
    return {"work_order_id": wo.id, "reserved_qty": reserved, "remote_hold_qty": held}


def _reserve_item(db: Session, actor: Actor, wo: WorkOrder, item: WorkOrderItem, op_id) -> tuple[int, int]:
    need = item.required_qty - allocated_to_item(db, item.id)
    reserved = held = 0
    for local in (True, False):
        if need <= 0:
            break
        where_wh = (InventoryRecord.warehouse_id == wo.warehouse_id) if local else \
            (InventoryRecord.warehouse_id != wo.warehouse_id)
        records = lock_all(db, select(InventoryRecord)
                           .where(InventoryRecord.part_id == item.part_id, where_wh, *eligible_free_stock_filter())
                           .order_by(InventoryRecord.created_at, InventoryRecord.id))
        for rec in records:
            free = rec.qty - allocated_to_inventory(db, rec.id)
            take = min(free, need)
            if take <= 0:
                continue
            _new_allocation(db, actor, item.id, take, "committed" if local else "remote_hold",
                            inventory_record_id=rec.id, op_id=op_id,
                            note="auto-reserve on finalize" if local else "provisional remote hold")
            need -= take
            if local:
                reserved += take
            else:
                held += take
            if need <= 0:
                break
    return reserved, held


def assign_supply(db: Session, actor: Actor, item_id: str, source_type: str, source_id: str, qty: int,
                  op_id=None) -> dict:
    """Manually commit a quantity of a specific source to a requirement."""
    if qty <= 0:
        raise DomainError("Quantity must be positive")
    item = lock(db, WorkOrderItem, item_id)
    wo = get_or_404(db, WorkOrder, item.work_order_id)
    if wo.state != "finalized":
        raise DomainError("Supply can only be assigned to finalized work orders")
    need = item.required_qty - allocated_to_item(db, item.id)
    if qty > need:
        raise DomainError(f"Requirement only needs {need} more")

    if source_type == "po_line":
        line = lock(db, PurchaseOrderLine, source_id)
        po = get_or_404(db, PurchaseOrder, line.po_id)
        _check_part_and_dest(line.part_id, po.destination_warehouse_id, item, wo)
        if po.status != "open":
            raise DomainError("PO is not open")
        available = po_line_quantities(db, line).unallocated
        source = {"po_line_id": line.id}
    elif source_type == "transfer_line":
        t = lock(db, TransferLine, source_id)
        _check_part_and_dest(t.part_id, t.dest_warehouse_id, item, wo)
        if not transfer_open(t):
            raise DomainError("Transfer is not open")
        available = t.qty - allocated_to_transfer(db, t.id)
        source = {"transfer_line_id": t.id}
    elif source_type == "inventory":
        rec = lock(db, InventoryRecord, source_id)
        _check_part_and_dest(rec.part_id, rec.warehouse_id, item, wo)
        eligible = (rec.quality_state == "accepted" and rec.stage in ("received", "stored")
                    and rec.pool_po_line_id is None and rec.reserved_transfer_line_id is None)
        if not eligible:
            raise DomainError("Inventory is not accepted, free stock")
        available = rec.qty - allocated_to_inventory(db, rec.id)
        source = {"inventory_record_id": rec.id}
    else:
        raise DomainError(f"Unknown source type {source_type}")

    if qty > available:
        raise DomainError(f"Only {available} unallocated on this source")
    alloc = _new_allocation(db, actor, item.id, qty, "committed", op_id=op_id, note="manual assignment", **source)
    return {"allocation_id": alloc.id, "remaining_unallocated": available - qty}


def _check_part_and_dest(part_id: str, dest_wh: str, item: WorkOrderItem, wo: WorkOrder) -> None:
    if part_id != item.part_id:
        raise DomainError("Source part does not match the requirement")
    if dest_wh != wo.warehouse_id:
        raise DomainError("Source destination differs from the work order's warehouse")


# ---------------------------------------------------------------- remote holds and transfers


def confirm_remote_hold(db: Session, actor: Actor, alloc_id: str, expected_arrival: date | None,
                        op_id=None) -> dict:
    """Turn a provisional remote hold into a transfer; the source units are reserved for it."""
    alloc = lock(db, Allocation, alloc_id)
    if alloc.state != "remote_hold":
        raise DomainError("Allocation is not a remote hold")
    rec = lock(db, InventoryRecord, alloc.inventory_record_id)
    item = get_or_404(db, WorkOrderItem, alloc.work_order_item_id)
    wo = get_or_404(db, WorkOrder, item.work_order_id)
    t = TransferLine(id=new_id("tr"), part_id=rec.part_id, qty=alloc.qty, source_warehouse_id=rec.warehouse_id,
                     dest_warehouse_id=wo.warehouse_id, status="planned", expected_arrival=expected_arrival,
                     arrival_channel=actor.channel, arrival_updated_at=clock.now())
    db.add(t)
    db.flush()
    if rec.qty > alloc.qty:
        moving = _split(db, rec, alloc.qty)
    else:
        moving = rec
    moving.reserved_transfer_line_id = t.id
    history.record(db, actor, t, "transfer.create",
                   after=history.snap(t, "qty", "source_warehouse_id", "dest_warehouse_id", "expected_arrival"),
                   op_id=op_id)
    release(db, actor, alloc, "remote hold confirmed as transfer", op_id)
    new = _new_allocation(db, actor, item.id, alloc.qty, "committed", transfer_line_id=t.id,
                          predecessor_id=alloc.id, op_id=op_id, note="transfer confirmed")
    return {"transfer_line_id": t.id, "allocation_id": new.id}


def release_remote_hold(db: Session, actor: Actor, alloc_id: str, op_id=None) -> dict:
    alloc = lock(db, Allocation, alloc_id)
    if alloc.state != "remote_hold":
        raise DomainError("Allocation is not a remote hold")
    release(db, actor, alloc, "remote hold released by planner", op_id)
    return {"allocation_id": alloc.id}


def update_transfer(db: Session, actor: Actor, transfer_id: str, *, status: str | None,
                    expected_arrival: date | None, op_id=None) -> dict:
    t = lock(db, TransferLine, transfer_id)
    if not transfer_open(t):
        raise DomainError("Transfer is closed")
    before = history.snap(t, "status", "expected_arrival")
    if status:
        if status not in ("planned", "in_transit"):
            raise DomainError("Use receive to complete a transfer")
        t.status = status
    t.expected_arrival = expected_arrival
    t.arrival_channel = actor.channel
    t.arrival_updated_at = clock.now()
    history.record(db, actor, t, "transfer.update", before, history.snap(t, "status", "expected_arrival"), op_id=op_id)
    return {"transfer_line_id": t.id}


def receive_transfer(db: Session, actor: Actor, transfer_id: str, op_id=None) -> dict:
    """Destination receipt: the same units move warehouses once; claims move with them."""
    t = lock(db, TransferLine, transfer_id)
    if not transfer_open(t):
        raise DomainError("Transfer already received or canceled")
    rec = db.scalars(select(InventoryRecord).where(InventoryRecord.reserved_transfer_line_id == t.id)
                     .with_for_update()).first()
    if rec is None:
        raise DomainError("Transfer has no reserved source inventory")
    before = history.snap(rec, "warehouse_id", "location", "stage")
    rec.warehouse_id = t.dest_warehouse_id
    rec.location = "DOCK"
    rec.stage = "received"
    rec.reserved_transfer_line_id = None
    rec.origin_transfer_line_id = t.id
    rec.received_on = clock.today()
    t.status = "received"
    history.record(db, actor, rec, "inventory.transfer_in", before,
                   history.snap(rec, "warehouse_id", "location", "stage"), op_id=op_id)
    claims = lock_all(db, select(Allocation).where(Allocation.transfer_line_id == t.id,
                                                   Allocation.state.in_(ACTIVE_STATES)))
    for c in claims:
        move_to_inventory(db, actor, c, c.qty, [rec], "transfer received", op_id)
    return {"inventory_record_id": rec.id}


def _split(db: Session, rec: InventoryRecord, qty: int, **changes) -> InventoryRecord:
    """Split qty off a record into a new child record; total quantity is unchanged."""
    if qty <= 0 or qty > rec.qty:
        raise DomainError("Invalid split quantity")
    rec.qty -= qty
    child = InventoryRecord(
        id=new_id("inv"), part_id=rec.part_id, warehouse_id=rec.warehouse_id, location=rec.location, lot=rec.lot,
        qty=qty, quality_state=rec.quality_state, stage=rec.stage, parent_id=rec.id,
        receipt_line_id=rec.receipt_line_id, qa_batch_id=rec.qa_batch_id, origin_po_line_id=rec.origin_po_line_id,
        pool_po_line_id=rec.pool_po_line_id, origin_transfer_line_id=rec.origin_transfer_line_id,
        received_on=rec.received_on,
    )
    for k, v in changes.items():
        setattr(child, k, v)
    db.add(child)
    db.flush()
    return child


split_record = _split


# ---------------------------------------------------------------- demand reduction / cancellation


def _release_unused(db: Session, actor: Actor, item: WorkOrderItem, qty: int, reason: str,
                    op_id) -> tuple[int, set[str], int]:
    """Release up to qty of unused allocations. Picked/staged units are never released here.

    Order: remote holds, incoming transfers, incoming PO commitments, then unpicked stock.
    Returns (released, affected PO ids, qty that could not be released because it is picked/staged).
    """
    allocs = lock_all(db, select(Allocation).where(Allocation.work_order_item_id == item.id,
                                                   Allocation.state.in_(ACTIVE_STATES)))
    records = {a.inventory_record_id: db.get(InventoryRecord, a.inventory_record_id)
               for a in allocs if a.inventory_record_id}

    def rank(a: Allocation) -> int:
        if a.state == "remote_hold":
            return 0
        if a.transfer_line_id:
            return 1
        if a.po_line_id:
            return 2
        return 3 if records[a.inventory_record_id].stage in ("received", "stored") else 9

    released, pos, physical = 0, set(), 0
    for a in sorted(allocs, key=rank):
        if released >= qty:
            break
        if rank(a) == 9:
            physical += min(a.qty, qty - released)
            continue
        take = min(a.qty, qty - released)
        if a.po_line_id:
            pos.add(db.get(PurchaseOrderLine, a.po_line_id).po_id)
        reduce(db, actor, a, take, reason, op_id)
        released += take
    return released, pos, physical


def _flag_pos(db: Session, actor: Actor, po_ids: set[str], note: str, op_id) -> None:
    for po_id in po_ids:
        po = lock(db, PurchaseOrder, po_id)
        po.needs_review = True
        po.review_note = note
        history.record(db, actor, po, "po.flag_review", after={"needs_review": True}, note=note, op_id=op_id)


def cancel_work_order(db: Session, actor: Actor, wo_id: str, reason: str, op_id=None) -> dict:
    wo = lock(db, WorkOrder, wo_id)
    if wo.state == "canceled":
        raise DomainError("Work order already canceled")
    prior = wo.state
    wo.state = "canceled"
    wo.canceled_at = clock.now()
    wo.cancel_reason = reason
    history.record(db, actor, wo, "work_order.cancel", {"state": prior}, {"state": "canceled"}, note=reason, op_id=op_id)
    all_pos: set[str] = set()
    physical_items = []
    for item in db.scalars(select(WorkOrderItem).where(WorkOrderItem.work_order_id == wo.id)):
        _, pos, physical = _release_unused(db, actor, item, 10**9, f"work order canceled: {reason}", op_id)
        all_pos |= pos
        if physical:
            physical_items.append((item, physical))
    _flag_pos(db, actor, all_pos, f"{wo.number} canceled; review remaining quantities", op_id)
    if physical_items:
        exc_service.raise_exception(
            db, actor, type="demand_change", owner_role="warehouse",
            title=f"{wo.number} canceled with picked/staged material",
            detail="Physical kit state preserved. Warehouse review required before reuse.",
            source_type="work_order", source_id=wo.id, affected_qty=sum(q for _, q in physical_items),
            links=[(i.id, q) for i, q in physical_items],
        )
    return {"work_order_id": wo.id, "pos_flagged": sorted(all_pos), "physical_retained": sum(q for _, q in physical_items)}


def reduce_requirement(db: Session, actor: Actor, item_id: str, new_qty: int, op_id=None) -> dict:
    item = lock(db, WorkOrderItem, item_id)
    wo = get_or_404(db, WorkOrder, item.work_order_id)
    if wo.state == "canceled":
        raise DomainError("Work order is canceled")
    if new_qty < 0 or new_qty >= item.required_qty:
        raise DomainError("New quantity must be lower than the current requirement")
    before = {"required_qty": item.required_qty}
    item.required_qty = new_qty
    history.record(db, actor, item, "work_order_item.reduce", before, {"required_qty": new_qty}, op_id=op_id)
    excess = allocated_to_item(db, item.id) - new_qty
    released, pos, physical = 0, set(), 0
    if excess > 0:
        released, pos, physical = _release_unused(db, actor, item, excess, "requirement reduced", op_id)
        _flag_pos(db, actor, pos, f"{wo.number} requirement reduced; review remaining quantities", op_id)
        if physical:
            exc_service.raise_exception(
                db, actor, type="demand_change", owner_role="warehouse",
                title=f"{wo.number} reduced below picked/staged quantity",
                detail="Excess physical material stays in place pending warehouse review.",
                source_type="work_order_item", source_id=item.id, affected_qty=physical, links=[(item.id, physical)],
            )
    return {"released_qty": released, "pos_flagged": sorted(pos), "physical_retained": physical}


def review_fixture(db: Session, actor: Actor, fixture_id: str, coverage_state: str, note: str | None,
                   op_id=None) -> dict:
    fx = lock(db, FixtureRequirement, fixture_id)
    if coverage_state not in ("pending", "covered", "action_needed"):
        raise DomainError("Invalid coverage state")
    before = history.snap(fx, "coverage_state", "note")
    fx.coverage_state = coverage_state
    fx.note = note
    fx.reviewed_by = actor.name
    fx.reviewed_at = clock.now()
    history.record(db, actor, fx, "fixture.review", before, history.snap(fx, "coverage_state", "note"), op_id=op_id)
    return {"fixture_id": fx.id}
