"""Read models for each role's screens. All numbers come from readiness.compute()."""
from collections import defaultdict
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChangeHistory, PartStockPolicy, PlanningScenario
from app.services.common import NotFound
from app.services.readiness import Readiness, Snapshot, allocation_decisions, compute, work_order_status


def _load(db: Session) -> tuple[Snapshot, Readiness]:
    snap = Snapshot(db)
    return snap, compute(snap)


def _wh(snap: Snapshot, wh_id: str) -> dict:
    w = snap.warehouses[wh_id]
    return {"id": w.id, "code": w.code, "name": w.name}


def _checkin_status(snap: Snapshot, due) -> str:
    if due < snap.today:
        return "overdue"
    return "due" if due == snap.today else "upcoming"


def _supplier(snap: Snapshot, part_id: str) -> dict | None:
    part = snap.parts[part_id]
    if not part.preferred_supplier_id:
        return None
    return {"id": part.preferred_supplier_id, "name": snap.suppliers[part.preferred_supplier_id].name}


def _free_stock(snap: Snapshot, r: Readiness, part_id: str, wh_id: str) -> list[tuple]:
    """(record, quantity available to allocate) for accepted local stock not allocated, staged, or in transfer."""
    out = []
    for rec in snap.inventory.values():
        if rec.part_id == part_id and rec.warehouse_id == wh_id and snap.is_free_stock(rec):
            free = snap.free_qty(rec, r.allocs)
            if free > 0:
                out.append((rec, free))
    return out


def _assignable(snap: Snapshot, r: Readiness, part_id: str, wh_id: str) -> int:
    """Available to allocate plus unallocated on order at one site."""
    free_po = sum(r.line_quantities[lid].unallocated for lid, line in snap.lines.items()
                  if line.part_id == part_id and snap.pos[line.po_id].destination_warehouse_id == wh_id
                  and snap.pos[line.po_id].status == "open")
    return sum(q for _, q in _free_stock(snap, r, part_id, wh_id)) + free_po


def _enrich(snap: Snapshot, a: dict | None) -> dict | None:
    """Add the labels an action button needs so it opens with its context preselected (PRD §4.18)."""
    if not a:
        return a
    a = dict(a)
    kind = a["kind"]
    if kind == "source_material":
        a["warehouse"] = _wh(snap, a["warehouse_id"])
        a["part_number"] = snap.parts[a["part_id"]].part_number
    elif kind == "allocate_material":
        a["po_line_label"] = snap.line_label(a["po_line_id"])
    elif kind == "record_supplier_update":
        a["po_number"] = snap.pos[a["po_id"]].number
        a["target_label"] = (snap.shipments[a["target_id"]].number if a["target_type"] == "shipment"
                             else snap.line_label(a["target_id"]))
    elif kind == "receive" and a.get("shipment_id"):
        a["shipment_number"] = snap.shipments[a["shipment_id"]].number
    return a


def _wo_summary(snap: Snapshot, r: Readiness, wo) -> dict:
    st = work_order_status(snap, r, wo)
    st["next_actions"] = [_enrich(snap, a) for a in st["next_actions"]]
    fixtures = snap.fixtures_by_wo.get(wo.id, [])
    item_ids = {i.id for i in snap.items_by_wo.get(wo.id, [])}
    open_exc = {e.id for iid in item_ids for e in snap.exceptions_by_item.get(iid, []) if e.state != "closed"}
    return {
        "id": wo.id, "number": wo.number, "title": wo.title, "program": snap.programs[wo.program_id].name,
        "warehouse": _wh(snap, wo.warehouse_id), "production_start_date": wo.production_start_date,
        "created_at": wo.created_at, "days_to_start": (wo.production_start_date - snap.today).days,
        "state": wo.state, "build_qty": wo.build_qty, **st, "action_count": len(st["next_actions"]),
        "fixtures": {"total": len(fixtures), "covered": sum(f.coverage_state == "covered" for f in fixtures)},
        "open_exceptions": len(open_exc),
    }


def work_orders(db: Session) -> list[dict]:
    snap, r = _load(db)
    rows = [_wo_summary(snap, r, wo) for wo in snap.work_orders.values()]
    order = {"finalized": 0, "draft": 1, "canceled": 2}
    rows.sort(key=lambda x: (order[x["state"]], x["production_start_date"]))
    return rows


ISSUE_LABELS = {
    "qa_rejection": "QA rejection", "supply_deficit": "Short delivery", "over_receipt": "Over-receipt",
    "unmatched_receipt": "Unmatched receipt", "picking_discrepancy": "Missing stock", "demand_change": "Demand change",
}


