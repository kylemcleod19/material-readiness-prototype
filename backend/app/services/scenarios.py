"""Manual allocation scenarios for a shared shortage on one PO line.

Drafts live in their own tables. Preview runs the normal readiness rules over a modified
allocation list. Apply re-locks every row the draft was based on, rejects stale or
infeasible proposals, and rewrites the line's allocations in one transaction.
"""
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.models import (
    ACTIVE_STATES,
    Allocation,
    InventoryRecord,
    MaterialException,
    MaterialExceptionLink,
    PlanningScenario,
    PurchaseOrderLine,
    ScenarioAllocation,
    WorkOrder,
    WorkOrderItem,
    new_id,
)
from app.services import allocations as alloc_service
from app.services import exceptions as exc_service
from app.services import history
from app.services.common import Actor, Conflict, DomainError, get_or_404, lock, lock_all
from app.services.readiness import AllocView, Snapshot, compute
from app.services.supply import allocated_to_item, po_line_quantities
from app.services.warehouse import reconcile_line


def _claims_q(line_id: str):
    return select(Allocation).where(Allocation.po_line_id == line_id, Allocation.state.in_(ACTIVE_STATES)) \
        .order_by(Allocation.created_at)


def _pool_q(line_id: str):
    return select(InventoryRecord).where(InventoryRecord.pool_po_line_id == line_id).order_by(InventoryRecord.created_at)


def _baseline(line: PurchaseOrderLine, claims: list[Allocation], pool: list[InventoryRecord],
              items: list[WorkOrderItem]) -> dict:
    return {
        "po_line": line.version,
        "claims": {c.id: c.version for c in claims},
        "pool": {r.id: r.version for r in pool},
        "items": {i.id: i.version for i in items},
    }


def create(db: Session, actor: Actor, po_line_id: str, op_id=None) -> dict:
    existing = db.scalars(select(PlanningScenario).where(PlanningScenario.po_line_id == po_line_id,
                                                         PlanningScenario.state == "draft")).first()
    if existing:
        return {"scenario_id": existing.id}
    line = get_or_404(db, PurchaseOrderLine, po_line_id)
    claims = list(db.scalars(_claims_q(line.id)))
    if not any(c.review_required for c in claims):
        raise DomainError("This PO line has no allocation review to resolve")
    pool = list(db.scalars(_pool_q(line.id)))
    by_item: dict[str, int] = defaultdict(int)
    for c in claims:
        by_item[c.work_order_item_id] += c.qty
    items = [db.get(WorkOrderItem, i) for i in by_item]
    sc = PlanningScenario(id=new_id("sc"), po_line_id=line.id, state="draft", owner=actor.name,
                          baseline=_baseline(line, claims, pool, items))
    db.add(sc)
    db.flush()
    for item_id, claimed in by_item.items():
        # Start from the existing claims so the infeasibility is visible before any edit.
        db.add(ScenarioAllocation(id=new_id("sca"), scenario_id=sc.id, work_order_item_id=item_id,
                                  available_qty=claimed, incoming_qty=0, claimed_qty=claimed))
    db.flush()
    history.record(db, actor, sc, "scenario.create", after={"po_line_id": line.id}, op_id=op_id)
    return {"scenario_id": sc.id}


def update(db: Session, actor: Actor, scenario_id: str, proposals: list[dict]) -> dict:
    sc = lock(db, PlanningScenario, scenario_id)
    if sc.state != "draft":
        raise DomainError("Scenario is no longer a draft")
    rows = {r.work_order_item_id: r for r in db.scalars(select(ScenarioAllocation)
                                                         .where(ScenarioAllocation.scenario_id == sc.id))}
    for p in proposals:
        row = rows.get(p["work_order_item_id"])
        if row is None:
            raise DomainError("Requirement is not part of this scenario")
        if p["available_qty"] < 0 or p["incoming_qty"] < 0:
            raise DomainError("Quantities cannot be negative")
        row.available_qty = p["available_qty"]
        row.incoming_qty = p["incoming_qty"]
    return {"scenario_id": sc.id}


def _is_stale(db: Session, sc: PlanningScenario) -> bool:
    line = db.get(PurchaseOrderLine, sc.po_line_id)
    claims = list(db.scalars(_claims_q(line.id)))
    pool = list(db.scalars(_pool_q(line.id)))
    items = [db.get(WorkOrderItem, i) for i in sc.baseline["items"]]
    return _baseline(line, claims, pool, items) != sc.baseline


