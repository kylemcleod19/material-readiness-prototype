"""Read models for each role's screens. All numbers come from readiness.compute()."""
from collections import defaultdict
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChangeHistory, PartStockPolicy, PlanningScenario
from app.services.common import NotFound
from app.services.readiness import Readiness, Snapshot, compute, material_shortages, work_order_status


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


def _assignable(snap: Snapshot, r: Readiness, part_id: str, wh_id: str) -> int:
    """Stock or open PO quantity at a site that no work order has been allocated yet."""
    free_stock = sum(snap.free_qty(rec, r.allocs) for rec in snap.inventory.values()
                     if rec.part_id == part_id and rec.warehouse_id == wh_id and snap.is_free_stock(rec))
    free_po = sum(r.line_quantities[lid].unallocated for lid, line in snap.lines.items()
                  if line.part_id == part_id and snap.pos[line.po_id].destination_warehouse_id == wh_id
                  and snap.pos[line.po_id].status == "open")
    return free_stock + free_po


def _enrich_action(snap: Snapshot, r: Readiness, wo, a: dict) -> dict:
    """Add what a button needs to act right where the problem is shown."""
    a = dict(a)
    if a["kind"] == "buy":
        a["supplier"] = _supplier(snap, a["part_id"])
        a["unassigned_here"] = _assignable(snap, r, a["part_id"], wo.warehouse_id)
    elif a["kind"] == "resolve_shortage" and a.get("po_line_id"):
        a["po_line_label"] = snap.line_label(a["po_line_id"])
    elif a["kind"] in ("update_arrival", "get_arrival_date") and a.get("po_id"):
        a["po_number"] = snap.pos[a["po_id"]].number
    elif a["kind"] == "decide_transfer" and a.get("from_warehouse"):
        a["from_warehouse"] = _wh(snap, a["from_warehouse"])
    return a


def _wo_summary(snap: Snapshot, r: Readiness, wo) -> dict:
    st = work_order_status(snap, r, wo)
    st["next_actions"] = [_enrich_action(snap, r, wo, a) if "part_id" in a else a for a in st["next_actions"]]
    fixtures = snap.fixtures_by_wo.get(wo.id, [])
    item_ids = {i.id for i in snap.items_by_wo.get(wo.id, [])}
    open_exc = {e.id for iid in item_ids for e in snap.exceptions_by_item.get(iid, []) if e.state != "closed"}
    return {
        "id": wo.id, "number": wo.number, "title": wo.title, "program": snap.programs[wo.program_id].name,
        "warehouse": _wh(snap, wo.warehouse_id), "production_start_date": wo.production_start_date,
        "days_to_start": (wo.production_start_date - snap.today).days, "state": wo.state, "build_qty": wo.build_qty,
        **st,
        "fixtures": {"total": len(fixtures), "covered": sum(f.coverage_state == "covered" for f in fixtures)},
        "open_exceptions": len(open_exc),
    }


def work_orders(db: Session) -> list[dict]:
    snap, r = _load(db)
    rows = [_wo_summary(snap, r, wo) for wo in snap.work_orders.values()]
    order = {"finalized": 0, "draft": 1, "canceled": 2}
    rows.sort(key=lambda x: (order[x["state"]], x["production_start_date"]))
    return rows


def _supply_options(snap: Snapshot, r: Readiness, item, wo) -> list[dict]:
    """Existing supply a planner could assign before buying more. Incoming supply is 'on order'."""
    opts = []
    for lid, line in snap.lines.items():
        po = snap.pos[line.po_id]
        if line.part_id != item.part_id or po.status != "open":
            continue
        q = r.line_quantities[lid]
        if q.unallocated <= 0:
            continue
        etas = sorted({b.eta for b in q.buckets if not b.arrived}, key=lambda d: (d is None, d))
        opts.append({
            "source_type": "po_line", "source_id": lid, "label": snap.line_label(lid),
            "supplier": snap.suppliers[po.supplier_id].name, "destination": _wh(snap, po.destination_warehouse_id),
            "compatible": po.destination_warehouse_id == wo.warehouse_id, "unallocated": q.unallocated,
            "expected_arrivals": etas, "kind": "on_order",
            "arrives_after_start": any(e is not None and e > wo.production_start_date for e in etas),
        })
    for t in snap.transfers.values():
        if t.part_id != item.part_id or t.status not in ("planned", "in_transit"):
            continue
        used = sum(a.qty for a in r.allocs if a.source_type == "transfer_line" and a.source_id == t.id)
        if t.qty - used > 0:
            opts.append({
                "source_type": "transfer_line", "source_id": t.id,
                "label": f"Transfer {snap.warehouses[t.source_warehouse_id].code}→{snap.warehouses[t.dest_warehouse_id].code}",
                "destination": _wh(snap, t.dest_warehouse_id), "compatible": t.dest_warehouse_id == wo.warehouse_id,
                "unallocated": t.qty - used, "expected_arrivals": [t.expected_arrival], "kind": "on_order",
                "arrives_after_start": bool(t.expected_arrival and t.expected_arrival > wo.production_start_date),
            })
    for rec in snap.inventory.values():
        if rec.part_id != item.part_id or not snap.is_free_stock(rec):
            continue
        free = snap.free_qty(rec, r.allocs)
        if free > 0:
            opts.append({
                "source_type": "inventory", "source_id": rec.id,
                "label": f"Stock {snap.warehouses[rec.warehouse_id].code} · {rec.location}",
                "destination": _wh(snap, rec.warehouse_id), "compatible": rec.warehouse_id == wo.warehouse_id,
                "unallocated": free, "expected_arrivals": [], "kind": "in_stock", "arrives_after_start": False,
            })
    opts.sort(key=lambda o: (not o["compatible"], o["kind"] != "in_stock"))
    return opts


