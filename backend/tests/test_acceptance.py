"""Consequential behavior from the PRD (§5.5) and architecture guidelines (§10).

Each test starts from the seeded demo state:
  PO-5001-1: 100 ACT-100, allocated WO-1001 40 / WO-1002 30 / WO-1003 30 (SH-7001)
  PO-5002-1: 100 HAR-200, 70 allocated, 30 unallocated
  PO-5003-1: 80 FIN-600, WO-1004 50 (Dec 3 start); SH-7002 50 due Dec 1, check-in due Nov 23
"""
import threading
import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Allocation, InventoryRecord, MaterialException, PurchaseOrder, QABatch, ReceiptLine
from app.services import allocations, warehouse
from app.services.common import Actor, DomainError

ACT_LINE = "pol_5001_1"
HAR_LINE = "pol_5002_1"


def op() -> str:
    return str(uuid.uuid4())


def wo(client, number):
    return next(w for w in client.get("/api/work-orders").json() if w["number"] == number)


def wo_detail(client, wo_id):
    return client.get(f"/api/work-orders/{wo_id}").json()


def item(client, wo_id, part_number):
    return next(i for i in wo_detail(client, wo_id)["items"] if i["part_number"] == part_number)


def receive(client, qty, op_id=None):
    r = client.post("/api/receipts", json={
        "op_id": op_id or op(), "warehouse_id": "wh_west", "shipment_id": "sh_7001",
        "lines": [{"po_line_id": ACT_LINE, "shipment_line_id": "shl_7001_1", "qty": qty}]})
    assert r.status_code == 200, r.text
    return r.json()


def complete_qa(client, batch_id, accepted, rejected, op_id=None):
    r = client.post(f"/api/qa-batches/{batch_id}/complete",
                    json={"op_id": op_id or op(), "accepted_qty": accepted, "rejected_qty": rejected})
    assert r.status_code == 200, r.text
    return r.json()


def act100_inventory(db):
    rows = db.scalars(select(InventoryRecord).where(InventoryRecord.part_id == "prt_act100")).all()
    return {state: sum(r.qty for r in rows if r.quality_state == state) for state in ("pending", "accepted", "scrapped")}


def po_line(client, line_id):
    po = client.get("/api/purchase-orders/" + line_id.replace("pol_", "po_").rsplit("_", 1)[0]).json()
    return next(l for l in po["lines"] if l["id"] == line_id)


# 1 ---------------------------------------------------------------------------------------


def test_shared_qa_rejection_requires_review_without_choosing_a_loser(client, db):
    rec = receive(client, 100)
    res = complete_qa(client, rec["lines"][0]["qa_batch_id"], 80, 20)
    assert res["deficit"] == 20

    assert act100_inventory(db) == {"pending": 0, "accepted": 80, "scrapped": 20}
    for number, claim in (("WO-1001", 40), ("WO-1002", 30), ("WO-1003", 30)):
        w = wo(client, number)
        it = item(client, w["id"], "ACT-100")
        assert w["outlook"] == "at_risk" and it["state"] == "allocation_decision"
        # Not claimed short, not claimed covered: the whole allocation needs a decision.
        assert it["review"] == claim and it["uncovered"] == 0 and it["available"] == 0

    queue = client.get("/api/views/purchasing-queue").json()
    [shortage] = queue["allocate_material"]
    assert shortage["kind"] == "shortage" and [i["type"] for i in shortage["issues"]] == ["qa_rejection"]
    assert shortage["allocated"] == 100 and shortage["available"] == 80
    assert shortage["scrapped"] == 20 and shortage["short"] == 20
    [exc] = [e for e in client.get("/api/exceptions").json() if e["type"] == "qa_rejection"]
    assert {l["work_order_number"] for l in exc["links"]} == {"WO-1001", "WO-1002", "WO-1003"}

    # Ambiguous claims are not pickable.
    picks = client.get("/api/views/warehouse-queue").json()["picks"]
    assert not [p for p in picks if p["part_number"] == "ACT-100"]


