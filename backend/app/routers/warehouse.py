from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.routers.deps import get_actor
from app.services import views
from app.services import warehouse as svc
from app.services.common import Actor
from app.services.ops import run_action

router = APIRouter(tags=["warehouse"])


@router.post("/receipts")
def receive(body: schemas.ReceiptIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "receipt.create", lambda: svc.receive(
        db, actor, warehouse_id=body.warehouse_id, shipment_id=body.shipment_id,
        lines=[l.model_dump() for l in body.lines], op_id=body.op_id))


@router.get("/qa-batches")
def qa_queue(db: Session = Depends(get_db)):
    return views.qa_queue(db)


@router.post("/qa-batches/{batch_id}/complete")
def complete_qa(batch_id: str, body: schemas.QAComplete, db: Session = Depends(get_db),
                actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "qa.complete", lambda: svc.complete_qa(
        db, actor, batch_id, body.accepted_qty, body.rejected_qty, body.note, body.op_id))


@router.get("/inventory")
def inventory(db: Session = Depends(get_db)):
    return views.inventory(db)



@router.post("/inventory/{record_id}/putaway")
def putaway(record_id: str, body: schemas.LocationIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "inventory.putaway",
                      lambda: svc.putaway(db, actor, record_id, body.location, body.op_id))


@router.post("/inventory/{record_id}/stage")
def stage(record_id: str, body: schemas.LocationIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "inventory.stage",
                      lambda: svc.stage(db, actor, record_id, body.location, body.op_id))


@router.post("/allocations/{alloc_id}/pick")
def pick(alloc_id: str, body: schemas.PickIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "inventory.pick", lambda: svc.pick(
        db, actor, alloc_id, body.qty, body.location, body.stage_direct, body.op_id))


@router.post("/allocations/{alloc_id}/handoff")
def handoff(alloc_id: str, body: schemas.HandoffIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "allocation.handoff",
                      lambda: svc.manual_handoff(db, actor, alloc_id, body.qty, body.op_id))


@router.post("/discrepancies")
def report(body: schemas.DiscrepancyIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    def act():
        exc = svc.report_discrepancy(db, actor, type=body.type, title=body.title, detail=body.detail,
                                     source_type=body.source_type, source_id=body.source_id,
                                     affected_qty=body.affected_qty, item_ids=body.work_order_item_ids,
                                     op_id=body.op_id)
        return {"exception_id": exc.id}
    return run_action(db, body.op_id, "discrepancy.report", act)
