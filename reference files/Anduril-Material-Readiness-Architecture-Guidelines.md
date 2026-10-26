# Material Readiness Prototype — Architecture Guidelines

Updated October 25, 2026. Implementation guidance for Kyle’s Claude Code project.

## 1. Authority and scope

Use `Anduril-Material-Readiness-Concept-PRD.md` for product behavior and the interview prompt for assignment requirements. This document translates those decisions into a recommended architecture; it does not expand the product scope. Build from these guidelines and the companion PRD; no prior application repository is required.

Build one connected material-readiness workflow: work-order demand → supply allocation → receiving → simple QA → shortage review → manual allocation scenario → staging. Work orders already contain required parts and quantities. Production start is the date anchor; processing buffers and predicted readiness dates are deferred.

## 2. Application foundation

| Pattern | Direction |
|---|---|
| FastAPI + Postgres | One modular backend and one relational database. No microservices or message broker required. |
| Docker Compose + Railway | Use Docker Compose for local development and Railway for hosting. Configure deployed services explicitly; do not assume production runs Compose. |
| Routers → services → models; separate Pydantic schemas | Routers handle requests; services own business rules and transactions; models describe persistence; schemas define API inputs/outputs. |
| Alembic and configuration management | Use Alembic migrations, environment-based settings, and a `GET /health` endpoint. Validate database URL normalization against the selected driver. |
| Seed/reset commands | Provide `make up`, `make migrate`, `make seed`, and `make reset`, with a reliable demo reset. |
| Shared API client and domain helpers | Centralize consistent request/error handling. All role views use the same API. |
| Shared UI components | Create shared loading, empty, error, table, form, and status components where useful. |

If nginx serves the frontend or proxies the API, configure routing, backend address resolution, SPA fallback, and asset caching for the actual deployment. SSE settings are unnecessary until streaming is implemented.

## 3. Backend modules

These are modules inside one application, not separately deployed services.

| Module | Responsibilities |
|---|---|
| Purchasing | POs/lines, manual or simulated arrival updates, check-in tasks, incoming supply visibility, consolidation opportunities. |
| Warehouse | Receipt quantities, QA outcomes, inventory location/quality/stage, picking and staging, minimal transfer state. |
| Allocations | Work-order requirements, local reservations, remote holds, manual incoming assignments, release and source handoffs. |
| Readiness | Shared calculations for coverage, shortages, timing conflicts, allocation-review flags, and kit readiness. |
| Scenarios | Draft shortage allocations, preview, discard, version checks, and atomic Apply. |

Use shared master data for suppliers, parts, warehouses, and programs. Keep module boundaries practical; avoid generic framework abstractions before the workflow needs them.

The readiness module supplies consistent derived results to purchasing, planning, and warehouse views. The frontend must not independently recalculate business readiness. Preview and live views should use the same calculation rules with different allocation inputs.

## 4. Domain model

Follow the PRD’s detailed model and quantity rules. Model these concepts explicitly:

| Records | Required distinction |
|---|---|
| `WorkOrder`, `WorkOrderItem` | Production start, facility, state, explicit part requirements and quantities; no BOM explosion or station routing engine. |
| `Supplier`, `Part`, `Warehouse` | Identity and minimum operational configuration. Avoid unused supplier tiers, scores, and integration classifications. |
| `PurchaseOrder`, `PurchaseOrderLine` | Supplier purchase commitments and expected arrival for unshipped quantities; one line may support several work orders. |
| `Shipment`, `ShipmentLine` | Quantities linked to PO lines with shipment-level expected arrival and tracking/source information. |
| `Receipt`, `ReceiptLine` | Separate physical receiving activity linked to its shipment/PO source. |
| `QABatch` | Input, accepted, and rejected quantities; no inspection/rework engine. |
| `InventoryRecord` | Part, warehouse/location, quantity, source lineage, quality state, and physical stage. |
| `Allocation` | Quantity linking a work-order item to a PO line, inventory record, or transfer line; distinguish remote holds, commitments, and released allocations. |
| `TransferLine` | Source/destination and conserved quantity; minimal manual/seeded transfer behavior. |
| `POCheckInTask` | PO-linked due date, owner, note, status, and outcome; independent of arrival date. |
| `MaterialException` | Source, affected quantity, impacted requirements, owner, and resolution; shared shortages do not invent a losing work order. |
| `PlanningScenario`, `ScenarioAllocation` | Proposed allocations and baseline versions, separate from live state. |
| `FixtureRequirement` | Manual coverage review, separate from consumable component reservations. |
| `ChangeHistory` | Append-only record of meaningful changes, with actor/source, timestamp, entity, prior/new values, and operation reference. |

