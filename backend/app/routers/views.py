from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import views

router = APIRouter(prefix="/views", tags=["views"])


@router.get("/purchasing-queue")
def purchasing_queue(db: Session = Depends(get_db)):
    return views.purchasing_queue(db)


@router.get("/warehouse-queue")
def warehouse_queue(warehouse_id: str | None = None, db: Session = Depends(get_db)):
    return views.warehouse_queue(db, warehouse_id)


@router.get("/master")
def master(db: Session = Depends(get_db)):
    return views.master(db)


@router.get("/history")
def history(entity_id: str | None = None, limit: int = 100, db: Session = Depends(get_db)):
    return views.history(db, entity_id, min(limit, 500))
