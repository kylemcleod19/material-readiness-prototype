# Same verbs as dev.ps1 (for machines without make).
.PHONY: up down migrate seed reset test logs web-dev build

up:
	docker compose up -d --build

down:
	docker compose down

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python -m app.seed seed

# Truncates the disposable demo database and restores the seeded state.
reset:
	docker compose exec api python -m app.seed reset

test:
	docker compose exec api python -m pytest

logs:
	docker compose logs -f api web

web-dev:
	cd frontend && npm install && npm run dev

build:
	cd frontend && npm run build
