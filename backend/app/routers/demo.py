"""Named demo actions. Each one calls the normal services, so the demo exercises the real rules."""
from datetime import date

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Allocation, QABatch, ReceiptLine
from app.seed.seed_data import reset
from app.services import allocations, purchasing, warehouse
from app.services.common import Actor, DomainError, NotFound
from app.services.ops import run_action

router = APIRouter(prefix="/demo", tags=["demo"])

FEED = Actor(name="supplier-feed", role="integration", channel="simulated")


def _pending_batch(db: Session, po_line_id: str) -> str:
    batch = db.scalars(select(QABatch).join(ReceiptLine, ReceiptLine.id == QABatch.receipt_line_id)
                       .where(ReceiptLine.po_line_id == po_line_id, QABatch.status == "pending")).first()
    if batch is None:
        raise DomainError("No pending QA batch for that receipt yet — receive it first")
    return batch.id


def _remote_hold(db: Session, item_id: str) -> str:
    a = db.scalars(select(Allocation).where(Allocation.work_order_item_id == item_id,
                                            Allocation.state == "remote_hold")).first()
    if a is None:
        raise DomainError("No remote hold to confirm")
    return a.id


ACTIONS = {
    "assign-incoming": dict(
        title="Purchasing assigns 20 of PO-5002's 30 unallocated HAR-200 to WO-1008",
        role="purchasing",
        run=lambda db, a: allocations.assign_supply(db, a, "woi_1008_1", "po_line", "pol_5002_1", 20),
    ),
    "receive-shared": dict(
        title="Receiving logs SH-7001: 100 ACT-100 shared by WO-1001/1002/1003",
        role="warehouse",
        run=lambda db, a: warehouse.receive(db, a, warehouse_id="wh_west", shipment_id="sh_7001",
                                            lines=[{"po_line_id": "pol_5001_1", "shipment_line_id": "shl_7001_1",
                                                    "qty": 100}]),
    ),
    "qa-80-of-100": dict(
        title="QA accepts 80 of 100 ACT-100 and scraps 20",
        role="qa",
        run=lambda db, a: warehouse.complete_qa(db, a, _pending_batch(db, "pol_5001_1"), 80, 20,
                                                "20 housings out of tolerance on bore diameter"),
    ),
    "supplier-revises-arrival": dict(
        title="Simulated feed: Ridgeline revises SH-7002 (FIN-600) from Dec 1 to Dec 5",
        role="purchasing",
        feed=True,
        run=lambda db, a: purchasing.update_arrival(db, a, target_type="shipment", target_id="sh_7002",
                                                    expected_arrival=date(2026, 12, 5), basis="supplier_promise",
                                                    note="supplier revised date"),
    ),
    "partial-receipt-fins": dict(
        title="Receiving logs 40 of SH-7002's 50 FIN-600 (no QA required)",
        role="warehouse",
        run=lambda db, a: warehouse.receive(db, a, warehouse_id="wh_west", shipment_id="sh_7002",
                                            lines=[{"po_line_id": "pol_5003_1", "shipment_line_id": "shl_7002_1",
                                                    "qty": 40}]),
    ),
    "confirm-transfer": dict(
        title="Planner confirms WO-1004's remote THP-400 hold as an EAST→WEST transfer (ETA Dec 1)",
        role="purchasing",
        run=lambda db, a: allocations.confirm_remote_hold(db, a, _remote_hold(db, "woi_1004_2"), date(2026, 12, 1)),
    ),
}


@router.get("/actions")
def list_actions():
    return [{"name": k, "title": v["title"], "role": v["role"]} for k, v in ACTIONS.items()]


@router.post("/actions/{name}")
def run_demo_action(name: str, db: Session = Depends(get_db)):
    spec = ACTIONS.get(name)
    if spec is None:
        raise NotFound("Unknown demo action")
    actor = FEED if spec.get("feed") else Actor(name=f"demo-{spec['role']}", role=spec["role"])
    # Fixed op id: clicking twice is a duplicate submit, not a second receipt.
    return run_action(db, f"demo-{name}", f"demo.{name}", lambda: spec["run"](db, actor))


@router.post("/reset")
def reset_demo(db: Session = Depends(get_db), x_demo_reset_token: str | None = Header(default=None)):
    settings = get_settings()
    if not settings.demo_reset_enabled:
        raise DomainError("Demo reset is disabled in this environment", status=403)
    if settings.demo_reset_token and x_demo_reset_token != settings.demo_reset_token:
        raise DomainError("Demo reset requires the reset token", status=403)
    reset(db)
    return {"ok": True}
