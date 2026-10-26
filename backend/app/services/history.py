from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import ChangeHistory
from app.services.common import Actor


def _plain(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def snap(obj: Any, *fields: str) -> dict:
    return {f: _plain(getattr(obj, f)) for f in fields}


def record(
    db: Session,
    actor: Actor,
    entity: Any,
    action: str,
    before: dict | None = None,
    after: dict | None = None,
    note: str | None = None,
    op_id: str | None = None,
) -> None:
    """Append a history row inside the caller's transaction."""
    db.add(
        ChangeHistory(
            actor=actor.name,
            role=actor.role,
            channel=actor.channel,
            op_id=op_id,
            entity_type=entity.__tablename__,
            entity_id=entity.id,
            action=action,
            before=before,
            after=after,
            note=note,
        )
    )