def _exception_dict(snap: Snapshot, e) -> dict:
    links = []
    for l in snap.exception_links.get(e.id, []):
        item = snap.items[l.work_order_item_id]
        wo = snap.work_orders[item.work_order_id]
        links.append({"work_order_item_id": item.id, "work_order_id": wo.id, "work_order_number": wo.number,
                      "production_start_date": wo.production_start_date, "claimed_qty": l.claimed_qty,
                      "part_number": snap.parts[item.part_id].part_number})
    return {
        "id": e.id, "type": e.type, "label": ISSUE_LABELS.get(e.type, e.type), "state": e.state, "title": e.title,
        "detail": e.detail, "source_type": e.source_type, "source_id": e.source_id, "affected_qty": e.affected_qty,
        "blocking": e.blocking, "owner_role": e.owner_role, "raised_by": e.raised_by, "created_at": e.created_at,
        "resolution_note": e.resolution_note, "closed_at": e.closed_at,
        "part_number": snap.parts[e.part_id].part_number if e.part_id else None,
        "links": sorted(links, key=lambda x: x["production_start_date"]),
    }


def work_order_detail(db: Session, wo_id: str) -> dict:
    snap, r = _load(db)
    wo = snap.work_orders.get(wo_id)
    if wo is None:
        raise NotFound("Work order not found")
    items = []
    for item in snap.items_by_wo.get(wo.id, []):
        ir = r.items[item.id]
        d = asdict(ir)
        d["situations"] = [{**s, "action": _enrich(snap, s["action"])} for s in ir.situations]
        d["situation"] = d["situations"][0]
        d["action"] = d["situation"]["action"]
        d["needs_attention"] = d["action"] is not None
        if wo.state == "draft":
            d["available_to_allocate"] = sum(q for _, q in _free_stock(snap, r, item.part_id, wo.warehouse_id))
        items.append(d)
    exc_ids = {eid for i in items for eid in i["exceptions"]}
    hist_ids = {wo.id} | {i["item_id"] for i in items} | {s["allocation_id"] for i in items for s in i["sources"]}
    history_rows = db.scalars(select(ChangeHistory).where(ChangeHistory.entity_id.in_(hist_ids))
                              .order_by(ChangeHistory.at.desc(), ChangeHistory.id.desc()).limit(40)).all()
    return {
        **_wo_summary(snap, r, wo),
        "items": items,
        "fixture_requirements": [{"id": f.id, "operation": f.operation, "fixture_type": f.fixture_type,
                                  "quantity": f.quantity, "coverage_state": f.coverage_state, "note": f.note,
                                  "reviewed_by": f.reviewed_by, "reviewed_at": f.reviewed_at}
                                 for f in snap.fixtures_by_wo.get(wo.id, [])],
        "exceptions": [_exception_dict(snap, snap.exceptions[e]) for e in exc_ids],
        "history": [_history_dict(h) for h in history_rows],
        "cancel_reason": wo.cancel_reason,
    }


HISTORY_LABELS = {
    "work_order.create": "Work order created", "work_order.finalize": "Finalized; local stock allocated",
    "work_order.cancel": "Canceled", "allocation.release": "Allocation released",
    "allocation.review_flag": "Allocation decision flag changed", "fixture.review": "Fixture coverage recorded",
    "exception.raise": "Issue raised", "exception.close": "Issue closed", "exception.note": "Issue note added",
    "arrival.update": "Expected arrival updated", "scenario.apply": "Allocation plan applied",
}


def _history_text(h: ChangeHistory) -> str:
    """A readable sentence instead of raw before/after JSON."""
    a, b = h.after or {}, h.before or {}
    if h.action == "allocation.create":
        text = f"Allocated {a.get('qty')}" + (" (stock at another site)" if a.get("state") == "remote_hold" else "")
    elif h.action == "allocation.reduce":
        text = f"Allocation reduced from {b.get('qty')} to {a.get('qty')}"
    elif h.action == "work_order_item.reduce":
        text = f"Requirement reduced from {b.get('required_qty')} to {a.get('required_qty')}"
    elif h.action == "arrival.update":
        text = f"Expected arrival {b.get('expected_arrival') or 'unknown'} → {a.get('expected_arrival') or 'unknown'}"
    else:
        text = HISTORY_LABELS.get(h.action, h.action.replace("_", " ").replace(".", ": "))
    return f"{text} — {h.note}" if h.note and h.note not in text else text


def _history_dict(h: ChangeHistory) -> dict:
    return {"id": h.id, "at": h.at, "actor": h.actor, "role": h.role, "channel": h.channel,
            "entity_type": h.entity_type, "entity_id": h.entity_id, "action": h.action,
            "summary": _history_text(h), "note": h.note}


# ---------------------------------------------------------------- purchasing: three decision queues (PRD §4.17)


