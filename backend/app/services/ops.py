"""Transaction boundary for business actions, with duplicate-submit protection."""
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.models import OperationLog
from app.services.common import Conflict


def run_action(db: Session, op_id: str | None, action: str, fn: Callable[[], Any]) -> Any:
    """Run fn and commit everything it changed together, or roll back completely.

    A repeated op_id returns the first response without re-running the action. Two
    concurrent submits of the same op_id race on the operation_log primary key; the
    loser rolls back and returns the winner's response.
    """
    if op_id:
        prior = db.get(OperationLog, op_id)
        if prior is not None:
            if prior.action != action:
                raise Conflict("Operation id was already used for a different action")
            return prior.response
    try:
        payload = jsonable_encoder(fn())
        if op_id:
            db.add(OperationLog(op_id=op_id, action=action, response=payload))
        db.commit()
        return payload
    except IntegrityError:
        db.rollback()
        if op_id:
            prior = db.get(OperationLog, op_id)
            if prior is not None:
                return prior.response
        raise
    except StaleDataError:
        db.rollback()
        raise Conflict("Record changed concurrently; refresh and retry")
    except Exception:
        db.rollback()
        raise
