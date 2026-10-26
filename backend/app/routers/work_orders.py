from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.routers.deps import get_actor
from app.services import allocations as svc
from app.services import views
from app.services.common import Actor
from app.services.ops import run_action

router = APIRouter(tags=["work orders"])


@router.get("/work-orders")
def list_work_orders(db: Session = Depends(get_db)):
    return views.work_orders(db)


@router.get("/work-orders/{wo_id}")
def get_work_order(wo_id: str, db: Session = Depends(get_db)):
    return views.work_order_detail(db, wo_id)


@router.post("/work-orders")
def create_work_order(body: schemas.WorkOrderCreate, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    def act():
        wo = svc.create_work_order(db, actor, number=body.number, title=body.title, program_id=body.program_id,
                                   warehouse_id=body.warehouse_id, production_start_date=body.production_start_date,
                                   build_qty=body.build_qty, items=[i.model_dump() for i in body.items],
                                   fixtures=[f.model_dump() for f in body.fixtures])
        return {"work_order_id": wo.id}
    return run_action(db, body.op_id, "work_order.create", act)


@router.post("/work-orders/{wo_id}/finalize")
def finalize(wo_id: str, body: schemas.Op, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "work_order.finalize", lambda: svc.finalize_work_order(db, actor, wo_id, body.op_id))


@router.post("/work-orders/{wo_id}/cancel")
def cancel(wo_id: str, body: schemas.CancelIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "work_order.cancel",
                      lambda: svc.cancel_work_order(db, actor, wo_id, body.reason, body.op_id))


@router.post("/work-order-items/{item_id}/reduce")
def reduce(item_id: str, body: schemas.ReduceIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "work_order_item.reduce",
                      lambda: svc.reduce_requirement(db, actor, item_id, body.new_required_qty, body.op_id))


@router.post("/work-order-items/{item_id}/allocations")
def assign(item_id: str, body: schemas.AssignIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "allocation.assign",
                      lambda: svc.assign_supply(db, actor, item_id, body.source_type, body.source_id, body.qty, body.op_id))


@router.post("/allocations/{alloc_id}/confirm-transfer")
def confirm_hold(alloc_id: str, body: schemas.ConfirmHoldIn, db: Session = Depends(get_db),
                 actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "remote_hold.confirm",
                      lambda: svc.confirm_remote_hold(db, actor, alloc_id, body.expected_arrival, body.op_id))


@router.post("/allocations/{alloc_id}/release-hold")
def release_hold(alloc_id: str, body: schemas.Op, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "remote_hold.release",
                      lambda: svc.release_remote_hold(db, actor, alloc_id, body.op_id))


@router.post("/transfers/{transfer_id}/update")
def update_transfer(transfer_id: str, body: schemas.TransferUpdateIn, db: Session = Depends(get_db),
                    actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "transfer.update",
                      lambda: svc.update_transfer(db, actor, transfer_id, status=body.status,
                                                  expected_arrival=body.expected_arrival, op_id=body.op_id))


@router.post("/transfers/{transfer_id}/receive")
def receive_transfer(transfer_id: str, body: schemas.QtyOp, db: Session = Depends(get_db),
                     actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "transfer.receive",
                      lambda: svc.receive_transfer(db, actor, transfer_id, body.op_id))


@router.post("/fixture-requirements/{fixture_id}/review")
def review_fixture(fixture_id: str, body: schemas.FixtureReviewIn, db: Session = Depends(get_db),
                   actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "fixture.review",
                      lambda: svc.review_fixture(db, actor, fixture_id, body.coverage_state, body.note, body.op_id))
