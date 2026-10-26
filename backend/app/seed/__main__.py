"""python -m app.seed [seed|reset] — reset truncates the disposable demo database first."""
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Warehouse
from app.seed.seed_data import reset, seed


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "seed"
    with SessionLocal() as db:
        if cmd == "reset":
            reset(db)
            print("Demo database reset and seeded.")
        elif cmd == "seed":
            if db.scalars(select(Warehouse)).first():
                print("Database already has data; use 'reset' to restore the demo state.")
                return
            seed(db)
            db.commit()
            print("Demo data seeded.")
        else:
            raise SystemExit(f"Unknown command {cmd}")


if __name__ == "__main__":
    main()
