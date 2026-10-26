"""Deterministic fictional demo data. Demo date: 2026-11-24 (DEMO_TODAY).

State is built by calling the normal services, so seeded reservations and allocations obey
the same rules as anything done in the UI.
"""
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import Base
from app.models import InventoryRecord, Part, PartStockPolicy, Program, Supplier, Warehouse
from app.services import allocations, purchasing
from app.services.common import Actor

SEED = Actor(name="seed", role="system", channel="seed")
D = date

WAREHOUSES = [
    ("wh_west", "WEST", "West Assembly", "Mesa Assembly Facility", "Mesa, AZ"),
    ("wh_east", "EAST", "East Assembly", "Columbus Integration Facility", "Columbus, OH"),
    ("wh_ctrl", "CTRL", "Central Stores", "Dallas Distribution Center", "Dallas, TX"),
]
PROGRAMS = [("prg_kestrel", "Kestrel"), ("prg_halyard", "Halyard")]
SUPPLIERS = [
    ("sup_pinecrest", "Pinecrest Precision"),
    ("sup_northgate", "Northgate Interconnect"),
    ("sup_ridgeline", "Ridgeline Composites"),
    ("sup_tellus", "Tellus Bearings"),
    ("sup_summit", "Summit Fastener Supply"),
    ("sup_coolfab", "Coolfab Thermal"),
]
# id, part_number, description, requires_qa, lot_tracked, supplier, lead_time_days
PARTS = [
    ("prt_act100", "ACT-100", "Actuator housing, machined aluminum", True, False, "sup_pinecrest", 45),
    ("prt_har200", "HAR-200", "Harness assembly, 24-pin", True, False, "sup_northgate", 30),
    ("prt_fst300", "FST-300", "Fastener kit, M4 stainless", False, False, "sup_summit", 7),
    ("prt_thp400", "THP-400", "Thermal pad, 40 x 40 mm", False, False, "sup_coolfab", 14),
    ("prt_brg500", "BRG-500", "Angular contact bearing (long lead)", True, True, "sup_tellus", 120),
    ("prt_fin600", "FIN-600", "Composite fin panel", False, False, "sup_ridgeline", 60),
]
# id, part, warehouse, location, qty, lot
OPENING_STOCK = [
    ("inv_west_fst300", "prt_fst300", "wh_west", "A-01-03", 60, None),
    ("inv_ctrl_fst300", "prt_fst300", "wh_ctrl", "R-12-01", 200, None),
    ("inv_east_thp400", "prt_thp400", "wh_east", "B-02-01", 25, None),
    ("inv_west_brg500", "prt_brg500", "wh_west", "S-04-02", 6, "TB-2291"),
]

WORK_ORDERS = [
    dict(wo_id="wo_1001", number="WO-1001", title="Kestrel actuator bay, lot 1", program_id="prg_kestrel",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 8), build_qty=20,
         items=[dict(id="woi_1001_1", part_id="prt_act100", required_qty=40),
                dict(id="woi_1001_2", part_id="prt_fst300", required_qty=20)],
         fixtures=[dict(id="fx_1001_1", operation="OP20 Mill", fixture_type="Housing milling fixture HMF-2", quantity=4)]),
    dict(wo_id="wo_1002", number="WO-1002", title="Kestrel actuator bay, lot 2", program_id="prg_kestrel",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 10), build_qty=15,
         items=[dict(id="woi_1002_1", part_id="prt_act100", required_qty=30),
                dict(id="woi_1002_2", part_id="prt_fst300", required_qty=10)],
         fixtures=[dict(id="fx_1002_1", operation="OP20 Mill", fixture_type="Housing milling fixture HMF-2", quantity=4)]),
    dict(wo_id="wo_1003", number="WO-1003", title="Halyard control section", program_id="prg_halyard",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 15), build_qty=10,
         items=[dict(id="woi_1003_1", part_id="prt_act100", required_qty=30),
                dict(id="woi_1003_2", part_id="prt_har200", required_qty=20)]),
    dict(wo_id="wo_1004", number="WO-1004", title="Halyard fin set", program_id="prg_halyard",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 3), build_qty=10,
         items=[dict(id="woi_1004_1", part_id="prt_fin600", required_qty=50),
                dict(id="woi_1004_2", part_id="prt_thp400", required_qty=10)],
         fixtures=[dict(id="fx_1004_1", operation="OP10 Bond", fixture_type="Fin bonding jig FBJ-1", quantity=2)]),
    dict(wo_id="wo_1005", number="WO-1005", title="Kestrel actuator bay, lot 3 (proposed)", program_id="prg_kestrel",
         warehouse_id="wh_west", production_start_date=D(2027, 1, 12), build_qty=12,
         items=[dict(id="woi_1005_1", part_id="prt_har200", required_qty=25),
                dict(id="woi_1005_2", part_id="prt_brg500", required_qty=4)]),
    dict(wo_id="wo_1006", number="WO-1006", title="Halyard east integration", program_id="prg_halyard",
         warehouse_id="wh_east", production_start_date=D(2026, 12, 18), build_qty=5,
         items=[dict(id="woi_1006_1", part_id="prt_har200", required_qty=15)]),
    dict(wo_id="wo_1007", number="WO-1007", title="Halyard harness prep", program_id="prg_halyard",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 20), build_qty=25,
         items=[dict(id="woi_1007_1", part_id="prt_har200", required_qty=50)]),
    dict(wo_id="wo_1008", number="WO-1008", title="Kestrel avionics tray", program_id="prg_kestrel",
         warehouse_id="wh_west", production_start_date=D(2026, 12, 22), build_qty=10,
         items=[dict(id="woi_1008_1", part_id="prt_har200", required_qty=20)]),
]
# When each work order was created upstream (fixed, before the demo date).
CREATED = {
    "wo_1001": (2026, 10, 2), "wo_1002": (2026, 10, 2), "wo_1003": (2026, 10, 9), "wo_1004": (2026, 10, 14),
    "wo_1005": (2026, 11, 18), "wo_1006": (2026, 10, 27), "wo_1007": (2026, 11, 3), "wo_1008": (2026, 11, 10),
}
FINALIZE = ["wo_1001", "wo_1002", "wo_1003", "wo_1004", "wo_1006", "wo_1007", "wo_1008"]

