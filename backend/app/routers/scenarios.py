from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas
from app.db import get_db
from app.routers.deps import get_actor
from app.services import scenarios as svc
from app.services.common import Actor
from app.services.ops import run_action

router = APIRouter(tags=["scenarios"])


@router.post("/scenarios")
def create(body: schemas.ScenarioCreate, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "scenario.create", lambda: svc.create(db, actor, body.po_line_id, body.op_id))


@router.get("/scenarios/{scenario_id}")
def preview(scenario_id: str, db: Session = Depends(get_db)):
    return svc.preview(db, scenario_id)


@router.put("/scenarios/{scenario_id}")
def update(scenario_id: str, body: schemas.ScenarioUpdate, db: Session = Depends(get_db),
           actor: Actor = Depends(get_actor)):
    run_action(db, body.op_id, "scenario.update",
               lambda: svc.update(db, actor, scenario_id, [p.model_dump() for p in body.proposals]))
    return svc.preview(db, scenario_id)


@router.post("/scenarios/{scenario_id}/apply")
def apply(scenario_id: str, body: schemas.QtyOp, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "scenario.apply", lambda: svc.apply(db, actor, scenario_id, body.op_id))


@router.post("/scenarios/{scenario_id}/discard")
def discard(scenario_id: str, body: schemas.Op, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    return run_action(db, body.op_id, "scenario.discard", lambda: svc.discard(db, actor, scenario_id))


@router.post("/scenarios/{scenario_id}/refresh")
def refresh(scenario_id: str, body: schemas.Op, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    run_action(db, body.op_id, "scenario.refresh", lambda: svc.refresh(db, actor, scenario_id))
    return svc.preview(db, scenario_id)