def _replenishment(db: Session, snap: Snapshot, r: Readiness) -> list[dict]:
    policies = {(p.part_id, p.warehouse_id): p for p in db.scalars(select(PartStockPolicy))}
    keys = set(policies)
    for part in snap.parts.values():
        if part.default_reorder_point is not None:
            for rec in snap.inventory.values():
                if rec.part_id == part.id:
                    keys.add((part.id, rec.warehouse_id))
    out = []
    for part_id, wh_id in sorted(keys):
        part = snap.parts[part_id]
        pol = policies.get((part_id, wh_id))
        reorder = pol.reorder_point if pol else part.default_reorder_point
        target = pol.target_level if pol else part.default_target_level
        if reorder is None or target is None:
            continue
        free = sum(q for _, q in _free_stock(snap, r, part_id, wh_id))
        incoming = sum(r.line_quantities[lid].unallocated for lid, line in snap.lines.items()
                       if line.part_id == part_id and snap.pos[line.po_id].destination_warehouse_id == wh_id
                       and snap.pos[line.po_id].status == "open")
        projected = free + incoming
        if projected >= reorder:
            continue
        out.append({"part_id": part_id, "warehouse_id": wh_id, "available_to_allocate": free,
                    "unallocated_on_order": incoming, "reorder_point": reorder, "target_level": target,
                    "suggested_qty": target - projected})
    return out


def _requirement_row(snap: Snapshot, ir) -> dict:
    wo = snap.work_orders[ir.work_order_id]
    holds = [s for s in ir.sources if s.category == "remote_hold"]
    reasons = (["short"] if ir.uncovered else []) + (["stock_at_other_site"] if ir.remote_hold else [])
    return {
        "work_order_item_id": ir.item_id, "work_order_id": wo.id, "work_order_number": wo.number,
        "work_order_title": wo.title, "created_at": wo.created_at, "production_start_date": wo.production_start_date,
        "warehouse": _wh(snap, wo.warehouse_id), "part_id": ir.part_id, "part_number": ir.part_number,
        "description": ir.description, "supplier": _supplier(snap, ir.part_id), "required": ir.required,
        "short": ir.uncovered, "at_other_site": ir.remote_hold, "reasons": reasons,
        "remote_holds": [{"allocation_id": s.allocation_id, "qty": s.qty, "warehouse": _wh(snap, s.warehouse)}
                         for s in holds],
    }


def _source_material(db: Session, snap: Snapshot, r: Readiness) -> dict:
    """Short requirements, stock-at-another-site decisions, and replenishment, by part and destination."""
    rows = []
    for ir in r.items.values():
        if snap.work_orders[ir.work_order_id].state == "finalized" and (ir.uncovered or ir.remote_hold):
            rows.append(_requirement_row(snap, ir))
    rows.sort(key=lambda x: (x["production_start_date"], x["work_order_number"]))
    groups: dict[tuple, dict] = {}

    def group(part_id, wh_id):
        part = snap.parts[part_id]
        return groups.setdefault((part_id, wh_id), {
            "part_id": part_id, "part_number": part.part_number, "description": part.description,
            "warehouse": _wh(snap, wh_id), "supplier": _supplier(snap, part_id), "lead_time_days": part.lead_time_days,
            "short": 0, "at_other_site": 0, "replenishment": 0, "reasons": [], "requirements": [],
            "available_to_allocate": sum(q for _, q in _free_stock(snap, r, part_id, wh_id)),
            "unallocated_on_order": sum(r.line_quantities[lid].unallocated for lid, line in snap.lines.items()
                                        if line.part_id == part_id and snap.pos[line.po_id].status == "open"
                                        and snap.pos[line.po_id].destination_warehouse_id == wh_id),
        })

    for row in rows:
        g = group(row["part_id"], row["warehouse"]["id"])
        g["short"] += row["short"]
        g["at_other_site"] += row["at_other_site"]
        g["requirements"].append(row)
        g["reasons"] = sorted(set(g["reasons"]) | set(row["reasons"]))
    for rep in _replenishment(db, snap, r):
        g = group(rep["part_id"], rep["warehouse_id"])
        g["replenishment"] = rep["suggested_qty"]
        g["reasons"] = sorted(set(g["reasons"]) | {"replenishment"})
    out = []
    for g in groups.values():
        g["to_source"] = g["short"] + g["at_other_site"] + g["replenishment"]
        g["earliest_start"] = g["requirements"][0]["production_start_date"] if g["requirements"] else None
        out.append(g)
    out.sort(key=lambda g: (g["earliest_start"] is None, g["earliest_start"] or snap.today, g["part_number"]))
    return {"groups": out, "requirements": rows}


