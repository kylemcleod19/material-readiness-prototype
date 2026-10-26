from sqlalchemy.orm import Session

from app import clock
from app.models import EXCEPTION_TYPES_ALL, MaterialException, MaterialExceptionLink, new_id
from app.services import history
from app.services.common import Actor, DomainError, lock


def raise_exception(db: Session, actor: Actor, *, type: str, title: str, source_type: str, source_id: str,
                    owner_role: str, affected_qty: int = 0, detail: str | None = None, part_id: str | None = None,
                    blocking: bool = False, links: list[tuple[str, int | None]] = (), op_id=None) -> MaterialException:
    if type not in EXCEPTION_TYPES_ALL:
        raise DomainError(f"Unknown exception type {type}")
    exc = MaterialException(id=new_id("ex"), type=type, state="open", title=title, detail=detail,
                            source_type=source_type, source_id=source_id, part_id=part_id,
                            affected_qty=affected_qty, blocking=blocking, owner_role=owner_role, raised_by=actor.name)
    db.add(exc)
    db.flush()
    for item_id, qty in links:
        db.add(MaterialExceptionLink(id=new_id("exl"), exception_id=exc.id, work_order_item_id=item_id, claimed_qty=qty))
    db.flush()
    history.record(db, actor, exc, "exception.raise", after=history.snap(exc, "type", "title", "affected_qty"),
                   op_id=op_id)
    return exc


def acknowledge(db: Session, actor: Actor, exc_id: str, note: str | None, op_id=None) -> dict:
    exc = lock(db, MaterialException, exc_id)
    if exc.state != "open":
        raise DomainError(f"Exception is {exc.state}")
    exc.state = "acknowledged"
    if note:
        exc.resolution_note = note
    history.record(db, actor, exc, "exception.acknowledge", {"state": "open"}, {"state": "acknowledged"},
                   note=note, op_id=op_id)
    return {"exception_id": exc.id}


def close(db: Session, actor: Actor, exc_id: str, note: str, op_id=None) -> dict:
    """Record that review/follow-up happened. Does not create stock or clear any shortage."""
    if not note or not note.strip():
        raise DomainError("Record the review or follow-up action before closing")
    exc = lock(db, MaterialException, exc_id)
    if exc.state == "closed":
        raise DomainError("Exception already closed")
    prior = exc.state
    exc.state = "closed"
    exc.resolution_note = note
    exc.closed_at = clock.now()
    history.record(db, actor, exc, "exception.close", {"state": prior}, {"state": "closed"}, note=note, op_id=op_id)
    return {"exception_id": exc.id}


def append_note(db: Session, actor: Actor, exc: MaterialException, note: str, op_id=None) -> None:
    exc.resolution_note = f"{exc.resolution_note}\n{note}" if exc.resolution_note else note
    history.record(db, actor, exc, "exception.note", note=note, op_id=op_id)
