# Material Readiness Prototype

A prototype for one question: **What material will be ready for this work order, when, and what action is needed to make it ready?**

It follows one connected workflow: work-order demand → supply allocation → receiving → simple QA → shortage review → manual allocation scenario → staging. The product decisions are in [reference files/Anduril-Material-Readiness-Concept-PRD.md](reference%20files/Anduril-Material-Readiness-Concept-PRD.md). The architecture guidance is in [reference files/Anduril-Material-Readiness-Architecture-Guidelines.md](reference%20files/Anduril-Material-Readiness-Architecture-Guidelines.md).

All data is fictional.

## Run it

You need Docker. You only need Node 20+ if you want the Vite dev server. Python does not need to be installed locally.

```powershell
./dev.ps1 up        # build and start db, api (migrations run on startup), web
./dev.ps1 seed      # load the demo data (or: ./dev.ps1 reset to restore it at any time)
./dev.ps1 test      # backend acceptance tests (pytest, against a separate test database)
```

`make up`, `make seed`, `make reset`, `make test` and `make migrate` do the same thing on machines that have `make`.

| URL | What |
|---|---|
| http://localhost:8080 | App (nginx serving the build and proxying `/api`) |
| http://localhost:8000/docs | API (OpenAPI) |
| http://localhost:8000/health | Health check, including database connectivity |
| http://localhost:5173 | Optional hot-reload frontend: `./dev.ps1 web-dev` |

The demo clock is fixed at **Nov 24, 2026** (`DEMO_TODAY`), so seeded due, overdue and late states never drift.

## Demo walkthrough

Use the role switcher at the top of the side menu. Purchasing has three work queues (Source material, Supplier follow-up, Allocate material) plus reference views; each queue shows its count of actionable items. It sets context only; it is not authentication. The **Demo** button runs the same steps through the normal services, and it also restores the seeded state.

1. **Purchasing → Source material → HAR-200 / West Assembly → Source material.** Allocate 20 of PO-5002's 30 unallocated on-order HAR-200 to WO-1008 and confirm. The panel shows what changed and that nothing is still short; WO-1008 is now on order, not kit ready. Toggle **By work order** to see one row per requirement with its created date.
2. **Warehouse → Arrivals → SH-7001 → Receive.** Receive 100 ACT-100, which is shared by WO-1001/1002/1003 (40/30/30). The units are in QA and not available yet.
3. **QA → Inspect.** Accept 80 and reject 20; the 20 are scrapped. **Allocate material** shows PO-5001-1 short 20 of 100 allocated with 80 available, and each linked work order shows *Allocation decision needed*. No order has been chosen to absorb the shortfall.
4. **Allocate material → Allocate material.** Give 40/30/10 from available and click Preview. Only the preview shows WO-1003 short 20. Click Apply (it also closes the QA-rejection review). Allocations change together, WO-1003 moves to Source material short 20, and the scrapped units never return to supply.
5. **WO-1001 → Pick and stage** (opens the pick list filtered to that order). Pick and stage its 40 ACT-100. The stage changes, and the inventory total does not.
6. **Purchasing → Supplier follow-up → PO-5003 → Record supplier update.** The Nov 23 check-in is overdue, which flags follow-up only. In one dialog, record the note, change SH-7002 to Dec 5, and complete the check-in. WO-1004 (start Dec 3) is now at risk; its production start does not change and the PO stays in follow-up for the late arrival.

Other paths you can try: the simulated supplier feed in the Demo panel, combining several work orders into one purchase from Source material, transferring stock from another site or choosing **Buy instead** (WO-1004 THP-400), replenishment as a Source material reason, fixture coverage review, cancelling a work order (unused allocations are released, the PO is flagged for review, staged material stays put), and reducing a requirement.

Terminology (available, on order, allocated, short, scrapped, material shortage, outlook, next action) is defined in §1a of the PRD and used the same way in the UI and API.

## Architecture