def sourcing_options(db: Session, part_id: str, warehouse_id: str) -> dict:
    """Everything that could cover one part at one destination, for the Source material panel (PRD §4.2)."""
    snap, r = _load(db)
    if part_id not in snap.parts or warehouse_id not in snap.warehouses:
        raise NotFound("Part or warehouse not found")
    part = snap.parts[part_id]
    requirements = [_requirement_row(snap, ir) for ir in r.items.values()
                    if ir.part_id == part_id and snap.work_orders[ir.work_order_id].state == "finalized"
                    and snap.work_orders[ir.work_order_id].warehouse_id == warehouse_id and (ir.uncovered or ir.remote_hold)]
    requirements.sort(key=lambda x: x["production_start_date"])
    local = [{"source_type": "inventory", "source_id": rec.id, "label": f"{snap.warehouses[rec.warehouse_id].code} · {rec.location}",
              "lot": rec.lot, "qty": free} for rec, free in _free_stock(snap, r, part_id, warehouse_id)]
    on_order = []
    for lid, line in snap.lines.items():
        po = snap.pos[line.po_id]
        q = r.line_quantities[lid]
        if line.part_id != part_id or po.destination_warehouse_id != warehouse_id or po.status != "open" or q.unallocated <= 0:
            continue
        etas = sorted({b.eta for b in q.buckets if not b.arrived}, key=lambda d: (d is None, d))
        on_order.append({"source_type": "po_line", "source_id": lid, "label": snap.line_label(lid), "po_id": po.id,
                         "supplier": snap.suppliers[po.supplier_id].name, "qty": q.unallocated,
                         "expected_arrival": etas[0] if len(etas) == 1 else None, "multiple_arrivals": len(etas) > 1})
    transfers = []
    for t in snap.transfers.values():
        used = sum(a.qty for a in r.allocs if a.source_type == "transfer_line" and a.source_id == t.id)
        if t.part_id == part_id and t.dest_warehouse_id == warehouse_id and t.status in ("planned", "in_transit") and t.qty > used:
            transfers.append({"source_type": "transfer_line", "source_id": t.id, "label": f"Transfer from {snap.warehouses[t.source_warehouse_id].name}",
                              "qty": t.qty - used, "expected_arrival": t.expected_arrival})
    other_sites = []
    for wh_id in snap.warehouses:
        if wh_id == warehouse_id:
            continue
        for rec, free in _free_stock(snap, r, part_id, wh_id):
            other_sites.append({"inventory_record_id": rec.id, "warehouse": _wh(snap, wh_id), "qty": free})
    replenishment = next((x["suggested_qty"] for x in _replenishment(db, snap, r)
                          if x["part_id"] == part_id and x["warehouse_id"] == warehouse_id), 0)
    return {
        "part": {"id": part.id, "part_number": part.part_number, "description": part.description, "uom": part.uom,
                 "lead_time_days": part.lead_time_days},
        "warehouse": _wh(snap, warehouse_id), "supplier": _supplier(snap, part_id),
        "requirements": requirements, "available_to_allocate": local, "on_order": on_order + transfers,
        "other_sites": other_sites, "replenishment": replenishment,
    }


def _arrival_targets(snap: Snapshot, r: Readiness, po) -> list[dict]:
    """The shipment and unshipped PO-line quantities whose expected arrival a supplier update can change."""
    out = []
    for line in snap.lines_by_po[po.id]:
        q = r.line_quantities[line.id]
        part = snap.parts[line.part_id]
        for qty_open, eta, number, sh_id in snap.open_shipments(line.id):
            sh = snap.shipments[sh_id]
            if qty_open > 0 and sh.status != "arrived":
                out.append({"target_type": "shipment", "target_id": sh_id, "label": f"{number} · {part.part_number}",
                            "qty": qty_open, "expected_arrival": eta, "basis": sh.arrival_basis})
        if q.unshipped > 0:
            out.append({"target_type": "po_line", "target_id": line.id, "label": f"{snap.line_label(line.id)} not yet shipped · {part.part_number}",
                        "qty": q.unshipped, "expected_arrival": line.expected_arrival, "basis": line.arrival_basis})
    return out