PURCHASE_ORDERS = [
    dict(po_id="po_5001", number="PO-5001", supplier_id="sup_pinecrest", destination_warehouse_id="wh_west",
         lines=[dict(id="pol_5001_1", part_id="prt_act100", qty=100, expected_arrival=D(2026, 12, 2),
                     arrival_basis="supplier_promise")]),
    dict(po_id="po_5002", number="PO-5002", supplier_id="sup_northgate", destination_warehouse_id="wh_west",
         lines=[dict(id="pol_5002_1", part_id="prt_har200", qty=100, expected_arrival=D(2026, 12, 12),
                     arrival_basis="supplier_promise")]),
    dict(po_id="po_5003", number="PO-5003", supplier_id="sup_ridgeline", destination_warehouse_id="wh_west",
         lines=[dict(id="pol_5003_1", part_id="prt_fin600", qty=80, expected_arrival=D(2026, 12, 9),
                     arrival_basis="supplier_promise")]),
]
SHIPMENTS = [
    dict(shipment_id="sh_7001", number="SH-7001", expected_arrival=D(2026, 12, 2), carrier="Freightline",
         tracking_number="FL-448812", lines=[dict(id="shl_7001_1", po_line_id="pol_5001_1", qty=100)]),
    dict(shipment_id="sh_7002", number="SH-7002", expected_arrival=D(2026, 12, 1), carrier="Coastal Air Cargo",
         tracking_number="CAC-90231", lines=[dict(id="shl_7002_1", po_line_id="pol_5003_1", qty=50)]),
]
# (work-order item, PO line, qty): the planner's earlier manual assignments
ASSIGNMENTS = [
    ("woi_1001_1", "pol_5001_1", 40),
    ("woi_1002_1", "pol_5001_1", 30),
    ("woi_1003_1", "pol_5001_1", 30),
    ("woi_1003_2", "pol_5002_1", 20),
    ("woi_1007_1", "pol_5002_1", 50),
    ("woi_1004_1", "pol_5003_1", 50),
]
CHECKINS = [
    dict(task_id="ck_5003_a", po_id="po_5003", po_line_id="pol_5003_1", due_date=D(2026, 11, 23),
         owner="demo-purchasing", note="Confirm SH-7002 departs on schedule for the Dec 1 delivery."),
    dict(task_id="ck_5002_a", po_id="po_5002", po_line_id="pol_5002_1", due_date=D(2026, 12, 2),
         owner="demo-purchasing", note="Confirm Dec 12 ship date; supplier flagged connector backorder risk."),
]
COVERED_FIXTURES = [("fx_1002_1", "4 HMF-2 fixtures on site, shared with WO-1001; scheduling not verified"),
                    ("fx_1004_1", "2 FBJ-1 jigs serviceable in bay 3")]
STOCK_POLICIES = [("psp_brg500_west", "prt_brg500", "wh_west", 10, 30)]


def truncate_all(db: Session) -> None:
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


def seed(db: Session) -> None:
    for id_, code, name, facility, city in WAREHOUSES:
        db.add(Warehouse(id=id_, code=code, name=name, facility=facility, city=city))
    for id_, name in PROGRAMS:
        db.add(Program(id=id_, name=name))
    for id_, name in SUPPLIERS:
        db.add(Supplier(id=id_, name=name, contact_email=f"orders@{name.split()[0].lower()}.example"))
    db.flush()
    for id_, pn, desc, qa, lot, sup, lead in PARTS:
        db.add(Part(id=id_, part_number=pn, description=desc, uom="ea", requires_qa=qa, lot_tracked=lot,
                    preferred_supplier_id=sup, lead_time_days=lead))
    db.flush()
    for id_, part, wh, reorder, target in STOCK_POLICIES:
        db.add(PartStockPolicy(id=id_, part_id=part, warehouse_id=wh, reorder_point=reorder, target_level=target))
    for id_, part, wh, loc, qty, lot in OPENING_STOCK:
        db.add(InventoryRecord(id=id_, part_id=part, warehouse_id=wh, location=loc, lot=lot, qty=qty,
                               quality_state="accepted", stage="stored", received_on=D(2026, 10, 1)))
    db.flush()

    for wo in WORK_ORDERS:
        created = allocations.create_work_order(db, SEED, **wo)
        created.created_at = datetime(*CREATED[created.id], 15, 0, tzinfo=timezone.utc)
    for po in PURCHASE_ORDERS:
        purchasing.create_po(db, SEED, **po)
    for sh in SHIPMENTS:
        purchasing.create_shipment(db, SEED, **sh)
    for wo_id in FINALIZE:
        allocations.finalize_work_order(db, SEED, wo_id)
    for item_id, line_id, qty in ASSIGNMENTS:
        allocations.assign_supply(db, SEED, item_id, "po_line", line_id, qty)
    for ck in CHECKINS:
        purchasing.create_checkin(db, SEED, **ck)
    for fx_id, note in COVERED_FIXTURES:
        allocations.review_fixture(db, SEED, fx_id, "covered", note)
    db.flush()


def reset(db: Session) -> None:
    truncate_all(db)
    seed(db)
    db.commit()