def test_rejection_with_spare_supply_still_raises_purchasing_exception(client, db):
    # Release 20 of the claims first so the line has spare supply.
    client.post("/api/work-order-items/woi_1003_1/reduce", json={"op_id": op(), "new_required_qty": 10})
    rec = receive(client, 100)
    res = complete_qa(client, rec["lines"][0]["qa_batch_id"], 85, 15)
    assert res["deficit"] == 0 and res["exception_id"]
    exc = db.get(MaterialException, res["exception_id"])
    assert exc.type == "qa_rejection" and exc.affected_qty == 15
    assert item(client, "wo_1003", "ACT-100")["state"] != "allocation_decision"


# 2 ---------------------------------------------------------------------------------------


def test_partial_receipt_conserves_quantity_and_ignores_duplicate_submits(client, db):
    receipt_op, qa_op = op(), op()
    first = receive(client, 40, receipt_op)
    again = receive(client, 40, receipt_op)
    assert first == again
    assert db.scalar(select(func.count()).select_from(ReceiptLine)) == 1

    batch = first["lines"][0]["qa_batch_id"]
    complete_qa(client, batch, 40, 0, qa_op)
    complete_qa(client, batch, 40, 0, qa_op)
    assert act100_inventory(db) == {"pending": 0, "accepted": 40, "scrapped": 0}

    line = po_line(client, ACT_LINE)
    assert line["outstanding"] == 60 and line["received"] == 40
    assert line["received_unassigned"] == 40 and line["allocated"] == 100 and line["deficit"] == 0
    # Enough remaining incoming supply: commitments preserved, nobody flagged for review.
    for number in ("WO-1001", "WO-1002", "WO-1003"):
        assert item(client, wo(client, number)["id"], "ACT-100")["review"] == 0

    # Planner chooses who gets the available 40; the same units are never counted twice.
    claim = next(a for a in line["allocations"] if a["work_order_number"] == "WO-1001")
    r = client.post(f"/api/allocations/{claim['allocation_id']}/handoff", json={"op_id": op(), "qty": 40})
    assert r.status_code == 200, r.text
    it = item(client, "wo_1001", "ACT-100")
    assert it["available"] == 40 and it["incoming"] == 0
    line = po_line(client, ACT_LINE)
    assert line["allocated"] == 60 and line["outstanding"] == 60 and line["received_unassigned"] == 0

    # Staging changes stage only.
    available = next(s for s in it["sources"] if s["category"] == "available")
    r = client.post(f"/api/allocations/{available['allocation_id']}/pick",
                    json={"op_id": op(), "qty": 40, "location": "KIT-1001", "stage_direct": True})
    assert r.status_code == 200, r.text
    assert act100_inventory(db)["accepted"] == 40
    assert item(client, "wo_1001", "ACT-100")["staged"] == 40


# 3 ---------------------------------------------------------------------------------------


def test_incoming_assignment_respects_unallocated_balance(client):
    r = client.post("/api/work-order-items/woi_1008_1/allocations",
                    json={"op_id": op(), "source_type": "po_line", "source_id": HAR_LINE, "qty": 20})
    assert r.json()["remaining_unallocated"] == 10
    w = wo(client, "WO-1008")
    assert w["outlook"] == "on_track" and not w["kit_ready"]  # on order, not ready
    assert item(client, "wo_1008", "HAR-200")["state"] == "on_order"
    assert po_line(client, HAR_LINE)["unallocated"] == 10