def _supplier_follow_up(snap: Snapshot, r: Readiness) -> list[dict]:
    """One item per PO, with every reason it needs supplier contact (PRD §4.15, §4.17)."""
    reasons_by_po: dict[str, list[dict]] = defaultdict(list)
    for t in snap.checkins:
        status = _checkin_status(snap, t.due_date)
        if t.state == "open" and status != "upcoming":
            reasons_by_po[t.po_id].append({"type": "check_in", "status": status, "date": t.due_date,
                                           "task_id": t.id, "note": t.note})
    for ir in r.items.values():
        wo = snap.work_orders[ir.work_order_id]
        for s in ir.situations:
            a = s["action"] or {}
            if s["kind"] in ("arrives_late", "arrival_unknown") and a.get("po_id"):
                reasons_by_po[a["po_id"]].append({
                    "type": "late_arrival" if s["kind"] == "arrives_late" else "unknown_arrival",
                    "qty": s["qty"], "date": s["date"], "part_number": ir.part_number,
                    "work_order_id": wo.id, "work_order_number": wo.number,
                    "production_start_date": wo.production_start_date,
                    "target_type": a["target_type"], "target_id": a["target_id"]})
    for po in snap.pos.values():
        if po.needs_review:
            reasons_by_po[po.id].append({"type": "po_review", "note": po.review_note})
    order = {"late_arrival": 0, "check_in": 1, "unknown_arrival": 2, "po_review": 3}
    out = []
    for po_id, reasons in reasons_by_po.items():
        po = snap.pos[po_id]
        reasons.sort(key=lambda x: order[x["type"]])
        open_checkins = [t for t in snap.checkins if t.po_id == po.id and t.state == "open"]
        out.append({
            "po_id": po.id, "po_number": po.number, "supplier": snap.suppliers[po.supplier_id].name,
            "destination": _wh(snap, po.destination_warehouse_id), "reasons": reasons,
            "next_checkin": min((t.due_date for t in open_checkins), default=None),
            "open_checkin_ids": [t.id for t in open_checkins if _checkin_status(snap, t.due_date) != "upcoming"],
            "earliest_start": min((x["production_start_date"] for x in reasons if x.get("production_start_date")), default=None),
            "targets": _arrival_targets(snap, r, po), "needs_review": po.needs_review,
        })
    out.sort(key=lambda x: (order[x["reasons"][0]["type"]], x["earliest_start"] is None, x["earliest_start"] or snap.today))
    return out


def purchasing_queue(db: Session) -> dict:
    snap, r = _load(db)
    source = _source_material(db, snap, r)
    follow_up = _supplier_follow_up(snap, r)
    drafts = {s.po_line_id: s.id for s in db.scalars(select(PlanningScenario).where(PlanningScenario.state == "draft"))}
    allocate = [{**s, "draft_scenario_id": drafts.get(s["po_line_id"])} for s in allocation_decisions(snap, r)]
    return {
        "today": snap.today,
        "counts": {"source_material": len(source["groups"]), "supplier_follow_up": len(follow_up),
                   "allocate_material": len(allocate),
                   "issues": sum(e.state != "closed" for e in snap.exceptions.values()),
                   "pos_review": sum(p.needs_review for p in snap.pos.values())},
        "source_material": source,
        "supplier_follow_up": follow_up,
        "allocate_material": allocate,
    }


def _inventory_rollup(snap: Snapshot, r: Readiness, part_id: str | None = None) -> list[dict]:
    """Summaries aggregated from inventory records; never a separately stored balance. Scrap is not inventory."""
    alloc_by_rec: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for a in r.allocs:
        if a.source_type == "inventory":
            alloc_by_rec[a.source_id][a.state] += a.qty
    rows: dict[tuple, dict] = {}
    for rec in snap.inventory.values():
        if (part_id and rec.part_id != part_id) or rec.qty == 0 or rec.quality_state == "scrapped":
            continue
        key = (rec.part_id, rec.warehouse_id)
        row = rows.setdefault(key, {
            "part_id": rec.part_id, "part_number": snap.parts[rec.part_id].part_number,
            "warehouse": _wh(snap, rec.warehouse_id), "in_qa": 0, "available": 0, "allocated": 0,
            "held_for_other_site": 0, "free": 0, "staged": 0, "in_transfer": 0, "awaiting_handoff": 0,
        })
        if rec.quality_state == "pending":
            row["in_qa"] += rec.qty
            continue
        row["available"] += rec.qty
        if rec.stage == "staged":
            row["staged"] += rec.qty
        if rec.reserved_transfer_line_id:
            row["in_transfer"] += rec.qty
        elif rec.pool_po_line_id:
            row["awaiting_handoff"] += rec.qty
        else:
            committed = alloc_by_rec[rec.id]["committed"]
            held = alloc_by_rec[rec.id]["remote_hold"]
            row["allocated"] += committed
            row["held_for_other_site"] += held
            if rec.stage in ("received", "stored"):
                row["free"] += rec.qty - committed - held
    return sorted(rows.values(), key=lambda x: (x["part_number"], x["warehouse"]["code"]))


def inventory(db: Session) -> dict:
    snap, r = _load(db)
    records = []
    for rec in sorted(snap.inventory.values(), key=lambda x: (snap.parts[x.part_id].part_number, x.warehouse_id, x.id)):
        if rec.qty == 0 or rec.quality_state == "scrapped":
            continue
        allocs = [a for a in r.allocs if a.source_type == "inventory" and a.source_id == rec.id]
        records.append({
            "id": rec.id, "part_number": snap.parts[rec.part_id].part_number, "warehouse": _wh(snap, rec.warehouse_id),
            "location": rec.location, "lot": rec.lot, "qty": rec.qty,
            "status": "in_qa" if rec.quality_state == "pending" else "available",
            "stage": rec.stage, "pooled_for": snap.line_label(rec.pool_po_line_id) if rec.pool_po_line_id else None,
            "reserved_for_transfer": rec.reserved_transfer_line_id,
            "origin": snap.line_label(rec.origin_po_line_id) if rec.origin_po_line_id else "opening stock",
            "allocations": [{"allocation_id": a.id, "qty": a.qty, "state": a.state, "review": a.review,
                             "work_order_number": snap.wo_of(a.item_id).number} for a in allocs],
        })
    return {"summary": _inventory_rollup(snap, r), "records": records}