def _validate(proposals: list[ScenarioAllocation], available_supply: int, incoming_supply: int,
              need_by_item: dict[str, int], names: dict[str, str] | None = None) -> list[str]:
    errors = []
    available = sum(p.available_qty for p in proposals)
    incoming = sum(p.incoming_qty for p in proposals)
    if available > available_supply:
        errors.append(f"Proposed {available} from available stock, but only {available_supply} units are available")
    if incoming > incoming_supply:
        errors.append(f"Proposed {incoming} from on-order supply, but only {incoming_supply} are still on order")
    for p in proposals:
        need = need_by_item[p.work_order_item_id]
        if p.available_qty + p.incoming_qty > need:
            name = (names or {}).get(p.work_order_item_id, "A work order")
            errors.append(f"{name} only needs {need} more from this supply")
    return errors


def preview(db: Session, scenario_id: str) -> dict:
    sc = get_or_404(db, PlanningScenario, scenario_id)
    props = list(db.scalars(select(ScenarioAllocation).where(ScenarioAllocation.scenario_id == sc.id)))
    snap = Snapshot(db)
    live = compute(snap)
    line = snap.lines[sc.po_line_id]
    q = live.line_quantities[line.id]
    pooled_accepted = [r for r in snap.pooled_by_line.get(line.id, []) if r.quality_state == "accepted"]

    # Live allocations minus this line's claims, plus the draft's proposed sources.
    base = [a for a in snap.allocs if not (a.source_type == "po_line" and a.source_id == line.id)]
    need = {p.work_order_item_id: snap.items[p.work_order_item_id].required_qty
            - sum(a.qty for a in base if a.item_id == p.work_order_item_id) for p in props}
    synthetic: list[AllocView] = []
    rooms = [[r.id, r.qty] for r in pooled_accepted]
    for p in props:
        left = p.available_qty
        for room in rooms:
            if left <= 0:
                break
            take = min(room[1], left)
            if take > 0:
                synthetic.append(AllocView(f"draft-{p.id}-{room[0]}", p.work_order_item_id, take, "committed", False,
                                           "inventory", room[0]))
                room[1] -= take
                left -= take
        if left > 0:  # infeasible available remainder: show it as unresolved review, not as stock
            synthetic.append(AllocView(f"draft-{p.id}-over", p.work_order_item_id, left, "committed", True,
                                       "po_line", line.id))
        if p.incoming_qty:
            synthetic.append(AllocView(f"draft-{p.id}-in", p.work_order_item_id, p.incoming_qty, "committed", False,
                                       "po_line", line.id))
    draft = compute(snap, base + synthetic, cleared_pools=frozenset({line.id}))
    names = {p.work_order_item_id: snap.wo_of(p.work_order_item_id).number for p in props}
    errors = _validate(props, q.pooled_accepted, q.incoming, need, names)
    stale = sc.state == "draft" and _is_stale(db, sc)

    rows = []
    for p in props:
        item = snap.items[p.work_order_item_id]
        wo = snap.work_orders[item.work_order_id]
        lv, dv = live.items[item.id], draft.items[item.id]
        rows.append({
            "work_order_item_id": item.id, "work_order_id": wo.id, "work_order_number": wo.number,
            "work_order_title": wo.title, "production_start_date": wo.production_start_date,
            "required_qty": item.required_qty, "allocated_qty": p.claimed_qty,
            "proposed_available_qty": p.available_qty, "proposed_incoming_qty": p.incoming_qty,
            "max_from_source": need[item.id],
            "live": _item_brief(lv), "preview": _item_brief(dv),
        })
    rows.sort(key=lambda r: r["production_start_date"])
    part = snap.parts[line.part_id]
    po = snap.pos[line.po_id]
    return {
        "scenario_id": sc.id, "state": sc.state, "stale": stale, "feasible": not errors, "errors": errors,
        "po_line_id": line.id, "po_id": po.id, "label": snap.line_label(line.id), "part_number": part.part_number,
        "description": part.description, "supplier": snap.suppliers[po.supplier_id].name, "uom": part.uom,
        "owner": sc.owner, "warehouse": snap.warehouses[po.destination_warehouse_id].name,
        "supply": {"available": q.pooled_accepted, "incoming": q.incoming, "allocated": q.claims, "short": q.deficit},
        "proposed": {"available": sum(p.available_qty for p in props), "incoming": sum(p.incoming_qty for p in props)},
        "rows": rows,
    }


def _item_brief(ir) -> dict:
    return {"available": ir.available, "incoming": ir.incoming, "review": ir.review, "uncovered": ir.uncovered,
            "staged": ir.staged, "timing": ir.timing, "state": ir.state}


