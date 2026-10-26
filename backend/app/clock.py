"""One clock for business dates. Every due/overdue/late comparison goes through today()."""
from datetime import date, datetime, timezone

from app.config import get_settings


def today() -> date:
    return get_settings().demo_today or date.today()


def now() -> datetime:
    return datetime.now(timezone.utc)
