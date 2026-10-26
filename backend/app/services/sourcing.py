"""Source material: one confirmed decision covering a part at one destination (PRD §4.1, §4.2, §4.14).

The panel's choices are applied together in one transaction. Nothing changes until confirmation, and a
stock-at-another-site allocation replaced by "Buy instead" is released in the same transaction that
creates its replacement, so the requirement is never left without the supply the user chose.
"""
from datetime import date

from sqlalchemy.orm import Session

from app.models import Allocation, PurchaseOrderLine, TransferLine, WorkOrder, WorkOrderItem
from app.services import allocations as alloc_service
from app.services import purchasing
from app.services.common import Actor, DomainError, get_or_404, lock
from app.services.readiness import Snapshot, compute


def _check_item(db: Session, item_id: str, part_id: str, warehouse_id: str) -> WorkOrderItem:
    item = get_or_404(db, WorkOrderItem, item_id)
    wo = get_or_404(db, WorkOrder, item.work_order_id)
    if item.part_id != part_id or wo.warehouse_id != warehouse_id:
        raise DomainError("Requirement does not belong to this part and destination")
    return item


def apply_sourcing(db: Session, actor: Actor, *, part_id: str, warehouse_id: str, release_holds: list[dict],
                   assignments: list[dict], transfers: list[dict], purchase: dict | None, op_id=None) -> dict:
    """release_holds: [{allocation_id, qty}] stock-at-another-site quantity replaced by another source.
    transfers: [{allocation_id}] to move a held quantity here, or [{work_order_item_id, inventory_record_id, qty}]
               for free stock at another site; both take an optional expected_arrival.
    assignments: [{work_order_item_id, source_type, source_id, qty}] local stock, PO lines, inbound transfers.
    purchase: {supplier_id, expected_arrival, general_stock, allocations: [{work_order_item_id, qty}]}.
    """
    if not (release_holds or assignments or transfers or purchase):
        raise DomainError("Choose at least one source")
    changes: list[str] = []
    touched: set[str] = set()

    for h in release_holds:
        alloc = lock(db, Allocation, h["allocation_id"])
        if alloc.state != "remote_hold":
            raise DomainError("Only stock at another site can be replaced")
        _check_item(db, alloc.work_order_item_id, part_id, warehouse_id)
        qty = h.get("qty") or alloc.qty
        if qty <= 0 or qty > alloc.qty:
            raise DomainError("Invalid quantity to replace")
        alloc_service.reduce(db, actor, alloc, qty, "replaced by sourcing decision", op_id)
        touched.add(alloc.work_order_item_id)
        changes.append(f"Released {qty} held at another site")

    for t in transfers:
        eta: date | None = t.get("expected_arrival")
        if t.get("allocation_id"):
            alloc = lock(db, Allocation, t["allocation_id"])
            _check_item(db, alloc.work_order_item_id, part_id, warehouse_id)
            qty, item_id = alloc.qty, alloc.work_order_item_id
            alloc_service.confirm_remote_hold(db, actor, alloc.id, eta, op_id)
        else:
            _check_item(db, t["work_order_item_id"], part_id, warehouse_id)
            hold = alloc_service.hold_remote_stock(db, actor, t["work_order_item_id"], t["inventory_record_id"],
                                                   t["qty"], op_id)
            qty, item_id = hold.qty, hold.work_order_item_id
            alloc_service.confirm_remote_hold(db, actor, hold.id, eta, op_id)
        touched.add(item_id)
        changes.append(f"Transfer of {qty} arranged")

    for a in assignments:
        _check_item(db, a["work_order_item_id"], part_id, warehouse_id)
        if a["source_type"] == "po_line" and get_or_404(db, PurchaseOrderLine, a["source_id"]).part_id != part_id:
            raise DomainError("PO line is for a different part")
        if a["source_type"] == "transfer_line" and get_or_404(db, TransferLine, a["source_id"]).part_id != part_id:
            raise DomainError("Transfer is for a different part")
        alloc_service.assign_supply(db, actor, a["work_order_item_id"], a["source_type"], a["source_id"], a["qty"], op_id)
        touched.add(a["work_order_item_id"])
        label = {"inventory": "available stock", "po_line": "on-order supply", "transfer_line": "inbound transfer"}
        changes.append(f"Allocated {a['qty']} from {label.get(a['source_type'], 'supply')}")

    po_number = None
    if purchase:
        allocs = [x for x in purchase.get("allocations", []) if x["qty"] > 0]
        for x in allocs:
            _check_item(db, x["work_order_item_id"], part_id, warehouse_id)
            touched.add(x["work_order_item_id"])
        qty = sum(x["qty"] for x in allocs) + (purchase.get("general_stock") or 0)
        if qty <= 0:
            raise DomainError("Purchase quantity must be positive")
        if not purchase.get("supplier_id"):
            raise DomainError("Select a supplier to purchase")
        result = purchasing.create_po(
            db, actor, supplier_id=purchase["supplier_id"], destination_warehouse_id=warehouse_id, op_id=op_id,
            lines=[{"part_id": part_id, "qty": qty, "expected_arrival": purchase.get("expected_arrival"),
                    "allocations": allocs}])
        po_number = result["number"]
        changes.append(f"{po_number} created for {qty}")

    db.flush()
    snap = Snapshot(db)
    r = compute(snap)
    remaining = []
    for item_id in sorted(touched):
        ir = r.items[item_id]
        remaining.append({"work_order_number": snap.wo_of(item_id).number, "short": ir.uncovered,
                          "at_other_site": ir.remote_hold, "situation": ir.state})
    return {"changes": changes, "remaining": remaining, "po_number": po_number}
