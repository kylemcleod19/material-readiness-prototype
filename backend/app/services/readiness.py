"""Derived readiness: coverage, shortages, timing conflicts, review flags, kit readiness.

Every view and the scenario preview call compute() over a Snapshot; preview simply passes a
different allocation list. The frontend never recalculates any of this.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.models import (
    ACTIVE_STATES,
    Allocation,
    FixtureRequirement,
    InventoryRecord,
    MaterialException,
    MaterialExceptionLink,
    Part,
    POCheckInTask,
    Program,
    PurchaseOrder,
    PurchaseOrderLine,
    QABatch,
    ReceiptLine,
    Shipment,
    ShipmentLine,
    Supplier,
    TransferLine,
    Warehouse,
    WorkOrder,
    WorkOrderItem,
)
from app.services.quantities import LineQuantities, claim_timing, line_quantities, single_timing, worst_timing


@dataclass
class AllocView:
    id: str
    item_id: str
    qty: int
    state: str
    review: bool
    source_type: str  # po_line | transfer_line | inventory
    source_id: str


class Snapshot:
    """All current operational rows needed for readiness, loaded once per request."""

    def __init__(self, db: Session, today: date | None = None):
        self.today = today or clock.today()
        self.parts = {p.id: p for p in db.scalars(select(Part))}
        self.warehouses = {w.id: w for w in db.scalars(select(Warehouse))}
        self.programs = {p.id: p for p in db.scalars(select(Program))}
        self.suppliers = {s.id: s for s in db.scalars(select(Supplier))}
        self.work_orders = {w.id: w for w in db.scalars(select(WorkOrder))}
        self.items = {i.id: i for i in db.scalars(select(WorkOrderItem).order_by(WorkOrderItem.line_no))}
        self.items_by_wo: dict[str, list[WorkOrderItem]] = defaultdict(list)
        for i in self.items.values():
            self.items_by_wo[i.work_order_id].append(i)
        self.fixtures_by_wo: dict[str, list[FixtureRequirement]] = defaultdict(list)
        for f in db.scalars(select(FixtureRequirement)):
            self.fixtures_by_wo[f.work_order_id].append(f)
        self.pos = {p.id: p for p in db.scalars(select(PurchaseOrder))}
        self.lines = {l.id: l for l in db.scalars(select(PurchaseOrderLine).order_by(PurchaseOrderLine.line_no))}
        self.shipments = {s.id: s for s in db.scalars(select(Shipment))}
        self.shipment_lines = {s.id: s for s in db.scalars(select(ShipmentLine))}
        self.receipt_lines = list(db.scalars(select(ReceiptLine)))
        self.qa_batches = {b.id: b for b in db.scalars(select(QABatch))}
        self.inventory = {r.id: r for r in db.scalars(select(InventoryRecord))}
        self.transfers = {t.id: t for t in db.scalars(select(TransferLine))}
        self.checkins = list(db.scalars(select(POCheckInTask).order_by(POCheckInTask.due_date)))
        self.exceptions = {e.id: e for e in db.scalars(select(MaterialException).order_by(MaterialException.created_at))}
        self.exception_links: dict[str, list[MaterialExceptionLink]] = defaultdict(list)
        self.exceptions_by_item: dict[str, list[MaterialException]] = defaultdict(list)
        for link in db.scalars(select(MaterialExceptionLink)):
            self.exception_links[link.exception_id].append(link)
            self.exceptions_by_item[link.work_order_item_id].append(self.exceptions[link.exception_id])

        self.received_by_line: dict[str, int] = defaultdict(int)
        self.received_by_sl: dict[str, int] = defaultdict(int)
        for rl in self.receipt_lines:
            self.received_by_line[rl.po_line_id] += rl.qty
            if rl.shipment_line_id:
                self.received_by_sl[rl.shipment_line_id] += rl.qty
        self.sls_by_line: dict[str, list[ShipmentLine]] = defaultdict(list)
        for sl in self.shipment_lines.values():
            self.sls_by_line[sl.po_line_id].append(sl)
        self.lines_by_po: dict[str, list[PurchaseOrderLine]] = defaultdict(list)
        for l in self.lines.values():
            self.lines_by_po[l.po_id].append(l)
        self.pooled_by_line: dict[str, list[InventoryRecord]] = defaultdict(list)
        for r in self.inventory.values():
            if r.pool_po_line_id:
                self.pooled_by_line[r.pool_po_line_id].append(r)

        self.allocs = [
            AllocView(a.id, a.work_order_item_id, a.qty, a.state, a.review_required, a.source_type, a.source_id)
            for a in db.scalars(select(Allocation).where(Allocation.state.in_(ACTIVE_STATES)).order_by(Allocation.created_at))
        ]

    # ------------------------------------------------------------ helpers

    def line_label(self, line_id: str) -> str:
        line = self.lines[line_id]
        return f"{self.pos[line.po_id].number}-{line.line_no}"

    def open_shipments(self, line_id: str) -> list[tuple[int, date | None, str, str]]:
        out = []
        for sl in self.sls_by_line.get(line_id, []):
            sh = self.shipments[sl.shipment_id]
            out.append((sl.qty - self.received_by_sl.get(sl.id, 0), sh.expected_arrival, sh.number, sh.id))
        out.sort(key=lambda x: (x[1] is None, x[1] or date.max, x[2]))
        return out

    def line_q(self, line_id: str, allocs: list[AllocView], cleared_pools: frozenset = frozenset()) -> LineQuantities:
        """cleared_pools: lines whose accepted pooled units are treated as handed off (scenario preview)."""
        line = self.lines[line_id]
        return line_quantities(
            ordered=line.ordered_qty,
            canceled=line.canceled_qty,
            shortfall=line.closed_shortfall_qty,
            expected_arrival=line.expected_arrival,
            received=self.received_by_line.get(line_id, 0),
            open_shipments=[(q, eta, label) for q, eta, label, _ in self.open_shipments(line_id)],
            pooled=[(r.qty, r.quality_state) for r in self.pooled_by_line.get(line_id, [])
                    if r.quality_state == "pending" or (r.quality_state == "accepted" and line_id not in cleared_pools)],
            claims=sum(a.qty for a in allocs if a.source_type == "po_line" and a.source_id == line_id),
        )

    def free_qty(self, rec: InventoryRecord, allocs: list[AllocView]) -> int:
        used = sum(a.qty for a in allocs if a.source_type == "inventory" and a.source_id == rec.id)
        return rec.qty - used

    def is_free_stock(self, rec: InventoryRecord) -> bool:
        return (rec.quality_state == "accepted" and rec.stage in ("received", "stored")
                and rec.pool_po_line_id is None and rec.reserved_transfer_line_id is None)

    def wo_of(self, item_id: str) -> WorkOrder:
        return self.work_orders[self.items[item_id].work_order_id]


@dataclass
class SourceLine:
    allocation_id: str
    source_type: str
    source_id: str
    label: str
    qty: int
    category: str  # incoming | available | picked | staged | remote_hold | review | blocked
    expected_arrival: date | None = None
    timing: str = "none"
    late_qty: int = 0
    warehouse: str | None = None
    detail: str | None = None
    po_id: str | None = None


@dataclass
class ItemReadiness:
    item_id: str
    work_order_id: str
    line_no: int
    part_id: str
    part_number: str
    description: str
    uom: str
    required: int
    incoming: int = 0
    available: int = 0  # accepted inventory allocated, includes picked and staged
    picked: int = 0
    staged: int = 0  # subset of available
    remote_hold: int = 0
    review: int = 0
    uncovered: int = 0
    timing: str = "none"
    late_qty: int = 0
    # Latest known expected arrival across on-order sources (None when nothing is on order or dates are unknown).
    expected: date | None = None
    # One status and next action, see _item_state.
    state: str = "short"
    action: dict | None = None
    sources: list[SourceLine] = field(default_factory=list)
    exceptions: list[str] = field(default_factory=list)

    @property
    def allocated(self) -> int:
        return self.incoming + self.available + self.remote_hold + self.review


@dataclass
class Readiness:
    snapshot: Snapshot
    allocs: list[AllocView]
    items: dict[str, ItemReadiness]
    line_quantities: dict[str, LineQuantities]


def compute(snap: Snapshot, allocs: list[AllocView] | None = None,
            cleared_pools: frozenset = frozenset()) -> Readiness:
    allocs = snap.allocs if allocs is None else allocs
    lq = {lid: snap.line_q(lid, allocs, cleared_pools) for lid in snap.lines}

    # Timing for shared PO-line claims is evaluated per line across all its claims.
    claims_by_line: dict[str, list[AllocView]] = defaultdict(list)
    for a in allocs:
        if a.source_type == "po_line" and a.state == "committed":
            claims_by_line[a.source_id].append(a)
    line_timing: dict[str, tuple[str, int]] = {}
    for lid, claims in claims_by_line.items():
        line_timing.update(claim_timing(
            [(a.id, a.qty, snap.wo_of(a.item_id).production_start_date) for a in claims], lq[lid].buckets))

    items: dict[str, ItemReadiness] = {}
    for item in snap.items.values():
        part = snap.parts[item.part_id]
        items[item.id] = ItemReadiness(
            item_id=item.id, work_order_id=item.work_order_id, line_no=item.line_no, part_id=part.id,
            part_number=part.part_number, description=part.description, uom=part.uom, required=item.required_qty,
            exceptions=[e.id for e in snap.exceptions_by_item.get(item.id, []) if e.state != "closed"],
        )

    for a in allocs:
        ir = items[a.item_id]
        start = snap.wo_of(a.item_id).production_start_date
        src = _source_line(snap, a, lq, line_timing, start)
        ir.sources.append(src)
        if src.category == "remote_hold":
            ir.remote_hold += a.qty
        elif src.category in ("review", "blocked"):
            ir.review += a.qty
        elif src.category == "incoming":
            ir.incoming += a.qty
        else:
            ir.available += a.qty
            if src.category == "staged":
                ir.staged += a.qty
            elif src.category == "picked":
                ir.picked += a.qty

    for ir in items.values():
        ir.uncovered = max(0, ir.required - ir.allocated)
        incoming = [s for s in ir.sources if s.category == "incoming"]
        ir.timing = worst_timing(s.timing for s in incoming)
        ir.late_qty = sum(s.late_qty for s in incoming)
        ir.expected = max((s.expected_arrival for s in incoming if s.expected_arrival), default=None)
        ir.state, ir.action = _item_state(ir, snap.work_orders[ir.work_order_id])
    return Readiness(snap, allocs, items, lq)


def _source_line(snap: Snapshot, a: AllocView, lq: dict[str, LineQuantities],
                 line_timing: dict[str, tuple[str, int]], start: date) -> SourceLine:
    if a.source_type == "po_line":
        line = snap.lines[a.source_id]
        po = snap.pos[line.po_id]
        q = lq[a.source_id]
        etas = {b.eta for b in q.buckets if not b.arrived}
        # One ETA only when every remaining slice shares it; otherwise don't invent an order-level date.
        src = SourceLine(a.id, "po_line", a.source_id, f"{snap.line_label(line.id)} ({snap.suppliers[po.supplier_id].name})",
                         a.qty, "incoming", warehouse=po.destination_warehouse_id, po_id=po.id,
                         expected_arrival=next(iter(etas)) if len(etas) == 1 else None)
        if len(etas) > 1:
            src.detail = "Line arrives in multiple shipments with different dates"
        if a.state == "remote_hold":
            src.category = "remote_hold"
        elif a.review:
            src.category = "review"
            src.detail = f"{q.claims} allocated / {q.supply} remaining — decision needed"
        else:
            src.timing, src.late_qty = line_timing.get(a.id, ("on_time", 0))
            if any(b.eta is None and not b.arrived for b in q.buckets):
                src.detail = "Expected arrival unknown for part of this line"
        return src
    if a.source_type == "transfer_line":
        t = snap.transfers[a.source_id]
        src = SourceLine(a.id, "transfer_line", t.id,
                         f"Transfer from {snap.warehouses[t.source_warehouse_id].code}", a.qty, "incoming",
                         expected_arrival=t.expected_arrival, warehouse=t.dest_warehouse_id)
        src.timing = single_timing(t.expected_arrival, start)
        src.late_qty = a.qty if src.timing == "late" else 0
        return src
    rec = snap.inventory[a.source_id]
    wh = snap.warehouses[rec.warehouse_id]
    src = SourceLine(a.id, "inventory", rec.id, f"{wh.code} · {rec.location}", a.qty, "available", warehouse=wh.id)
    if a.state == "remote_hold":
        src.category = "remote_hold"
        src.detail = f"Held at {wh.name}: transfer it or buy instead"
    elif a.review:
        src.category = "review"
    elif rec.quality_state != "accepted":
        src.category = "blocked"
        src.detail = f"Inventory is {rec.quality_state}"
    elif rec.stage in ("picked", "staged"):
        src.category = rec.stage
    return src


# ---------------------------------------------------------------- requirement status and next action

# Precedence: the first matching state is the requirement's one status.
ITEM_STATES = ["short", "decision_needed", "transfer_decision", "arrives_late", "arrival_unknown",
               "on_order", "ready_to_stage", "staged"]


def _item_state(ir: "ItemReadiness", wo: WorkOrder) -> tuple[str, dict | None]:
    """One status and one next action per requirement, so screens never need a column per bucket."""
    if wo.state != "finalized":
        return ("not_reserved" if wo.state == "draft" else "canceled"), None
    if ir.uncovered:
        return "short", {"kind": "buy", "qty": ir.uncovered}
    if ir.review:
        src = next((s for s in ir.sources if s.category in ("review", "blocked")), None)
        return "decision_needed", {"kind": "resolve_shortage", "qty": ir.review,
                                   "po_line_id": src.source_id if src and src.source_type == "po_line" else None}
    if ir.remote_hold:
        src = next(s for s in ir.sources if s.category == "remote_hold")
        return "transfer_decision", {"kind": "decide_transfer", "qty": ir.remote_hold, "allocation_id": src.allocation_id,
                                     "from_warehouse": src.warehouse}
    incoming = [s for s in ir.sources if s.category == "incoming"]
    late = next((s for s in incoming if s.timing in ("late", "timing_review")), None)
    if late:
        return "arrives_late", {"kind": "update_arrival", "qty": ir.late_qty, "po_id": late.po_id}
    unknown = next((s for s in incoming if s.timing == "unknown"), None)
    if unknown:
        return "arrival_unknown", {"kind": "get_arrival_date", "qty": unknown.qty, "po_id": unknown.po_id}
    if ir.incoming:
        return "on_order", None
    if ir.staged < ir.required:
        return "ready_to_stage", {"kind": "pick_stage", "qty": ir.required - ir.staged}
    return "staged", None


# ---------------------------------------------------------------- work-order level

OUTLOOK_HEADLINES = {
    "not_reserved": "Draft — nothing reserved yet",
    "canceled": "Canceled",
    "ready": "Ready — every component is staged",
    "on_track": "On track — material is available or arriving before production start",
    "at_risk": "At risk — an arrival date, transfer, or fixture needs follow-up",
    "action_needed": "Action needed — material is short or a shortage decision is open",
}


def work_order_status(snap: Snapshot, r: Readiness, wo: WorkOrder) -> dict:
    """Roll requirement statuses up into one outlook and the list of next actions."""
    items = sorted((r.items[i.id] for i in snap.items_by_wo.get(wo.id, [])),
                   key=lambda i: ITEM_STATES.index(i.state) if i.state in ITEM_STATES else 99)
    fixtures = snap.fixtures_by_wo.get(wo.id, [])
    actions: list[dict] = []
    if wo.state != "finalized":
        outlook = "not_reserved" if wo.state == "draft" else "canceled"
        if wo.state == "draft":
            actions.append({"kind": "finalize", "label": "Finalize to reserve stock"})
    else:
        states = {i.state for i in items}
        blocking = {e.id: e for i in items for e in snap.exceptions_by_item.get(i.item_id, [])
                    if e.blocking and e.state != "closed"}
        pending_fixtures = [f for f in fixtures if f.coverage_state != "covered"]
        for i in items:
            if i.action:
                actions.append({**i.action, "state": i.state, "item_id": i.item_id, "part_id": i.part_id,
                                "part_number": i.part_number})
        for f in pending_fixtures:
            actions.append({"kind": "review_fixture", "fixture_id": f.id, "label": f.fixture_type, "qty": f.quantity})
        for e in blocking.values():
            actions.append({"kind": "resolve_exception", "exception_id": e.id, "label": e.title})
        if states & {"short", "decision_needed"} or blocking:
            outlook = "action_needed"
        elif states & {"transfer_decision", "arrives_late", "arrival_unknown"} or pending_fixtures:
            outlook = "at_risk"
        elif states <= {"staged"}:
            outlook = "ready"
        else:
            outlook = "on_track"
    return {
        "outlook": outlook,
        "headline": OUTLOOK_HEADLINES[outlook],
        "ready": outlook == "ready",
        "next_actions": actions,
        "kit": {"lines": len(items), "staged": sum(i.state == "staged" for i in items),
                "short_lines": sum(i.state in ("short", "decision_needed") for i in items)},
    }


def material_shortages(snap: Snapshot, r: Readiness) -> list[dict]:
    """Supply sources allocated beyond what they can deliver: one issue each, listing every affected order."""
    out = []
    for lid, q in r.line_quantities.items():
        claims = [a for a in r.allocs if a.source_type == "po_line" and a.source_id == lid]
        if not any(a.review for a in claims):
            continue
        line = snap.lines[lid]
        po = snap.pos[line.po_id]
        part = snap.parts[line.part_id]
        scrapped = sum(rec.qty for rec in snap.inventory.values()
                       if rec.origin_po_line_id == lid and rec.quality_state == "scrapped")
        affected = []
        for a in claims:
            item = snap.items[a.item_id]
            wo = snap.work_orders[item.work_order_id]
            affected.append({"allocation_id": a.id, "work_order_item_id": item.id, "work_order_id": wo.id,
                             "work_order_number": wo.number, "production_start_date": wo.production_start_date,
                             "required_qty": item.required_qty, "allocated_qty": a.qty})
        affected.sort(key=lambda x: x["production_start_date"])
        out.append({
            "po_line_id": lid, "po_id": po.id, "label": snap.line_label(lid), "part_id": part.id,
            "part_number": part.part_number, "description": part.description,
            "supplier": snap.suppliers[po.supplier_id].name,
            "allocated": q.claims, "available": q.pooled_accepted, "in_qa": q.pooled_pending,
            "not_received": q.outstanding, "scrapped": scrapped, "short": q.deficit, "affected": affected,
            "exceptions": [e.id for e in snap.exceptions.values() if e.state != "closed"
                           and any(l.work_order_item_id in {x["work_order_item_id"] for x in affected}
                                   for l in snap.exception_links.get(e.id, []))],
            "earliest_start": affected[0]["production_start_date"] if affected else None,
        })
    return out
