#!/bin/sh
# Single controlled migration step, then one server process.
# Startup fails (non-zero exit) if migrations fail.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