# ---------------------------------------------------------------- POs


def purchase_orders(db: Session) -> list[dict]:
    snap, r = _load(db)
    return [_po_dict(snap, r, po) for po in sorted(snap.pos.values(), key=lambda p: p.number)]


def purchase_order(db: Session, po_id: str) -> dict:
    snap, r = _load(db)
    po = snap.pos.get(po_id)
    if po is None:
        raise NotFound("PO not found")
    return _po_dict(snap, r, po, detail=True)


def _line_issue(snap: Snapshot, r: Readiness, line, q, claims: list[dict]) -> str | None:
    """The one issue worth showing in the PO line table; details live in the expanded row."""
    if q.deficit:
        return f"Short {q.deficit} against allocations"
    if q.pooled_accepted and len(claims) > 1:
        return f"{q.pooled_accepted} received — allocation decision needed"
    late = sum(c["late_qty"] for c in claims)
    if late:
        return f"{late} arrive after production start"
    if any(c["timing"] == "unknown" for c in claims):
        return "Arrival date unknown"
    if q.pooled_pending:
        return f"{q.pooled_pending} awaiting QA"
    if any(b.stage == "awaiting_receipt" for b in q.buckets):
        return "Arrived — awaiting receipt"
    return None


def _po_dict(snap: Snapshot, r: Readiness, po, detail: bool = False) -> dict:
    lines = []
    for line in snap.lines_by_po[po.id]:
        q = r.line_quantities[line.id]
        part = snap.parts[line.part_id]
        claims = []
        for a in r.allocs:
            if a.source_type == "po_line" and a.source_id == line.id:
                item = snap.items[a.item_id]
                wo = snap.work_orders[item.work_order_id]
                src = next(s for s in r.items[item.id].sources if s.allocation_id == a.id)
                claims.append({"allocation_id": a.id, "work_order_id": wo.id, "work_order_number": wo.number,
                               "production_start_date": wo.production_start_date, "qty": a.qty,
                               "review": a.review, "timing": src.timing, "late_qty": src.late_qty})
        shipments = []
        for qty_open, eta, number, sh_id in snap.open_shipments(line.id):
            sh = snap.shipments[sh_id]
            sl = next(x for x in snap.sls_by_line[line.id] if x.shipment_id == sh_id)
            shipments.append({"shipment_id": sh.id, "shipment_line_id": sl.id, "number": sh.number,
                              "status": sh.status, "qty": sl.qty, "open_qty": qty_open,
                              "expected_arrival": sh.expected_arrival, "arrival_basis": sh.arrival_basis,
                              "arrival_channel": sh.arrival_channel, "arrival_updated_at": sh.arrival_updated_at,
                              "carrier": sh.carrier, "tracking_number": sh.tracking_number, "carrier_eta": sh.carrier_eta})
        etas = sorted({b.eta for b in q.buckets if not b.arrived}, key=lambda d: (d is None, d))
        lines.append({
            "id": line.id, "line_no": line.line_no, "label": snap.line_label(line.id), "part_id": part.id,
            "part_number": part.part_number, "description": part.description, "uom": part.uom,
            "ordered": q.ordered, "canceled": q.canceled, "closed_shortfall": q.shortfall, "received": q.received,
            "outstanding": q.outstanding, "in_transit": q.in_transit, "unshipped": q.unshipped,
            "awaiting_qa": q.pooled_pending, "received_unassigned": q.pooled_accepted, "allocated": q.claims,
            "unallocated": q.unallocated, "deficit": q.deficit,
            "next_arrival": etas[0] if len(etas) == 1 else None, "multiple_arrivals": len(etas) > 1,
            "issue": _line_issue(snap, r, line, q, claims),
            "expected_arrival": line.expected_arrival, "arrival_basis": line.arrival_basis,
            "arrival_channel": line.arrival_channel, "arrival_updated_at": line.arrival_updated_at,
            "supplier_promised_date": line.supplier_promised_date, "acknowledged_at": line.acknowledged_at,
            "allocations": sorted(claims, key=lambda c: c["production_start_date"]), "shipments": shipments,
        })
    open_checkins = [t for t in snap.checkins if t.po_id == po.id and t.state == "open"]
    out = {
        "id": po.id, "number": po.number, "status": po.status, "buyer": po.buyer,
        "supplier": {"id": po.supplier_id, "name": snap.suppliers[po.supplier_id].name},
        "destination": _wh(snap, po.destination_warehouse_id), "needs_review": po.needs_review,
        "review_note": po.review_note, "lines": lines,
        "next_checkin": ({"id": open_checkins[0].id, "due_date": open_checkins[0].due_date,
                          "status": _checkin_status(snap, open_checkins[0].due_date)} if open_checkins else None),
    }
    if detail:
        out["checkins"] = [{"id": t.id, "po_line_id": t.po_line_id, "due_date": t.due_date, "owner": t.owner,
                            "note": t.note, "state": t.state, "outcome": t.outcome, "completed_at": t.completed_at,
                            "status": _checkin_status(snap, t.due_date) if t.state == "open" else "completed"}
                           for t in snap.checkins if t.po_id == po.id]
        out["arrival_targets"] = _arrival_targets(snap, r, po)
        out["open_checkin_ids"] = [t.id for t in open_checkins if _checkin_status(snap, t.due_date) != "upcoming"]
    return out