Use database foreign keys and constraints where practical. If allocation sources use separate nullable foreign keys, require exactly one source. If another representation is chosen, preserve equivalent referential validation.

**Inventory balances are summaries.** Aggregate detailed inventory records by part/warehouse and state. Do not maintain a separately editable balance alongside those records. Pending QA, held, accepted, reserved, and staged quantities must remain distinguishable. Staged quantity is a subset of accepted inventory, not additional stock.

**Dates belong to their source.** Production start belongs to the work order; expected arrival belongs to the shipment or unshipped PO-line commitment; check-in due date belongs to the task. One PO line can support multiple production start dates. Do not store one authoritative demand need date on that PO line.

## 5. Current state plus change history

Persist current operational state in ordinary relational tables. Record significant changes in an append-only history table in the same transaction as the state change.

Keep date updates, QA outcomes, allocation changes, and scenario applications traceable. Retain manual versus simulated source and update time. The application reads current tables and calculates summaries from them; it does not replay the history log to reconstruct current state.

Full event sourcing, replay infrastructure, supplier reliability scoring, and historical prediction models are outside this prototype. History supports traceability and future analysis without requiring those features now.

## 6. Transactions and quantity integrity

Treat receiving, QA completion, allocation changes, cancellation releases, and scenario Apply as business actions. Each action validates and commits all related records together, or rolls back completely.

- Recheck source quantities and requirement quantities inside the transaction. Use row locking or an equivalent concurrency strategy to prevent two requests reserving the same units. Version checks alone must not leave a race between checking and writing.
- Use operation IDs or equivalent duplicate-submit protection for quantity-changing actions. Repeated receipt, QA, or Apply requests must not duplicate inventory.
- Preserve quantity across PO, shipment, receipt, QA, and inventory stages. Historical activity totals are not additive stock.
- When accepted supply moves from a PO-backed allocation to inventory, reduce the predecessor allocation in the same transaction and preserve lineage. Never count both as separate coverage for the same units.
- If a shared receipt/QA result leaves insufficient supply, retain the impacted commitments as claims requiring review. Do not silently assign the shortage to an order. Prevent ambiguous claims from being treated as pickable coverage.
- Rejected or pending-QA stock is unavailable. An externally authorized use-as-is release must be explicit and recorded, following the PRD’s simplified boundary.
- Canceling/reducing demand releases unused allocations and flags related POs for review. It does not automatically cancel POs or make picked/staged units available.
- Scenario Apply rechecks the relevant source, requirement, and allocation versions, validates proposed quantities, and commits all changes atomically. Stale previews require refresh and review; Discard leaves live state untouched.

Expose service actions such as receive, complete QA, assign supply, update arrival, complete check-in, and apply scenario. Avoid a generic status-edit endpoint that can bypass these rules.

## 7. Readiness and exception logic

Use explicit rules for known operational conditions:

- Expected arrival after a linked work order’s production start.
- Unknown expected arrival, shown as unknown rather than automatically late.
- Insufficient or disputed supply coverage.
- QA rejection or another material-blocking exception.
- Due or overdue PO check-in tasks, shown separately from delivery lateness.

Show required, incoming allocated, usable allocated, staged, and uncovered quantities, plus allocation-review state. A work order is ready only when the PRD’s complete-kit and manual fixture-coverage conditions are met.