def test_concurrent_assignments_cannot_exceed_source(client):
    # A second West requirement for HAR-200 competing for the same 30 unallocated units.
    r = client.post("/api/work-orders", json={
        "number": "WO-1099", "title": "Competing build", "program_id": "prg_kestrel", "warehouse_id": "wh_west",
        "production_start_date": "2026-12-28", "items": [{"part_id": "prt_har200", "required_qty": 20}]})
    wo_id = r.json()["work_order_id"]
    client.post(f"/api/work-orders/{wo_id}/finalize", json={})
    other_item = wo_detail(client, wo_id)["items"][0]["item_id"]

    actor = Actor("test", "purchasing")
    barrier = threading.Barrier(2)
    results = {}

    def attempt(item_id):
        with SessionLocal() as s:
            barrier.wait()
            try:
                allocations.assign_supply(s, actor, item_id, "po_line", HAR_LINE, 20)
                s.commit()
                results[item_id] = "ok"
            except DomainError as e:
                s.rollback()
                results[item_id] = e.message

    threads = [threading.Thread(target=attempt, args=(i,)) for i in ("woi_1008_1", other_item)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(v == "ok" for v in results.values()) == [False, True]
    assert po_line(client, HAR_LINE)["allocated"] == 90

    over = client.post("/api/work-order-items/woi_1006_1/allocations",
                       json={"op_id": op(), "source_type": "po_line", "source_id": HAR_LINE, "qty": 5})
    assert over.status_code == 422  # different destination warehouse


# 4 ---------------------------------------------------------------------------------------


def _rejected_shared_receipt(client):
    rec = receive(client, 100)
    complete_qa(client, rec["lines"][0]["qa_batch_id"], 80, 20)


def _live_allocations(db):
    db.expire_all()
    return sorted((a.id, a.qty, a.state, a.review_required) for a in db.scalars(select(Allocation)))


def test_scenario_preview_and_discard_change_nothing(client, db):
    _rejected_shared_receipt(client)
    before = _live_allocations(db)
    sid = client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"]
    preview = client.get(f"/api/scenarios/{sid}").json()
    assert not preview["feasible"]  # starts from the 100 claims against 80 available
    rows = {r["work_order_number"]: r for r in preview["rows"]}
    props = [{"work_order_item_id": rows[n]["work_order_item_id"], "available_qty": q, "incoming_qty": 0}
             for n, q in (("WO-1001", 40), ("WO-1002", 30), ("WO-1003", 10))]
    preview = client.put(f"/api/scenarios/{sid}", json={"proposals": props}).json()
    assert preview["feasible"]
    rows = {r["work_order_number"]: r for r in preview["rows"]}
    assert rows["WO-1003"]["preview"]["uncovered"] == 20  # short only in the preview
    assert rows["WO-1003"]["live"]["uncovered"] == 0
    assert _live_allocations(db) == before
    client.post(f"/api/scenarios/{sid}/discard", json={})
    assert _live_allocations(db) == before


def test_scenario_apply_commits_together_and_is_idempotent(client, db):
    _rejected_shared_receipt(client)
    sid = client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"]
    rows = {r["work_order_number"]: r for r in client.get(f"/api/scenarios/{sid}").json()["rows"]}
    props = [{"work_order_item_id": rows[n]["work_order_item_id"], "available_qty": q, "incoming_qty": 0}
             for n, q in (("WO-1001", 40), ("WO-1002", 30), ("WO-1003", 10))]
    client.put(f"/api/scenarios/{sid}", json={"proposals": props})
    apply_op = op()
    assert client.post(f"/api/scenarios/{sid}/apply", json={"op_id": apply_op}).status_code == 200
    assert client.post(f"/api/scenarios/{sid}/apply", json={"op_id": apply_op}).status_code == 200

    active = db.scalars(select(Allocation).where(Allocation.state == "committed",
                                                 Allocation.inventory_record_id.is_not(None))).all()
    act = [a for a in active if db.get(InventoryRecord, a.inventory_record_id).part_id == "prt_act100"]
    assert sum(a.qty for a in act) == 80
    assert act100_inventory(db) == {"pending": 0, "accepted": 80, "scrapped": 20}
    assert item(client, "wo_1003", "ACT-100")["uncovered"] == 20  # actual remaining shortage
    assert item(client, "wo_1001", "ACT-100")["available"] == 40
    assert client.get("/api/views/purchasing-queue").json()["allocate_material"] == []


def test_stale_scenario_apply_changes_nothing(client, db):
    _rejected_shared_receipt(client)
    sid = client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"]
    rows = {r["work_order_number"]: r for r in client.get(f"/api/scenarios/{sid}").json()["rows"]}
    props = [{"work_order_item_id": rows[n]["work_order_item_id"], "available_qty": q, "incoming_qty": 0}
             for n, q in (("WO-1001", 40), ("WO-1002", 30), ("WO-1003", 10))]
    client.put(f"/api/scenarios/{sid}", json={"proposals": props})

    # Demand changes after the preview.
    client.post("/api/work-order-items/woi_1003_1/reduce", json={"op_id": op(), "new_required_qty": 25})
    before = _live_allocations(db)
    assert client.get(f"/api/scenarios/{sid}").json()["stale"]
    r = client.post(f"/api/scenarios/{sid}/apply", json={"op_id": op()})
    assert r.status_code == 409
    assert _live_allocations(db) == before

    refreshed = client.post(f"/api/scenarios/{sid}/refresh", json={}).json()
    assert not refreshed["stale"]
    assert client.post(f"/api/scenarios/{sid}/apply", json={"op_id": op()}).status_code == 200


# 5 ---------------------------------------------------------------------------------------


def test_rejected_or_pending_material_cannot_be_assigned_or_picked(client, db):
    rec = receive(client, 100)
    pending_id = rec["lines"][0]["inventory_record_id"]
    with SessionLocal() as s, pytest.raises(DomainError):
        allocations.assign_supply(s, Actor("t", "purchasing"), "woi_1003_1", "inventory", pending_id, 1)
    res = complete_qa(client, rec["lines"][0]["qa_batch_id"], 80, 20)
    with SessionLocal() as s, pytest.raises(DomainError):
        allocations.assign_supply(s, Actor("t", "purchasing"), "woi_1003_1", "inventory", res["scrap_inventory_id"], 1)


def test_staging_does_not_increase_inventory(client, db):
    fst = item(client, "wo_1001", "FST-300")
    alloc = fst["sources"][0]["allocation_id"]
    total = lambda: sum(r.qty for r in db.scalars(select(InventoryRecord)  # noqa: E731
                        .where(InventoryRecord.part_id == "prt_fst300", InventoryRecord.warehouse_id == "wh_west")))
    assert total() == 60
    r = client.post(f"/api/allocations/{alloc}/pick", json={"op_id": op(), "qty": 20, "location": "PICK-1"})
    assert r.status_code == 200, r.text
    picked_id = r.json()["inventory_record_id"]
    client.post(f"/api/inventory/{picked_id}/stage", json={"op_id": op(), "location": "KIT-1001"})
    db.expire_all()
    assert total() == 60
    fst = item(client, "wo_1001", "FST-300")
    assert fst["staged"] == 20 and fst["available"] == 20  # staged is a subset of available


# 6 ---------------------------------------------------------------------------------------


def test_overdue_checkin_is_not_lateness_but_revised_arrival_is(client):
    queue = client.get("/api/views/purchasing-queue").json()
    [fu] = [f for f in queue["supplier_follow_up"] if f["po_number"] == "PO-5003"]
    [ck] = [{"id": x["task_id"], "status": x["status"]} for x in fu["reasons"] if x["type"] == "check_in"]
    assert ck["status"] == "overdue"
    fin = item(client, "wo_1004", "FIN-600")
    assert fin["timing"] == "on_time" and fin["late_qty"] == 0

    r = client.post(f"/api/checkins/{ck['id']}/complete", json={
        "outcome": "Supplier now ships Dec 5",
        "new_arrival": {"target_type": "shipment", "target_id": "sh_7002", "expected_arrival": "2026-12-05"}})
    assert r.status_code == 200, r.text
    fin = item(client, "wo_1004", "FIN-600")
    assert fin["timing"] == "late" and fin["late_qty"] == 50
    w = wo(client, "WO-1004")
    assert w["production_start_date"] == "2026-12-03"
    assert w["outlook"] == "at_risk"
    fin = item(client, "wo_1004", "FIN-600")
    assert fin["action"] == {"kind": "record_supplier_update", "po_id": "po_5003", "target_type": "shipment",
                             "target_id": "sh_7002", "po_number": "PO-5003", "target_label": "SH-7002"}


def test_unknown_arrival_is_unknown_not_late(client):
    client.post("/api/arrivals", json={"target_type": "shipment", "target_id": "sh_7002",
                                       "expected_arrival": None, "basis": "carrier_estimate"})
    assert item(client, "wo_1004", "FIN-600")["timing"] == "unknown"


# 7 ---------------------------------------------------------------------------------------


def test_cancellation_releases_unused_and_keeps_physical_state(client, db):
    fst = item(client, "wo_1001", "FST-300")
    client.post(f"/api/allocations/{fst['sources'][0]['allocation_id']}/pick",
                json={"op_id": op(), "qty": 20, "location": "KIT-1001", "stage_direct": True})
    r = client.post("/api/work-orders/wo_1001/cancel", json={"reason": "Program re-plan"})
    assert r.status_code == 200, r.text
    assert r.json()["physical_retained"] == 20

    po = db.get(PurchaseOrder, "po_5001")
    db.refresh(po)
    assert po.needs_review and po.status == "open"
    line = po_line(client, ACT_LINE)
    assert line["allocated"] == 60 and line["unallocated"] == 40

    staged = db.scalars(select(InventoryRecord).where(InventoryRecord.part_id == "prt_fst300",
                                                      InventoryRecord.stage == "staged")).all()
    assert sum(r.qty for r in staged) == 20
    still = db.scalars(select(Allocation).where(Allocation.inventory_record_id == staged[0].id,
                                                Allocation.state == "committed")).all()
    assert sum(a.qty for a in still) == 20  # not made available by an administrative release
    assert db.scalar(select(func.count()).select_from(MaterialException)
                     .where(MaterialException.type == "demand_change")) == 1


def test_finalize_reserves_local_stock_and_drafts_reserve_nothing(client):
    draft = item(client, "wo_1005", "BRG-500")
    assert draft["available"] == 0 and draft["available_to_allocate"] == 6
    client.post("/api/work-orders/wo_1005/finalize", json={})
    brg = item(client, "wo_1005", "BRG-500")
    har = item(client, "wo_1005", "HAR-200")
    assert brg["available"] == 4 and har["uncovered"] == 25


def test_remote_hold_is_distinct_and_transfer_conserves_units(client, db):
    thp = item(client, "wo_1004", "THP-400")
    assert thp["remote_hold"] == 10 and thp["available"] == 0
    hold = thp["sources"][0]["allocation_id"]
    r = client.post(f"/api/allocations/{hold}/confirm-transfer", json={"op_id": op(), "expected_arrival": "2026-12-01"})
    tr = r.json()["transfer_line_id"]
    assert item(client, "wo_1004", "THP-400")["incoming"] == 10
    client.post(f"/api/transfers/{tr}/receive", json={"op_id": op()})
    total = sum(r.qty for r in db.scalars(select(InventoryRecord).where(InventoryRecord.part_id == "prt_thp400")))
    assert total == 25
    assert item(client, "wo_1004", "THP-400")["available"] == 10


def test_demo_actions_run_through_services(client):
    for name in ("assign-incoming", "receive-shared", "qa-80-of-100", "supplier-revises-arrival",
                 "partial-receipt-fins", "confirm-transfer"):
        r = client.post(f"/api/demo/actions/{name}")
        assert r.status_code == 200, (name, r.text)
    assert client.post("/api/demo/actions/receive-shared").status_code == 200  # duplicate submit
    with SessionLocal() as s:
        assert s.scalar(select(func.count()).select_from(QABatch)) == 1
    assert date(2026, 11, 24).isoformat() == client.get("/api/health").json()["today"]




def queues(client):
    return client.get("/api/views/purchasing-queue").json()


# PRD 4.17 / 4.2: Source material -------------------------------------------------------------


def test_source_material_groups_by_part_and_site_with_work_order_detail(client):
    client.post("/api/work-orders/wo_1005/finalize", json={})
    src = queues(client)["source_material"]
    west = next(g for g in src["groups"] if g["part_number"] == "HAR-200" and g["warehouse"]["code"] == "WEST")
    assert west["short"] == 45 and west["reasons"] == ["short"]
    assert [r["work_order_number"] for r in west["requirements"]] == ["WO-1008", "WO-1005"]
    assert west["supplier"]["name"] == "Northgate Interconnect" and west["unallocated_on_order"] == 30
    thp = next(g for g in src["groups"] if g["part_number"] == "THP-400")
    assert thp["reasons"] == ["stock_at_other_site"] and thp["at_other_site"] == 10
    brg = next(g for g in src["groups"] if g["part_number"] == "BRG-500")
    assert brg["reasons"] == ["replenishment"] and brg["replenishment"] > 0  # a reason, not a separate page
    # By work order is the same demand, one row per requirement, with created dates.
    assert all(r["created_at"] for r in src["requirements"])
    assert {r["work_order_number"] for r in src["requirements"]} >= {"WO-1005", "WO-1006", "WO-1008", "WO-1004"}


def test_sourcing_apply_assigns_and_buys_together(client):
    r = client.post("/api/sourcing/apply", json={
        "op_id": op(), "part_id": "prt_har200", "warehouse_id": "wh_west",
        "assignments": [{"work_order_item_id": "woi_1008_1", "source_type": "po_line", "source_id": HAR_LINE, "qty": 10}],
        "purchase": {"supplier_id": "sup_northgate", "expected_arrival": "2026-12-15", "general_stock": 5,
                     "allocations": [{"work_order_item_id": "woi_1008_1", "qty": 10}]}})
    assert r.status_code == 200, r.text
    assert r.json()["remaining"] == [{"work_order_number": "WO-1008", "short": 0, "at_other_site": 0, "situation": "on_order"}]
    assert po_line(client, HAR_LINE)["unallocated"] == 20


def test_sourcing_apply_is_all_or_nothing(client, db):
    before = _live_allocations(db)
    r = client.post("/api/sourcing/apply", json={
        "op_id": op(), "part_id": "prt_har200", "warehouse_id": "wh_west",
        "assignments": [{"work_order_item_id": "woi_1008_1", "source_type": "po_line", "source_id": HAR_LINE, "qty": 10}],
        "purchase": {"supplier_id": "sup_northgate", "allocations": [{"work_order_item_id": "woi_1008_1", "qty": 50}]}})
    assert r.status_code == 422
    assert _live_allocations(db) == before


def test_buy_instead_replaces_remote_stock_in_one_step(client):
    thp = item(client, "wo_1004", "THP-400")
    assert thp["state"] == "stock_at_other_site" and thp["action"]["kind"] == "source_material"
    hold = next(s for s in thp["sources"] if s["category"] == "remote_hold")
    r = client.post("/api/sourcing/apply", json={
        "op_id": op(), "part_id": "prt_thp400", "warehouse_id": "wh_west",
        "release_holds": [{"allocation_id": hold["allocation_id"], "qty": 10}],
        "purchase": {"supplier_id": "sup_coolfab", "expected_arrival": "2026-12-01",
                     "allocations": [{"work_order_item_id": "woi_1004_2", "qty": 10}]}})
    assert r.status_code == 200, r.text
    thp = item(client, "wo_1004", "THP-400")
    assert thp["remote_hold"] == 0 and thp["incoming"] == 10 and thp["uncovered"] == 0


def test_cannot_take_more_from_another_site_than_needed(client):
    r = client.post("/api/sourcing/apply", json={
        "op_id": op(), "part_id": "prt_fst300", "warehouse_id": "wh_west",
        "transfers": [{"work_order_item_id": "woi_1001_2", "inventory_record_id": "inv_ctrl_fst300", "qty": 1}]})
    assert r.status_code == 422  # WO-1001's FST-300 is already fully allocated


# PRD 4.18: Supplier follow-up ---------------------------------------------------------------


def test_supplier_update_records_dates_completes_checkin_and_schedules_next(client):
    [po5003] = [f for f in queues(client)["supplier_follow_up"] if f["po_number"] == "PO-5003"]
    assert [x["type"] for x in po5003["reasons"]] == ["check_in"]  # an overdue check-in alone is not lateness
    r = client.post("/api/purchase-orders/po_5003/supplier-update", json={
        "note": "Ridgeline: SH-7002 slips to Dec 5",
        "arrivals": [{"target_type": "shipment", "target_id": "sh_7002", "expected_arrival": "2026-12-05"}],
        "complete_checkin_ids": po5003["open_checkin_ids"], "next_checkin": {"due_date": "2026-12-01"}})
    assert r.status_code == 200, r.text
    [po5003] = [f for f in queues(client)["supplier_follow_up"] if f["po_number"] == "PO-5003"]
    # Completing the check-in does not remove the unresolved delivery conflict.
    assert [x["type"] for x in po5003["reasons"]] == ["late_arrival"] and po5003["next_checkin"] == "2026-12-01"
    assert item(client, "wo_1004", "FIN-600")["state"] == "arrives_late"


def test_supplier_update_rejects_targets_from_another_po(client):
    r = client.post("/api/purchase-orders/po_5003/supplier-update", json={
        "note": "x", "arrivals": [{"target_type": "shipment", "target_id": "sh_7001", "expected_arrival": "2026-12-05"}]})
    assert r.status_code == 422


# PRD 5.4: situations and schedule outlook ---------------------------------------------------


def test_received_material_shows_awaiting_qa_not_arriving(client):
    receive(client, 100)
    act = item(client, "wo_1001", "ACT-100")
    assert act["state"] == "awaiting_qa" and act["action"]["kind"] == "inspect"
    assert all(s["kind"] not in ("arrives_late", "arrival_unknown", "on_order") for s in act["situations"])


def test_outlook_rules(client):
    outlooks = {w["number"]: w["outlook"] for w in client.get("/api/work-orders").json()}
    assert outlooks["WO-1008"] == "at_risk"   # confirmed short
    assert outlooks["WO-1004"] == "unknown"   # stock at another site; transfer timing not confirmed
    assert outlooks["WO-1003"] == "on_track"  # allocated; known arrivals meet production start
    assert outlooks["WO-1005"] == "draft"
    client.post("/api/arrivals", json={"target_type": "shipment", "target_id": "sh_7001",
                                       "expected_arrival": None, "basis": "carrier_estimate"})
    assert {w["number"]: w["outlook"] for w in client.get("/api/work-orders").json()}["WO-1003"] == "unknown"


# PRD 4.10: Allocate material ----------------------------------------------------------------


def test_partial_receipt_becomes_allocation_decision_resolved_in_workspace(client):
    rec = receive(client, 40)
    complete_qa(client, rec["lines"][0]["qa_batch_id"], 40, 0)
    [decision] = queues(client)["allocate_material"]
    assert decision["kind"] == "received" and decision["available"] == 40 and decision["short"] == 0
    sid = client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"]
    assert client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"] == sid  # same draft reused
    rows = {x["work_order_number"]: x for x in client.get(f"/api/scenarios/{sid}").json()["rows"]}
    props = [{"work_order_item_id": rows["WO-1001"]["work_order_item_id"], "available_qty": 40, "incoming_qty": 0},
             {"work_order_item_id": rows["WO-1002"]["work_order_item_id"], "available_qty": 0, "incoming_qty": 30},
             {"work_order_item_id": rows["WO-1003"]["work_order_item_id"], "available_qty": 0, "incoming_qty": 30}]
    assert client.put(f"/api/scenarios/{sid}", json={"proposals": props}).json()["feasible"]
    assert client.post(f"/api/scenarios/{sid}/apply", json={"op_id": op()}).status_code == 200
    assert item(client, "wo_1001", "ACT-100")["available"] == 40
    assert queues(client)["allocate_material"] == []


def test_apply_can_close_the_linked_qa_issue(client, db):
    _rejected_shared_receipt(client)
    [decision] = queues(client)["allocate_material"]
    issue_id = decision["issues"][0]["id"]
    sid = client.post("/api/scenarios", json={"po_line_id": ACT_LINE}).json()["scenario_id"]
    rows = {x["work_order_number"]: x for x in client.get(f"/api/scenarios/{sid}").json()["rows"]}
    props = [{"work_order_item_id": rows[n]["work_order_item_id"], "available_qty": q, "incoming_qty": 0}
             for n, q in (("WO-1001", 40), ("WO-1002", 30), ("WO-1003", 10))]
    client.put(f"/api/scenarios/{sid}", json={"proposals": props})
    assert client.post(f"/api/scenarios/{sid}/apply", json={"op_id": op(), "close_issue_ids": [issue_id]}).status_code == 200
    db.expire_all()
    assert db.get(MaterialException, issue_id).state == "closed"
    assert item(client, "wo_1003", "ACT-100")["state"] == "short"  # the shortage itself stays visible


def test_scrapped_units_leave_inventory(client):
    rec = receive(client, 100)
    complete_qa(client, rec["lines"][0]["qa_batch_id"], 80, 20)
    summary = next(s for s in client.get("/api/inventory").json()["summary"] if s["part_number"] == "ACT-100")
    assert summary["available"] == 80 and "scrapped" not in summary