# ---------------------------------------------------------------- warehouse and QA


def _line_demand(snap: Snapshot, r: Readiness, line_id: str) -> list[dict]:
    out = []
    for a in r.allocs:
        if a.source_type == "po_line" and a.source_id == line_id:
            wo = snap.wo_of(a.item_id)
            out.append({"work_order_number": wo.number, "work_order_id": wo.id,
                        "production_start_date": wo.production_start_date, "qty": a.qty, "review": a.review})
    return sorted(out, key=lambda x: x["production_start_date"])


def warehouse_queue(db: Session, warehouse_id: str | None = None) -> dict:
    snap, r = _load(db)

    def here(wh_id):
        return warehouse_id is None or wh_id == warehouse_id

    arrivals = []
    for sh in snap.shipments.values():
        if sh.status == "received" or not here(sh.destination_warehouse_id):
            continue
        lines = []
        for sl in (x for x in snap.shipment_lines.values() if x.shipment_id == sh.id):
            open_qty = sl.qty - snap.received_by_sl.get(sl.id, 0)
            if open_qty <= 0:
                continue
            line = snap.lines[sl.po_line_id]
            part = snap.parts[line.part_id]
            lines.append({"shipment_line_id": sl.id, "po_line_id": line.id, "label": snap.line_label(line.id),
                          "part_number": part.part_number, "description": part.description, "uom": part.uom,
                          "requires_qa": part.requires_qa, "lot_tracked": part.lot_tracked, "open_qty": open_qty,
                          "demand": _line_demand(snap, r, line.id)})
        if not lines:
            continue
        starts = [d["production_start_date"] for l in lines for d in l["demand"]]
        arrivals.append({"kind": "shipment", "shipment_id": sh.id, "number": sh.number, "status": sh.status,
                         "supplier": snap.suppliers[sh.supplier_id].name, "destination": _wh(snap, sh.destination_warehouse_id),
                         "expected_arrival": sh.expected_arrival, "arrival_basis": sh.arrival_basis,
                         "arrival_channel": sh.arrival_channel, "arrival_updated_at": sh.arrival_updated_at,
                         "carrier": sh.carrier, "tracking_number": sh.tracking_number, "lines": lines,
                         "earliest_start": min(starts) if starts else None})
    for lid, q in r.line_quantities.items():
        line = snap.lines[lid]
        po = snap.pos[line.po_id]
        if q.unshipped <= 0 or po.status != "open" or not here(po.destination_warehouse_id):
            continue
        part = snap.parts[line.part_id]
        demand = _line_demand(snap, r, lid)
        arrivals.append({"kind": "unshipped", "shipment_id": None, "number": f"{snap.line_label(lid)} (not shipped)",
                         "status": "unshipped", "supplier": snap.suppliers[po.supplier_id].name,
                         "destination": _wh(snap, po.destination_warehouse_id), "expected_arrival": line.expected_arrival,
                         "arrival_basis": line.arrival_basis, "arrival_channel": line.arrival_channel,
                         "arrival_updated_at": line.arrival_updated_at, "carrier": None, "tracking_number": None,
                         "lines": [{"shipment_line_id": None, "po_line_id": lid, "label": snap.line_label(lid),
                                    "part_number": part.part_number, "description": part.description, "uom": part.uom,
                                    "requires_qa": part.requires_qa, "lot_tracked": part.lot_tracked,
                                    "open_qty": q.unshipped, "demand": demand}],
                         "earliest_start": min((d["production_start_date"] for d in demand), default=None)})
    arrivals.sort(key=lambda a: (a["expected_arrival"] is None, a["expected_arrival"] or snap.today, a["number"]))

    putaway = []
    for rec in snap.inventory.values():
        if rec.qty == 0 or not here(rec.warehouse_id):
            continue
        part = snap.parts[rec.part_id]
        base = {"inventory_record_id": rec.id, "part_number": part.part_number, "description": part.description,
                "qty": rec.qty, "uom": part.uom, "location": rec.location, "warehouse": _wh(snap, rec.warehouse_id),
                "lot": rec.lot}
        if rec.quality_state == "accepted" and rec.stage == "received":
            putaway.append({**base, "awaiting_handoff": bool(rec.pool_po_line_id)})

    picks, stage_tasks = [], []
    for a in r.allocs:
        if a.source_type != "inventory" or a.state != "committed":
            continue
        rec = snap.inventory[a.source_id]
        wo = snap.wo_of(a.item_id)
        if wo.state != "finalized" or not here(rec.warehouse_id) or rec.quality_state != "accepted":
            continue
        part = snap.parts[rec.part_id]
        task = {"allocation_id": a.id, "inventory_record_id": rec.id, "work_order_id": wo.id,
                "work_order_number": wo.number, "work_order_title": wo.title,
                "production_start_date": wo.production_start_date,
                "days_to_start": (wo.production_start_date - snap.today).days, "part_number": part.part_number,
                "description": part.description, "uom": part.uom, "qty": a.qty, "location": rec.location,
                "lot": rec.lot, "blocked": a.review, "blocked_reason": "Allocation decision needed" if a.review else None}
        if rec.stage in ("received", "stored"):
            picks.append(task)
        elif rec.stage == "picked":
            stage_tasks.append(task)
    picks.sort(key=lambda t: t["production_start_date"])
    stage_tasks.sort(key=lambda t: t["production_start_date"])

    transfers = []
    for t in snap.transfers.values():
        if t.status in ("planned", "in_transit") and here(t.dest_warehouse_id):
            transfers.append({"id": t.id, "part_number": snap.parts[t.part_id].part_number, "qty": t.qty,
                              "source": _wh(snap, t.source_warehouse_id), "destination": _wh(snap, t.dest_warehouse_id),
                              "status": t.status, "expected_arrival": t.expected_arrival})

    return {"today": snap.today, "warehouses": [_wh(snap, w) for w in snap.warehouses],
            "arrivals": arrivals, "qa_pending": qa_queue_from(snap, r, warehouse_id), "putaway": putaway,
            "picks": picks, "stage": stage_tasks, "transfers": transfers}