Do not implement predicted arrival dates, supplier reliability scores, automatic allocation priority, or calculated receiving/QA/staging buffers. Sorting a queue by production start is allowed; that does not authorize assigning scarce material by that order.

Manual and simulated supplier updates call the same application services. Updating an expected arrival changes the affected timing flags without silently changing planned production start.

## 8. Frontend

Use one React application with a shared API client and role-specific pages.

- Use shadcn/ui + Tailwind for interface components and styling, with lucide icons.
- Use TanStack Query for server data, loading/error handling, and refetching. After mutations, invalidate affected supply, work-order readiness, exception, and task views so they agree.
- Use TanStack Table where desktop comparison benefits from tables; use react-hook-form + zod for form validation. The backend remains authoritative for business validation.
- Use Recharts only where a specific chart aids a decision. Charts and dark-mode polish are optional.
- Keep draft scenario inputs separate from live query data. Display a clear Preview / Apply / Discard state. Do not optimistically show unconfirmed quantity changes as committed stock.

Desktop purchasing/program-management views emphasize coverage, exceptions, and allocation comparisons. Mobile-friendly warehouse views emphasize one receiving, QA, or picking task at a time, with clear quantities and large controls. Separate layouts/routes are fine where useful; no second frontend project is needed.

Start with manual identification and, if useful, scanners that enter text as keyboard input. Camera scanning, PWA support, supplier-facing pages, and no-login supplier confirmation links are deferred.

## 9. Demo roles and deployment

Use a demo role switcher for purchasing, program management, receiving/warehouse, and QA. It changes the workflow context; it is not production authentication or authorization. Use fictional seed data.

Fail deployment/startup if required migrations fail. Validate required environment variables and keep credentials out of the frontend. Apply migrations through a controlled release/startup step rather than concurrently from every worker. Verify health and frontend/API connectivity in the actual deployment.

Keep reset tooling scoped to the disposable demo database; do not expose an unrestricted public reset endpoint. Production onboarding, bot-challenge flows, and supplier login are outside the demo scope.

## 10. Deterministic seed data and focused verification

Seed from a small configuration with stable identifiers and a documented demo date. Use one clock source for due/overdue behavior so fixed sample dates do not accidentally become late as the calendar advances. Include multiple warehouses, shared PO lines, different shipment dates, an unallocated incoming balance, a check-in, and a partial QA rejection.

Provide named scenario actions such as “supplier revises arrival” and “QA accepts 80 of 100.” These actions should use normal services so demo behavior exercises real rules. Reset restores the same initial state.

Use focused tests for consequential behavior:

1. A 100-unit receipt with 80 accepted/20 held creates 80 usable units and allocation review, without automatically choosing the losing order.
2. Receiving 40 of 100 and accepting those 40 leaves 60 outstanding and 40 usable, without double counting or duplicate-submit effects.
3. A source with 30 unallocated units cannot accept assignments totaling more than 30, including concurrent requests.
4. Scenario preview/discard changes nothing live; Apply commits together; stale Apply changes nothing.
5. Rejected/pending material cannot be picked; staging does not increase total inventory.
6. A check-in becoming overdue does not make delivery late; an arrival update past production start does flag the linked work order.
7. Cancellation releases unused allocations, retains physical staging state, and leaves the PO open for review.

Run one connected UI walkthrough across roles to verify mutations refresh the related views. Avoid broad tests that merely mirror implementation details.

## 11. Deferred capabilities

No AI API is required for the selected prototype. If added later, keep it behind an adapter and have any tools invoke existing validated services. Supplier-email extraction or explanation could be future experiments; do not implement them as implicit scope now. Streaming/SSE and copilot confirmation flows can wait with that feature.

Quotes, invoices, sales workflows, onboarding milestones, BOM CSV import, and work-order station routing are outside scope. Implement lightweight work-order requirements and their links to supply.

The architectural priority is consistent quantities and readiness across a connected workflow, with enough separation to change rules during the interview.
