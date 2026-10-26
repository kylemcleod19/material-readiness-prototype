from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.routers.deps import get_actor
from app.services import exceptions as exc_svc
from app.services import purchasing as svc
from app.services import views
from app.services.common import Actor, DomainError
from app.services.ops import run_action

router = APIRouter(tags=["purchasing"])


@router.get("/purchase-orders")
def list_pos(db: Session = Depends(get_db)):
    return views.purchase_orders(db)


@router.get("/purchase-orders/{po_id}")
def get_po(po_id: str, db: Session = Depends(get_db)):
    return views.purchase_order(db, po_id)


@router.post("/purchase-orders")
def create_po(body: schemas.POCreate, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "po.create", lambda: svc.create_po(
        db, actor, supplier_id=body.supplier_id, destination_warehouse_id=body.destination_warehouse_id,
        lines=[l.model_dump() for l in body.lines], op_id=body.op_id))


@router.post("/purchase-orders/{po_id}/review-done")
def po_review_done(po_id: str, body: schemas.NoteIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "po.review_done",
                      lambda: svc.clear_po_review(db, actor, po_id, body.note or "reviewed", body.op_id))


@router.post("/arrivals")
def update_arrival(body: schemas.ArrivalIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "arrival.update", lambda: svc.update_arrival(
        db, actor, target_type=body.target_type, target_id=body.target_id, expected_arrival=body.expected_arrival,
        basis=body.basis, note=body.note, op_id=body.op_id))


@router.post("/shipments")
def create_shipment(body: schemas.ShipmentCreate, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "shipment.create", lambda: svc.create_shipment(
        db, actor, lines=[l.model_dump() for l in body.lines], expected_arrival=body.expected_arrival,
        carrier=body.carrier, tracking_number=body.tracking_number, op_id=body.op_id))


@router.post("/po-lines/{line_id}/close-shortfall")
def close_shortfall(line_id: str, body: schemas.ShortfallIn, db: Session = Depends(get_db),
                    actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "po_line.close_shortfall",
                      lambda: svc.close_shortfall(db, actor, line_id, body.qty, body.note, body.op_id))


@router.post("/checkins")
def create_checkin(body: schemas.CheckInCreate, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "checkin.create", lambda: svc.create_checkin(
        db, actor, po_id=body.po_id, po_line_id=body.po_line_id, due_date=body.due_date, owner=body.owner,
        note=body.note, op_id=body.op_id))


@router.post("/checkins/{task_id}/complete")
def complete_checkin(task_id: str, body: schemas.CheckInComplete, db: Session = Depends(get_db),
                     actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "checkin.complete", lambda: svc.complete_checkin(
        db, actor, task_id, body.outcome, body.new_arrival.model_dump() if body.new_arrival else None, body.op_id))


@router.post("/integrations/supplier-events")
def supplier_event(body: schemas.SupplierEvent, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    """Simulated supplier/carrier feed. Recorded with channel=simulated; same rules as manual entry."""
    feed = Actor(name="supplier-feed", role="integration", channel="simulated")

    def act():
        if body.type == "acknowledgment":
            return svc.acknowledge_line(db, feed, body.po_line_id, body.date, body.op_id)
        if body.type == "revised_date":
            if body.shipment_id:
                return svc.update_arrival(db, feed, target_type="shipment", target_id=body.shipment_id,
                                          expected_arrival=body.date, basis="supplier_promise",
                                          note="supplier revised date", op_id=body.op_id)
            return svc.update_arrival(db, feed, target_type="po_line", target_id=body.po_line_id,
                                      expected_arrival=body.date, basis="supplier_promise",
                                      note="supplier revised date", op_id=body.op_id)
        if body.type == "ship_notice":
            return svc.create_shipment(db, feed, lines=[{"po_line_id": body.po_line_id, "qty": body.qty}],
                                       expected_arrival=body.date, carrier=body.carrier,
                                       tracking_number=body.tracking_number, op_id=body.op_id)
        if body.type == "tracking_update":
            return svc.tracking_update(db, feed, body.shipment_id, body.date, body.status, body.op_id)
        raise DomainError(f"Unknown supplier event type {body.type}")
    return run_action(db, body.op_id, f"supplier_event.{body.type}", act)


@router.get("/exceptions")
def list_exceptions(include_closed: bool = False, db: Session = Depends(get_db)):
    return views.exceptions(db, include_closed)


@router.post("/exceptions/{exc_id}/acknowledge")
def ack_exception(exc_id: str, body: schemas.NoteIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "exception.acknowledge",
                      lambda: exc_svc.acknowledge(db, actor, exc_id, body.note, body.op_id))


@router.post("/exceptions/{exc_id}/close")
def close_exception(exc_id: str, body: schemas.NoteIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "exception.close",
                      lambda: exc_svc.close(db, actor, exc_id, body.note or "", body.op_id))
