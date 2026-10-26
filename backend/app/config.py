from datetime import date
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Point any postgres URL (Railway hands out postgres://) at the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://", "postgresql+psycopg2://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    if url.startswith("postgresql+psycopg://"):
        return url
    raise ValueError("DATABASE_URL must be a PostgreSQL URL")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    # Single clock source for the demo. Fixed so seeded due/overdue states never drift.
    demo_today: date | None = date(2026, 11, 24)
    demo_reset_enabled: bool = False
    # When set, POST /api/demo/reset also requires a matching X-Demo-Reset-Token header.
    demo_reset_token: str | None = None
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @field_validator("database_url")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return normalize_database_url(v)

    @field_validator("demo_today", mode="before")
    @classmethod
    def _blank_today(cls, v):
        return None if v == "" else v


@lru_cache
def get_settings() -> Settings:
    return Settings()