def _other_demand(snap: Snapshot, r: Readiness, part_id: str, exclude_item: str) -> list[dict]:
    out = []
    for ir in r.items.values():
        if ir.part_id != part_id or ir.item_id == exclude_item:
            continue
        wo = snap.work_orders[ir.work_order_id]
        if wo.state == "canceled":
            continue
        out.append({"work_order_item_id": ir.item_id, "work_order_id": wo.id, "work_order_number": wo.number,
                    "state": wo.state, "warehouse": _wh(snap, wo.warehouse_id),
                    "production_start_date": wo.production_start_date, "required": ir.required,
                    "uncovered": ir.uncovered if wo.state == "finalized" else ir.required})
    return sorted(out, key=lambda x: x["production_start_date"])


def _exception_dict(snap: Snapshot, e) -> dict:
    links = []
    for l in snap.exception_links.get(e.id, []):
        item = snap.items[l.work_order_item_id]
        wo = snap.work_orders[item.work_order_id]
        links.append({"work_order_item_id": item.id, "work_order_id": wo.id, "work_order_number": wo.number,
                      "production_start_date": wo.production_start_date, "claimed_qty": l.claimed_qty,
                      "part_number": snap.parts[item.part_id].part_number})
    return {
        "id": e.id, "type": e.type, "state": e.state, "title": e.title, "detail": e.detail,
        "source_type": e.source_type, "source_id": e.source_id, "affected_qty": e.affected_qty,
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
        d["other_demand"] = _other_demand(snap, r, item.part_id, item.id)
        d["supply_options"] = _supply_options(snap, r, item, wo) if wo.state != "canceled" else []
        if wo.state == "draft":
            d["local_free_stock"] = sum(snap.free_qty(rec, r.allocs) for rec in snap.inventory.values()
                                        if rec.part_id == item.part_id and rec.warehouse_id == wo.warehouse_id
                                        and snap.is_free_stock(rec))
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


def _history_dict(h: ChangeHistory) -> dict:
    return {"id": h.id, "at": h.at, "actor": h.actor, "role": h.role, "channel": h.channel,
            "entity_type": h.entity_type, "entity_id": h.entity_id, "action": h.action,
            "before": h.before, "after": h.after, "note": h.note}


# ---------------------------------------------------------------- purchasing


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
        free = sum(snap.free_qty(rec, r.allocs) for rec in snap.inventory.values()
                   if rec.part_id == part_id and rec.warehouse_id == wh_id and snap.is_free_stock(rec))
        incoming, etas = 0, []
        for lid, line in snap.lines.items():
            po = snap.pos[line.po_id]
            if line.part_id == part_id and po.destination_warehouse_id == wh_id and po.status == "open":
                q = r.line_quantities[lid]
                if q.unallocated:
                    incoming += q.unallocated
                    etas += [b.eta for b in q.buckets if not b.arrived]
        projected = free + incoming
        if projected >= reorder:
            continue
        out.append({
            "part_id": part_id, "part_number": part.part_number, "description": part.description,
            "warehouse": _wh(snap, wh_id), "free_on_hand": free, "incoming_unallocated": incoming,
            "projected": projected, "reorder_point": reorder, "target_level": target,
            "suggested_qty": target - projected, "lead_time_days": part.lead_time_days,
            "policy_source": "warehouse" if pol else "company default",
            "next_incoming": min((e for e in etas if e), default=None),
            "preferred_supplier": snap.suppliers[part.preferred_supplier_id].name if part.preferred_supplier_id else None,
        })
    return out


def purchasing_queue(db: Session) -> dict:
    snap, r = _load(db)
    finalized = {w.id for w in snap.work_orders.values() if w.state == "finalized"}

    def wo_ref(item_id):
        item = snap.items[item_id]
        wo = snap.work_orders[item.work_order_id]
        return {"work_order_id": wo.id, "work_order_number": wo.number, "work_order_title": wo.title,
                "production_start_date": wo.production_start_date, "warehouse": _wh(snap, wo.warehouse_id),
                "work_order_item_id": item.id, "part_id": item.part_id,
                "part_number": snap.parts[item.part_id].part_number}

    uncovered, timing = [], []
    for ir in r.items.values():
        if ir.work_order_id not in finalized:
            continue
        item = snap.items[ir.item_id]
        wo = snap.work_orders[ir.work_order_id]
        if ir.uncovered:
            opts = _supply_options(snap, r, item, wo)
            uncovered.append({**wo_ref(ir.item_id), "required": ir.required, "uncovered": ir.uncovered,
                              "options": opts, "supplier": _supplier(snap, ir.part_id),
                              "unassigned_here": _assignable(snap, r, ir.part_id, wo.warehouse_id),
                              "other_demand": [d for d in _other_demand(snap, r, ir.part_id, ir.item_id)
                                               if d["uncovered"] > 0]})
        if ir.timing in ("late", "timing_review", "unknown"):
            timing.append({**wo_ref(ir.item_id), "timing": ir.timing, "late_qty": ir.late_qty,
                           "supplier": _supplier(snap, ir.part_id),
                           "sources": [asdict(s) for s in ir.sources if s.category == "incoming"]})

    remote_holds = []
    for a in r.allocs:
        if a.state == "remote_hold":
            rec = snap.inventory[a.source_id]
            ir = r.items[a.item_id]
            remote_holds.append({**wo_ref(a.item_id), "allocation_id": a.id, "qty": a.qty, "required": ir.required,
                                 "supplier": _supplier(snap, rec.part_id),
                                 "source_warehouse": _wh(snap, rec.warehouse_id),
                                 "competing_demand": [d for d in _other_demand(snap, r, rec.part_id, a.item_id)
                                                      if d["warehouse"]["id"] == rec.warehouse_id]})

    drafts = {s.po_line_id: s.id for s in db.scalars(select(PlanningScenario).where(PlanningScenario.state == "draft"))}
    shortages = [{**s, "draft_scenario_id": drafts.get(s["po_line_id"])} for s in material_shortages(snap, r)]

    handoffs = []
    for lid, q in r.line_quantities.items():
        claims = [a for a in r.allocs if a.source_type == "po_line" and a.source_id == lid]
        if q.pooled_accepted and claims and not any(a.review for a in claims):
            handoffs.append({"po_line_id": lid, "po_id": snap.lines[lid].po_id, "label": snap.line_label(lid),
                             "part_number": snap.parts[snap.lines[lid].part_id].part_number,
                             "accepted_waiting": q.pooled_accepted,
                             "claims": [{**wo_ref(a.item_id), "allocation_id": a.id, "qty": a.qty} for a in claims]})

    checkins = []
    for t in snap.checkins:
        if t.state != "open":
            continue
        po = snap.pos[t.po_id]
        lines = [t.po_line_id] if t.po_line_id else [l.id for l in snap.lines_by_po[po.id]]
        arrivals = sorted({b.eta for lid in lines for b in r.line_quantities[lid].buckets
                           if not b.arrived and b.eta}, key=lambda d: d)
        checkins.append({"id": t.id, "po_id": po.id, "po_number": po.number, "po_line_id": t.po_line_id,
                         "supplier": snap.suppliers[po.supplier_id].name, "due_date": t.due_date,
                         "status": _checkin_status(snap, t.due_date), "owner": t.owner, "note": t.note,
                         "expected_arrivals": arrivals})

    pos_review = [{"id": p.id, "number": p.number, "supplier": snap.suppliers[p.supplier_id].name,
                   "review_note": p.review_note} for p in snap.pos.values() if p.needs_review]
    exceptions = [_exception_dict(snap, e) for e in snap.exceptions.values() if e.state != "closed"]
    replenishment = _replenishment(db, snap, r)

    return {
        "today": snap.today,
        "counts": {"uncovered": len(uncovered), "remote_holds": len(remote_holds), "shortages": len(shortages),
                   "timing": len(timing), "checkins_due": sum(c["status"] != "upcoming" for c in checkins),
                   "exceptions": len(exceptions), "pos_review": len(pos_review), "handoffs": len(handoffs),
                   "replenishment": len(replenishment)},
        "uncovered": sorted(uncovered, key=lambda x: x["production_start_date"]),
        "remote_holds": remote_holds,
        "material_shortages": shortages,
        "handoffs": handoffs,
        "timing_conflicts": sorted(timing, key=lambda x: x["production_start_date"]),
        "checkins": checkins,
        "pos_needing_review": pos_review,
        "exceptions": exceptions,
        "replenishment": replenishment,
    }


def parts_view(db: Session) -> list[dict]:
    """Per part: can current stock and open orders meet every finalized requirement, and what closes the gap?"""
    snap, r = _load(db)
    out = []
    for part in sorted(snap.parts.values(), key=lambda p: p.part_number):
        rows = []
        for ir in r.items.values():
            wo = snap.work_orders[ir.work_order_id]
            if ir.part_id != part.id or wo.state != "finalized":
                continue
            rows.append({
                "work_order_item_id": ir.item_id, "work_order_id": wo.id, "work_order_number": wo.number,
                "warehouse": _wh(snap, wo.warehouse_id), "production_start_date": wo.production_start_date,
                "required": ir.required, "from_stock": ir.available, "on_order": ir.incoming,
                "at_other_site": ir.remote_hold, "decision_needed": ir.review, "short": ir.uncovered,
                "expected": ir.expected, "state": ir.state, "action": ir.action,
                "sources": [{"label": s.label, "qty": s.qty, "category": s.category, "expected_arrival": s.expected_arrival,
                             "po_id": s.po_id} for s in ir.sources],
            })
        rows.sort(key=lambda x: x["production_start_date"])
        line_short = sum(q.deficit for lid, q in r.line_quantities.items() if snap.lines[lid].part_id == part.id)
        needed = sum(x["required"] for x in rows)
        gap = sum(x["short"] for x in rows) + line_short
        by_site: dict[str, list] = defaultdict(list)
        for x in rows:
            if x["short"]:
                by_site[x["warehouse"]["id"]].append(x)
        purchases = []
        for wh_id, xs in by_site.items():
            purchases.append({
                "destination": _wh(snap, wh_id), "short": sum(x["short"] for x in xs),
                "unassigned_here": _assignable(snap, r, part.id, wh_id),
                "demand": [{"work_order_item_id": x["work_order_item_id"], "work_order_id": x["work_order_id"],
                            "work_order_number": x["work_order_number"], "state": "finalized", "warehouse": x["warehouse"],
                            "production_start_date": x["production_start_date"], "required": x["required"],
                            "uncovered": x["short"]} for x in xs],
            })
        unassigned = sum(p["unassigned_here"] for p in purchases)
        states = {x["state"] for x in rows}
        if gap and unassigned >= gap and not line_short:
            verdict = "assign_existing"
        elif gap:
            verdict = "short"
        elif states & {"arrives_late", "arrival_unknown", "transfer_decision"}:
            verdict = "at_risk"
        elif rows:
            verdict = "covered"
        else:
            verdict = "no_demand"
        free_stock = sum(snap.free_qty(rec, r.allocs) for rec in snap.inventory.values()
                         if rec.part_id == part.id and snap.is_free_stock(rec))
        if not rows and not free_stock:
            continue
        out.append({
            "id": part.id, "part_number": part.part_number, "description": part.description, "uom": part.uom,
            "lead_time_days": part.lead_time_days, "supplier": _supplier(snap, part.id),
            "orders": len(rows), "needed": needed, "covered": needed - gap, "gap": gap,
            "late_qty": sum(r.items[x["work_order_item_id"]].late_qty for x in rows),
            "verdict": verdict, "free_stock": free_stock, "requirements": rows, "purchases": purchases,
        })
    order = {"short": 0, "assign_existing": 1, "at_risk": 2, "covered": 3, "no_demand": 4}
    out.sort(key=lambda p: (order[p["verdict"]], p["part_number"]))
    return out


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
        lines.append({
            "id": line.id, "line_no": line.line_no, "label": snap.line_label(line.id), "part_id": part.id,
            "part_number": part.part_number, "description": part.description, "uom": part.uom,
            "ordered": q.ordered, "canceled": q.canceled, "closed_shortfall": q.shortfall, "received": q.received,
            "outstanding": q.outstanding, "in_transit": q.in_transit, "unshipped": q.unshipped,
            "pending_qa": q.pooled_pending, "awaiting_handoff": q.pooled_accepted, "claims": q.claims,
            "unallocated": q.unallocated, "deficit": q.deficit,
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
                "lot": rec.lot, "blocked": a.review, "blocked_reason": "Allocation review required" if a.review else None}
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
