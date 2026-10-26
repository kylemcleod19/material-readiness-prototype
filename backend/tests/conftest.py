import os

# Point the app at the disposable test database before anything imports app.db.
TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://readiness:readiness@db:5432/readiness_test")
os.environ["DATABASE_URL"] = TEST_URL
os.environ["DEMO_TODAY"] = "2026-11-24"
os.environ["DEMO_RESET_ENABLED"] = "true"

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _ensure_database() -> None:
    base, name = TEST_URL.rsplit("/", 1)
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            conn.execute(f'CREATE DATABASE "{name}"')


_ensure_database()

from app.db import Base, SessionLocal, engine  # noqa: E402
import app.models  # noqa: E402,F401
from app.main import app  # noqa: E402
from app.seed.seed_data import reset  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def seeded():
    """Every test starts from the documented demo state."""
    with SessionLocal() as db:
        reset(db)
    yield


@pytest.fixture
def client():
    return TestClient(app, headers={"X-Demo-Role": "purchasing"})


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s
