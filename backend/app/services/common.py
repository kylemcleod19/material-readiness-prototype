from dataclasses import dataclass
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

T = TypeVar("T")


class DomainError(Exception):
    status = 422

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.message = message
        if status is not None:
            self.status = status


class NotFound(DomainError):
    status = 404


class Conflict(DomainError):
    status = 409


@dataclass(frozen=True)
class Actor:
    name: str
    role: str
    # manual = a person entered it; simulated = the demo supplier/carrier feed; system = derived rule.
    channel: str = "manual"


SYSTEM = Actor(name="system", role="system", channel="system")


def get_or_404(db: Session, model: type[T], id_: str) -> T:
    obj = db.get(model, id_)
    if obj is None:
        raise NotFound(f"{model.__name__} {id_} not found")
    return obj


def lock(db: Session, model: type[T], id_: str) -> T:
    """SELECT ... FOR UPDATE, refreshing any stale copy held in the session."""
    obj = db.scalars(
        select(model).where(model.id == id_).with_for_update().execution_options(populate_existing=True)
    ).first()
    if obj is None:
        raise NotFound(f"{model.__name__} {id_} not found")
    return obj


def lock_all(db: Session, stmt):
    return list(db.scalars(stmt.with_for_update().execution_options(populate_existing=True)))