def apply(db: Session, actor: Actor, scenario_id: str, op_id=None) -> dict:
    sc = lock(db, PlanningScenario, scenario_id)
    if sc.state != "draft":
        raise Conflict(f"Scenario already {sc.state}")
    line = lock(db, PurchaseOrderLine, sc.po_line_id)
    claims = lock_all(db, _claims_q(line.id))
    pool = lock_all(db, _pool_q(line.id))
    items = [lock(db, WorkOrderItem, i) for i in sc.baseline["items"]]
    if _baseline(line, claims, pool, items) != sc.baseline:
        raise Conflict("Supply or allocations changed since this scenario was drafted. Refresh and review before applying.")

    props = list(db.scalars(select(ScenarioAllocation).where(ScenarioAllocation.scenario_id == sc.id)))
    q = po_line_quantities(db, line)
    claimed_by_item: dict[str, int] = defaultdict(int)
    for c in claims:
        claimed_by_item[c.work_order_item_id] += c.qty
    need = {i.id: i.required_qty - (allocated_to_item(db, i.id) - claimed_by_item[i.id]) for i in items}
    names = {i.id: db.get(WorkOrder, i.work_order_id).number for i in items}
    errors = _validate(props, q.pooled_accepted, q.incoming, need, names)
    if errors:
        raise DomainError("; ".join(errors))

    reason = f"scenario {sc.id} applied"
    for c in claims:
        alloc_service.release(db, actor, c, reason, op_id)
    accepted = [r for r in pool if r.quality_state == "accepted"]
    rooms = {r.id: r.qty for r in accepted}
    for p in props:
        left = p.available_qty
        for r in accepted:
            take = min(rooms[r.id], left)
            if take > 0:
                alloc_service._new_allocation(db, actor, p.work_order_item_id, take, "committed",
                                              inventory_record_id=r.id, note=reason, op_id=op_id)
                rooms[r.id] -= take
                left -= take
        if p.incoming_qty:
            alloc_service._new_allocation(db, actor, p.work_order_item_id, p.incoming_qty, "committed",
                                          po_line_id=line.id, note=reason, op_id=op_id)
    # The decision is made: accepted units not assigned become free stock.
    for r in accepted:
        r.pool_po_line_id = None
    db.flush()
    reconcile_line(db, actor, line.id, op_id)

    sc.state = "applied"
    sc.applied_at = clock.now()
    history.record(db, actor, sc, "scenario.apply",
                   after={"proposals": [{"item": p.work_order_item_id, "available": p.available_qty,
                                         "incoming": p.incoming_qty} for p in props]}, op_id=op_id)
    item_ids = {i.id for i in items}
    linked = db.scalars(select(MaterialException).join(MaterialExceptionLink,
                                                       MaterialExceptionLink.exception_id == MaterialException.id)
                        .where(MaterialExceptionLink.work_order_item_id.in_(item_ids),
                               MaterialException.state != "closed").distinct()).all()
    for exc in linked:
        exc_service.append_note(db, actor, exc, f"Allocation plan applied ({sc.id}) by {actor.name}.", op_id)
    return {"scenario_id": sc.id, "state": sc.state}


def discard(db: Session, actor: Actor, scenario_id: str) -> dict:
    sc = lock(db, PlanningScenario, scenario_id)
    if sc.state != "draft":
        raise DomainError(f"Scenario already {sc.state}")
    sc.state = "discarded"
    history.record(db, actor, sc, "scenario.discard", {"state": "draft"}, {"state": "discarded"})
    return {"scenario_id": sc.id, "state": sc.state}


def refresh(db: Session, actor: Actor, scenario_id: str) -> dict:
    """Re-baseline a stale draft against current state, keeping proposals for items still involved."""
    sc = lock(db, PlanningScenario, scenario_id)
    if sc.state != "draft":
        raise DomainError(f"Scenario already {sc.state}")
    line = get_or_404(db, PurchaseOrderLine, sc.po_line_id)
    claims = list(db.scalars(_claims_q(line.id)))
    pool = list(db.scalars(_pool_q(line.id)))
    by_item: dict[str, int] = defaultdict(int)
    for c in claims:
        by_item[c.work_order_item_id] += c.qty
    rows = {r.work_order_item_id: r for r in db.scalars(select(ScenarioAllocation)
                                                         .where(ScenarioAllocation.scenario_id == sc.id))}
    for item_id, row in rows.items():
        if item_id not in by_item:
            db.delete(row)
        else:
            row.claimed_qty = by_item[item_id]
    for item_id, claimed in by_item.items():
        if item_id not in rows:
            db.add(ScenarioAllocation(id=new_id("sca"), scenario_id=sc.id, work_order_item_id=item_id,
                                      available_qty=0, incoming_qty=0, claimed_qty=claimed))
    sc.baseline = _baseline(line, claims, pool, [db.get(WorkOrderItem, i) for i in by_item])
    if not by_item:
        sc.state = "discarded"
    history.record(db, actor, sc, "scenario.refresh")
    return {"scenario_id": sc.id, "state": sc.state}