```
backend/   FastAPI + SQLAlchemy 2 + Alembic + Postgres
  app/models/     relational current state (+ append-only change_history, operation_log)
  app/services/   business actions, one transaction each; readiness.py is the shared calculation
  app/routers/    action endpoints and read views (no generic status-edit endpoint)
  app/seed/       deterministic seed, built by calling the services
  tests/          acceptance tests for the PRD's consequential behavior
frontend/  React + TypeScript + Vite, Tailwind + shadcn-style components, TanStack Query/Table,
           react-hook-form + zod, lucide icons
```

Key rules and where they live:

- **One readiness calculation.** [backend/app/services/readiness.py](backend/app/services/readiness.py) computes each requirement's quantities, timing, one status and one next action, plus each work order's outlook, for every view. Scenario preview runs the same `compute()` with a different allocation list. The frontend does not recalculate any of it.
- **Quantity conservation.** [backend/app/services/quantities.py](backend/app/services/quantities.py) breaks each PO line down into disjoint unshipped, in-transit, received-pending-QA and accepted-awaiting-handoff quantities. When inventory records change state they split; nothing is duplicated. Staged quantity is part of accepted quantity, not added to it.
- **PO → inventory handoff.** [backend/app/services/warehouse.py](backend/app/services/warehouse.py) `reconcile_line` moves claims onto accepted inventory when there is no choice to make: everything fits, or there is a single claim. When several claims compete and remaining supply still covers them, the claims stay and a planner chooses the handoff. When supply falls short, every claim is flagged for review and no winner is picked.
- **Integrity.** Each action locks its source and requirement rows (`SELECT … FOR UPDATE`), writes history in the same transaction, and is protected against duplicate submits by a client `op_id` ([backend/app/services/ops.py](backend/app/services/ops.py)). Scenario Apply compares row versions against its baseline and rejects stale drafts with a 409, without making any changes.
- **Allocation sources.** Each allocation has exactly one source: a PO line, an inventory record or a transfer line. A database CHECK constraint enforces this.
- **Dates stay with their source.** Production start belongs to the work order, expected arrival to the shipment or the unshipped part of the PO line, and the check-in date to its task. Arrival updates record their basis (supplier promise, carrier estimate or buyer estimate), their channel (manual or simulated) and the time of the update.

## Deploying (Railway)

You need three services: Postgres, `backend/` and `frontend/`. Each app directory has a `railway.json`.

- **backend:** set `DATABASE_URL` (reference the Postgres service; both `postgres://` and `postgresql://` URLs are accepted), `DEMO_TODAY=2026-11-24` and `CORS_ORIGINS`. Migrations run once in `preDeployCommand`, and a failed migration fails the deploy. If you enable `DEMO_RESET_ENABLED` on a shared URL, also set `DEMO_RESET_TOKEN`. Seed once with `railway run python -m app.seed seed`.
- **frontend:** set `API_UPSTREAM` to the backend's URL, for example its private address `http://<backend>.railway.internal:<port>` or its public HTTPS URL. Railway provides `PORT`, and the nginx template listens on it.
- After deploying, check `/health` on both services and load a page that calls the API.

Compose is for local development only. Nothing here assumes production runs Compose.

## Scope

**Built:** complete-kit readiness per work order; automatic local reservation on finalize; provisional remote holds with transfer-or-buy decisions (Inventory planning queue); manual assignment of on-order supply; work-order and by-part views with consolidated buying; general-stock replenishment suggestions; manual and simulated arrival updates; PO check-in tasks; receiving with lot capture; accepted/scrapped QA; exceptions that keep their linked orders; a material-shortage scenario with Preview, Apply and Discard; picking and staging; release on cancellation or reduction with PO review; manual fixture coverage review; change history.

**Deliberately not built (per the PRD):** BOM explosion or work-order splitting; processing buffers or calculated readiness dates; expedite workflows; detailed QA, rework or disposition; supplier capacity or confidence scoring; freight optimization; broad scheduling scenarios; AI planning; live supplier, carrier or ERP connections; production consumption and accounting issue; authentication.

**Simplifications:** a remote hold reserves the first eligible stock it finds, with no expiry. Fixture coverage is per requirement, not per individual fixture. The demo reset truncates the whole database.
