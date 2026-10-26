from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import clock
from app.config import get_settings
from app.db import engine
from app.routers import demo, purchasing, scenarios, views, warehouse, work_orders
from app.services.common import DomainError

app = FastAPI(title="Material Readiness", version="0.1.0")
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DomainError)
def domain_error(_: Request, exc: DomainError):
    return JSONResponse({"detail": exc.message}, status_code=exc.status)


def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "today": clock.today()}


app.get("/health")(health)

api = APIRouter(prefix="/api")
api.get("/health")(health)
for r in (work_orders.router, purchasing.router, warehouse.router, scenarios.router, views.router, demo.router):
    api.include_router(r)
app.include_router(api)