def qa_queue_from(snap: Snapshot, r: Readiness, warehouse_id: str | None = None) -> list[dict]:
    out = []
    rl_by_id = {rl.id: rl for rl in snap.receipt_lines}
    for b in snap.qa_batches.values():
        if b.status != "pending":
            continue
        rl = rl_by_id[b.receipt_line_id]
        line = snap.lines[rl.po_line_id]
        po = snap.pos[line.po_id]
        if warehouse_id and po.destination_warehouse_id != warehouse_id:
            continue
        part = snap.parts[line.part_id]
        demand = _line_demand(snap, r, line.id)
        out.append({"qa_batch_id": b.id, "input_qty": b.input_qty, "part_number": part.part_number,
                    "description": part.description, "uom": part.uom, "label": snap.line_label(line.id),
                    "lot": rl.lot, "warehouse": _wh(snap, po.destination_warehouse_id), "created_at": b.created_at,
                    "demand": demand, "earliest_start": min((d["production_start_date"] for d in demand), default=None)})
    return sorted(out, key=lambda x: (x["earliest_start"] is None, x["earliest_start"] or snap.today))


def qa_queue(db: Session) -> list[dict]:
    snap, r = _load(db)
    return qa_queue_from(snap, r)


def exceptions(db: Session, include_closed: bool = False) -> list[dict]:
    snap = Snapshot(db)
    return [_exception_dict(snap, e) for e in reversed(list(snap.exceptions.values()))
            if include_closed or e.state != "closed"]


def master(db: Session) -> dict:
    snap = Snapshot(db)
    return {
        "today": snap.today,
        "parts": [{"id": p.id, "part_number": p.part_number, "description": p.description, "uom": p.uom,
                   "requires_qa": p.requires_qa, "preferred_supplier_id": p.preferred_supplier_id}
                  for p in sorted(snap.parts.values(), key=lambda p: p.part_number)],
        "warehouses": [{"id": w.id, "code": w.code, "name": w.name, "facility": w.facility, "city": w.city}
                       for w in snap.warehouses.values()],
        "suppliers": [{"id": s.id, "name": s.name} for s in snap.suppliers.values()],
        "programs": [{"id": p.id, "name": p.name} for p in snap.programs.values()],
    }


def history(db: Session, entity_id: str | None = None, limit: int = 100) -> list[dict]:
    q = select(ChangeHistory).order_by(ChangeHistory.id.desc()).limit(limit)
    if entity_id:
        q = q.where(ChangeHistory.entity_id == entity_id)
    return [_history_dict(h) for h in db.scalars(q)]
