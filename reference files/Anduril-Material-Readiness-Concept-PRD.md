# Material Planning and Readiness — Concept PRD

**Anduril take-home working document · October 25, 2026**  
**Status:** Updated with scope and data-model decisions from the October 25 discussion. Selected prototype rules are distinguished from deferred concepts and proposed implementation defaults. Revised after the first prototype review: a single vocabulary (§1a); QA rejections are scrapped rather than held; screens show one status and next action per requirement (§5.4); renamed queues (Material shortages, Purchasing queue, Inventory planning queue).

## 1. Purpose and source of requirements

Help material planners, purchasing, receiving, and QA coordinate material from an identified production need through a staged kit. The central question is: **What material will be ready for this work order, when, and what action is needed to make it ready?**

This document formalizes Kyle’s discussion and selected directions. It is a working reference for his prototype and subsequent decisions, not the final interview process write-up. Items marked **open** or **proposed** have not been settled or validated.

The assignment prompt is authoritative. It describes difficulty tracking supplier orders, understanding supplier capacity, obtaining accurate warehouse arrival dates, coordinating arrivals, minimizing logistics costs, and maintaining inventory visibility across US warehouses. It explicitly leaves scope to the candidate. The role-context dossier supplies background, not additional assignment requirements.

Our selected framing connects inbound supply and inventory to production material readiness. Work orders, QA, reservations, and kit staging are design choices supporting that framing; they are not explicitly mandated by the prompt. Actual Anduril workflows, ERP configuration, and nuclear-specific requirements have not been established.

## 1a. Terminology

The prototype uses one small vocabulary everywhere: in screens, records, and this document. Avoid synonyms.

| Term | Meaning |
|---|---|
| **Available** | Accepted material physically in inventory. Material is either available or it is not; there is no separate "usable" classification. |
| **Staged** | Available material picked into a work order's kit. Staged quantity is part of available quantity, not added to it. |
| **On order** | Supply not yet available: unshipped or in-transit PO quantity, inbound transfers, and received material still in QA inspection. |
| **Allocated** | Quantity of a specific supply source (stock, PO line, or transfer) set aside for a specific work-order requirement. |
| **Short** | Required quantity with no allocated supply. |
| **Scrapped** | Quantity rejected at QA. It leaves inventory immediately and is never available; the scrap record keeps its receipt and PO links. |
| **Material shortage** | A supply source whose allocations now exceed what it can deliver (for example after a QA rejection). It needs a decision about how to split the remaining supply. |
| **Outlook** | Whether a work order can meet its production start: *Ready*, *On track*, *At risk*, or *Action needed*. |
| **Next action** | The specific step that moves a requirement toward ready, such as buy, assign, decide a shortage, decide a transfer, update an arrival, or pick and stage. |

## 2. Product outcome and boundary

Give teams a shared view of demand, the supply covering it, the remaining blockers, and known arrival-date conflicts against production start. Track actual usability and staging separately. Translate visibility into decisions: reserve, transfer, purchase, expedite, inspect, resolve an exception, or revise the production plan.

The discussed workflow ends at **kit staged**. Physical production execution and component consumption are beyond this boundary. Staging must not automatically be treated as the accounting event that charges material to a work order.

The discussion has focused on direct production material. General-stock replenishment is included as a purchasing reason. Workflows for indirect purchases such as laptops and office chairs have not been designed.

## 3. Users and responsibilities

| User/function | Main decisions and responsibilities |
|---|---|
| Program/production planning | Explore new builds and changes to work-order quantities or dates; understand readiness and consequences before committing changes. |
| Material planning / purchasing | Review coverage, confirm or release remote inventory holds, arrange transfers, buy shortages, consolidate demand, replenish stock, and coordinate expedited handling manually. Treat these as one function for the prototype. |
| Receiving / warehouse | Anticipate arrivals, receive and count material, manage queues, pick and stage kits, and flag discrepancies. |
| QA | Record quantities accepted and rejected at a simple QA stage. Accepted quantity becomes available; rejected quantity is scrapped, with source links preserved. |

For material shortages, the program manager chooses priorities and purchasing applies allocations. Both roles see the impact. QA records outcomes; the prototype does not establish real-world authority to override quality decisions.

## 4. Core decisions

### 4.1 Work-order finalization triggers inventory reservation

Draft or proposed work orders support planning without changing committed inventory reservations. When a work order is finalized, automatically reserve eligible, unallocated inventory in the warehouse attached to its manufacturing facility.

Reservation commits supply to demand; it does not physically pull the material. Picking and staging are separate warehouse activities.

For unmet demand, the latest selected direction is to **provisionally reserve eligible stock at other locations**, then require the material planner to confirm the transfer or release the hold and purchase externally. This supersedes the earlier idea of leaving all remote stock unreserved until a manual decision.

A remote hold must remain visibly distinct from local availability. It does not make the work order ready. The planner needs transfer timing, cost, and competing demand to make the decision. Existing commitments must not be silently taken from another order.

**Selected UI:** remote holds appear in an **Inventory planning queue**: "stock exists at another site; transfer it or buy instead." Each row offers both actions. Releasing a hold returns the requirement to the purchasing queue.

**Open:** Remote-site selection, hold duration and expiry, ownership, cross-site priority conflicts, and whether remote sites must approve transfers.

### 4.2 A shared planning/purchasing queue supports multiple views

Support both a work-order view and a consolidated part view over the same underlying requirements.

- **By work order:** What prevents this build from being ready?
- **By part:** What quantities are needed across builds, and is a combined purchase worthwhile?

From a work-order line, indicate other demand for that part and allow the buyer to evaluate combining purchases, for example in a modal. Preserve individual quantities, need-by dates, and existing coverage throughout.

The queue also distinguishes two reasons for purchasing: a short work-order requirement or replenishment of general inventory. These can contribute to the same purchase when appropriate.

**Selected UI:** the **Purchasing queue** lists short requirements with their preferred supplier, the quantity short, and any unassigned stock or open PO quantity at the same site that could cover them without buying. Every purchasing screen and dialog shows the supplier.

The by-part view answers one question per part: **can current stock and open orders meet the requirement?** It shows needed, covered, and gap, plus a verdict (covered, at risk, assign existing supply, or short) and the action that closes the gap. Expanding a part lists each work order's requirement and how it is covered, in a single table.

### 4.3 One PO line can support multiple work orders

A PO line can have multiple quantity allocations to different work orders. Each allocation retains its quantity and derives its need-by date from the linked work order’s production start. Any remainder can remain unallocated for general inventory.

For example, one purchase of 1,000 units could cover 200 for work order A, 300 for B, 400 for C, and 100 for general stock. Consolidation does not merge the work orders’ individual requirements or deadlines.

Receiving records what arrived against the PO. Allocations preserve which demand the supply supports. Partial arrivals and partial QA release must expose which work-order quantities are actually covered and which are still waiting.

**Selected:** Do not automatically prioritize competing work orders after a short receipt or QA rejection. Surface the shortfall as a **material shortage** with its linked work orders to purchasing and the program manager. Use scenario planning to preview and apply a manual allocation decision. Until then, show "decision needed"; do not claim every linked order is individually short or fully covered.

### 4.4 General inventory can trigger replenishment

Allow a part to carry a stock threshold so planning/purchasing can identify a replenishment need even without an individual work order. This is particularly relevant for long-lead-time material.

The discussed implementation direction is a warehouse-specific reorder threshold and target level, potentially populated from a company default. Account for reservations and incoming or already-requested supply to avoid repeatedly suggesting the same purchase. Timing matters: future supply may not prevent an earlier shortage.

The system flags or suggests the need; automatic vendor order placement has not been selected.

**Open:** Exact threshold calculation, time horizon, company-versus-site configuration, and buyer confirmation details.

### 4.5 Complete-kit readiness uses production start as its date anchor

Work orders enter with explicit required parts and quantities. Do not calculate requirements from a BOM. All required material must be available and staged for the work order to be ready. Splitting a build into work orders for different stages or long-lead components happens upstream and is outside this prototype.

Show **production start date** on receiving screens, warehouse screens, and their queues. For shared supply, show the linked work orders and their production start dates; an earliest-start summary may be used without implying an allocation priority. Do not add separate receiving, QA, or staging target dates or processing-buffer calculations yet.

Arrival is still distinct from readiness: ordered, in transit, awaiting receipt, and awaiting QA are on order, not available or staged. Compare expected arrival to production start to identify known delivery conflicts. Arrival on or before production start means no known arrival-date conflict, not a guarantee that processing and staging can finish in time. Missing arrival dates mean timing is unknown.

**Deferred until screens are reviewed:** QA duration, receiving turnaround, picking/staging buffers, operational target dates, calendars, and a calculated available/staged forecast.

### 4.6 Recovery and expediting remain manual

Purchasing handles supplier recovery, expediting, and other arrangements manually outside the tool, then records revised expected arrival information. The system recalculates the timing impact for linked work orders and shows conflicts to purchasing and the program manager. Keep planned production start unchanged so the conflict remains visible.

Do not build an expedite request/acceptance workflow or promise accelerated warehouse processing in this iteration. Scenario planning supports allocation trade-offs; it does not execute supplier recovery actions.

### 4.7 Warehouse execution combines queues with focused tasks

Provide visibility across expected arrivals, arrived material awaiting receipt, inspection, and subsequent warehouse work, alongside a focused workflow for handling an individual delivery or picking task. Exact screen and queue structure remains to be designed.

Useful task context includes supported work orders, production start dates, urgency, and blockers. Receipt includes scanning/identification and counting, with QA where required.

Cleared material may go into storage or directly to staging/kitting. Direct-to-staging avoids unnecessary putaway when material is already needed and allocated. Required receipt and quality checks still apply.

### 4.8 QA is a quantity checkpoint

Use separate linked records for shipment, receiving, QA, and inventory activities. QA records input quantity, accepted quantity, and rejected quantity. Accepted units become available. **Rejected units are scrapped**: they leave inventory immediately and are never available, and the scrap record keeps its receipt, QA batch, and PO links for traceability. There is no hold or use-as-is state. Do not design inspection procedures, rework, sampling plans, or detailed quality disposition workflows.

Every rejection creates a purchasing exception, even if spare supply prevents a work-order shortage. Also show linked work-order impacts when coverage is affected. Purchasing reviews the exception and records manual follow-up. Replacement procurement remains manual.

If 100 units support three work orders and QA accepts 80, show **100 allocated / 80 available — decision needed**. Do not automatically select which order loses 20 units. The 20 scrapped units never count as supply; the material shortage goes to scenario planning. Fine-grained urgent inspection splitting is deferred; separate receipts/QA batches still retain their source links.

### 4.9 Exceptions retain their operational impact

Report short receipts, QA rejection, and picking discrepancies where discovered. Preserve source, affected quantity, owner, linked work orders, production start dates, and review status. Purchasing and the program manager see material shortfalls; warehouse staff record facts without choosing program priority.

Distinguish an unresolved allocation decision from a confirmed shortage on a particular work order. After a plan is applied, show the actual remaining shortages by order. Acknowledging an exception does not create stock, clear a quality hold, or erase a shortage. The exception may be closed when its review/action is recorded, while any unresolved material shortage remains visible independently.

### 4.10 Scenario planning is limited to material shortages

For this prototype, use one focused case: a partial receipt or QA rejection leaves insufficient supply across several work orders (a material shortage). Purchasing and the program manager inspect the remaining supply, split it between available and still-on-order quantities per work order, and see which orders remain short alongside production start dates. The scenario screen names the part, PO line, and supplier as separate labeled fields.

Changes stay hypothetical until **Apply**. Discard leaves live allocations unchanged. Apply rechecks current supply and requirement quantities, rejects stale or infeasible proposals, and commits the allocation changes together. No automatic earliest-start allocation rule.

New-build simulation, broad quantity/date scheduling scenarios, and AI option generation are deferred. Do not reassign picked or staged material through this scenario: physical unpick/unstage handling would need a separate workflow. Production consumption is outside this prototype.

If an upstream work order is canceled or reduced, release unused allocations (including PO allocations and remote holds) and flag related POs for purchaser review. Do not automatically cancel POs. Picked/staged quantities require warehouse review before reuse; preserve the physical state.

### 4.11 AI scenario assistance is an extension opportunity

AI could help generate planning options and explain trade-offs for a requested change. Kyle identified this as a promising agentic use case, potentially beyond the prototype’s practical scope.

The working boundary is that AI proposes changes; inventory and allocation rules calculate and validate feasibility, and a user commits changes. A live AI planning feature has not been committed to the prototype.

### 4.12 Fixtures require manual purchasing review

Fixture requirements belong to specific work-order operations, inherited from the item's manufacturing routing/process plan. They identify the compatible fixture type and quantity required to support the planned production method. A work order may require multiple fixture types.

Fixtures are reusable resources, not consumed components. Their required quantity does not automatically scale one-for-one with the work-order build quantity. For example, a 100-unit build might use four fixtures: one in the machine and three supporting preparation and rotation. Manufacturing engineering defines that arrangement and its expected production rate; purchasing does not determine the engineering requirement.

**Selected prototype behavior:** Route fixture requirements to purchasing for manual review. Purchasing confirms local coverage or arranges purchase, fabrication, or transfer in coordination with manufacturing. Do not apply the automatic component-reservation logic to fixtures.

Distinguish facility coverage from scheduling availability. Compatible, serviceable fixtures at the facility can satisfy the coverage check even when currently used by another work order. This does not confirm they will be free when required. Scheduling availability remains a separate concern, outside the selected fixture coverage check.

**Open:** Whether to model a minimum quantity separately from the quantity needed for the planned rate; handling fabrication tasks; individual fixture identification; and how scheduling confirmation is surfaced. A reduced fixture count must not automatically imply that the same production rate is achievable.

### 4.13 Simulate supplier integrations and support manual updates

**Selected prototype boundary:** Demonstrate how supplier and shipping updates change purchasing decisions and production readiness. Simulate the integration inputs rather than implement live supplier/carrier connections or transmit real POs.

Support two paths into the same PO-line and shipment information:

- **Integrated supplier simulation:** An incoming acknowledgment, revised delivery date, partial shipment, or tracking update changes the relevant records.
- **Manual supplier update:** Purchasing records the equivalent information received through email or a phone call.

Link POs to suppliers and retain quantities and PO-line relationships for shipments. One PO may have multiple shipments with different quantities and arrival dates. Receipt and work-order coverage must reflect the affected quantities rather than assigning a single shipment status to the entire PO.

Show the source and last-updated time for arrival information. Keep supplier-promised delivery and carrier-estimated arrival distinguishable as source information; use an explicit current expected arrival for comparisons. Do not calculate post-receiving/QA availability yet. A shipping update does not establish physical receipt or quality release. Picking and staging remain separate from available inventory.

A demonstration can simulate a supplier delay, update the affected shipment or unshipped PO-line commitment, recalculate arrival-date conflicts, expose affected work orders, and support manual follow-up. This is a proposed demo scenario, not a commitment to a particular screen or button.

**Prototype default:** Before a shipment exists, use the PO line’s expected arrival for unshipped quantities. Once a shipment exists, its expected arrival governs its quantities. A manual or simulated update explicitly changes the current expected arrival and retains source and update time; do not silently resolve competing feeds. Missing dates display “unknown.” An estimated label alone does not raise a delivery-risk exception. Production-grade feed precedence, staleness rules, and duplicate/out-of-order integration handling are deferred.

### 4.14 Assign existing incoming supply manually

On the manual planning/purchasing screen, show matching incoming PO and transfer supply, quantity not already allocated, destination, and expected arrival. Label it **on order**, not in inventory. The purchaser can assign an available quantity to a work-order item before deciding to buy more. Do not automatically allocate incoming supply or recommend a new buy as if that supply did not exist. Supply arriving after production start may be assigned, but its timing conflict stays visible.

### 4.15 Purchase order check-in tasks

Purchasing can add an optional **purchase order check-in task**, with due date, owner, and short note. For example, November 23 is the check-in date for a December 1 delivery. These are separate dates and records.

The purchasing queue shows the next open check-in date and highlights due/overdue tasks with a link to the PO. Completing a check-in records an outcome and may update expected arrival. An overdue check-in means follow-up is needed; it does not by itself mean the material is late. A check-in finding a later arrival triggers the work-order impact rules above.

Supplier-capacity concerns are handled through purchaser judgment, notes, and these tasks. Do not add supplier-level confirmation-required settings, confidence scoring, or modeled capacity constraints.

### 4.16 Consolidation is the logistics-cost scope

Flag other compatible demand as an opportunity to combine purchases into one PO. Show quantities, supplier/destination compatibility, and affected production start dates so purchasing can judge timing. Preserve each work-order allocation. This is a decision aid for potential savings, not a freight-price calculation or a claim that every combined purchase reduces shipping cost. Detailed freight optimization is deferred.

## 5. Data model and quantity rules

The relationships and quantity constraints below implement the discussion. Field names, helper records, and status names are **proposed implementation defaults**, not requirements independently chosen by Kyle or claims about Anduril’s systems. A coding agent may adapt the schema while preserving these behaviors.

### 5.1 Core records

All records have stable IDs. Mutable records carry `updated_at`; records changed by scenario Apply also carry a version for stale-state checks. Quantities use the part’s unit of measure; unit conversions are out of scope.

| Record | Minimum fields and relationships |
|---|---|
| Part | `id`, `part_number`, description, unit of measure, `requires_qa`; optional traceability/replenishment settings. Fixtures remain a separate requirement type. |
| Warehouse | `id`, name, facility reference. Inventory is location-specific, never just a global part-number balance. |
| WorkOrder | `id`, program, facility/warehouse, `production_start_date`, state (`draft`, `finalized`, `canceled`). |
| WorkOrderItem | `id`, `work_order_id`, `part_id`, `required_qty`; explicit upstream requirement. References to an item distinguish repeated part lines. |
| Supplier / PurchaseOrder | Supplier identity; PO `id`, `supplier_id`, destination warehouse, status, buyer. |
| PurchaseOrderLine | `id`, `po_id`, `part_id`, ordered/canceled quantities, expected arrival for unshipped quantity, date source and update time. Unallocated remainder can cover general stock. |
| Shipment / ShipmentLine | Shipment destination, status, tracking, `expected_arrival`, source/update time. Line links shipment to PO line and quantity. Multiple shipments per PO and multiple lines per shipment are allowed. |
| Receipt / ReceiptLine | Receipt timestamp and warehouse; line links to shipment line when known and always to the matched PO line, with actual received quantity and optional lot identity. Unmatched receipts remain exceptions and cannot create eligible supply until matched. |
| QABatch | `id`, `receipt_line_id`, input/accepted/rejected quantities, status, completed timestamp. For the minimal UI, one completed batch per receipt line is sufficient; multiple batches must consume disjoint quantities. No inspection procedure model. |
| InventoryRecord | `id`, `part_id`, warehouse/location, optional lot, originating receipt/QA references, physical quantity, quality state (`pending`, `accepted`, `scrapped`), warehouse stage (`received`, `stored`, `picked`, `staged`). Scrapped records are kept for traceability but excluded from every inventory balance. Split records when quantities differ in state; never duplicate the original quantity. Existing opening stock has no required receipt reference. |
| Allocation | `id`, `work_order_item_id`, quantity, source type and source ID, state (`remote_hold`, `committed`, `released`). Source is exactly one PO line, inventory record, or transfer line. A part number alone is not a sufficient source key. |
| TransferLine | Minimal link to originating inventory, part, quantity, source/destination warehouses, status, expected arrival. Reserve source stock while incoming transfer supply represents the same units at destination. Full logistics execution is deferred. |
| POCheckInTask | `id`, `po_id`, optional `po_line_id`, `due_date`, owner, note, state (`open`, `completed`), completion timestamp/outcome. Separate from shipment arrival. |
| MaterialException | Type, source reference, affected quantity, linked work-order items, owner, state, note/resolution. Shared deficits have one source-level issue with affected links, not invented shortages for every order. |
| PlanningScenario / ScenarioAllocation | Scenario owner/state, source and requirement versions, proposed quantities by work-order item/source. Draft allocations remain separate from live allocations until Apply. |
| FixtureRequirement | Work-order/operation reference, fixture type, quantity, manual coverage state/note. No automatic consumable allocation. |

### 5.2 Allocation relationships and stage handoffs

One work-order item can have many allocations, and one supply source can have many allocations. PO line allocations are commitments to incoming supply, not proof of available stock. Shipment, receipt, and QA records remain separate activities linked through their source IDs.

**Proposed handoff rule:** When accepted receipt quantities become inventory, move the corresponding allocation quantity from the PO line to the new inventory record in the same transaction. Preserve the PO lineage and a handoff/history reference. Reduce or release the predecessor allocation; do not leave both active for the same units. Partial handoffs split allocation quantities.

If the remaining supply is insufficient for all allocations, do not choose winners during this handoff. Mark it as a material shortage with the linked work orders as "decision needed", block affected quantities from picking, and let scenario Apply assign available inventory and any remaining on-order supply. Existing allocations remain visible as demand, not additional stock. Scrapped quantities can never back allocations. After Apply, any demand without a valid source is explicitly short.

For a normal partial receipt with enough remaining on-order quantity to honor all allocations, preserve the allocations. Any choice about which order receives the now-available subset is manual if ambiguous (a **receipt handoff**); a partial shipment alone need not mean a material shortage.

Transfers follow the same conservation rule: source stock reserved for transfer cannot also cover a local order; receipt at destination retires the corresponding in-transit quantity and establishes destination inventory once. For the prototype, manually seeded/updated transfer records are sufficient.

### 5.3 Quantity invariants

- Quantities are nonnegative and allocations require matching part/unit. Active allocations cannot exceed a work-order item’s requirement or available source quantity when created/applied. A later real-world shortfall may invalidate existing claims; surface that conflict rather than silently reprioritizing them.
- Track disjoint remaining quantities: unshipped, shipped-not-received, received-pending-QA, accepted (available), scrapped. Historical shipment/receipt/QA totals are not additive inventory balances.
- For completed QA: `accepted_qty + rejected_qty = input_qty`. Across batches, total input cannot exceed the receipt quantity. Pending QA is unavailable. A part that does not require QA can become accepted through receipt completion.
- Ordered quantity minus canceled quantity reconciles to unshipped, in-transit, and cumulatively received quantities. A short delivery either leaves a known outstanding balance or is recorded as a closed shortfall; do not silently delete the missing units. Over-receipts require manual review.
- Accepted quantity remains inventory when picked/staged; update its location/stage rather than adding it again. Staged material stays reserved. Consumption/accounting issue is outside this workflow.
- Only unused allocations are automatically released for demand reduction/cancellation. Picked/staged material is not made available by an administrative release.
- Posting a receipt, QA outcome, handoff, or scenario twice must not double the quantity. Use operation IDs or equivalent duplicate-submit protection. This does not require production-grade supplier integration event handling.

### 5.4 Derived views, not one overloaded status

For each work-order item, calculate required, on-order allocated, available allocated, staged (a subset of available), short, and decision-needed quantities. Do not add staged to available when calculating coverage.

Screens should not show every one of these quantities as its own column. Each requirement gets **one status** with its key quantity and date, plus **one next action**. Status, in precedence order:

| Status | Shown as | Next action |
|---|---|---|
| Short | "Short 20" | Buy (or assign unassigned supply at the site) |
| Decision needed | "Shortage: decision needed" | Resolve the material shortage |
| Transfer decision | "Stock at another site" | Transfer or buy instead |
| Arrives late | "Arrives Dec 5 — after start" | Update the arrival / follow up with the supplier |
| Arrival unknown | "Arrival date unknown" | Get a date from the supplier |
| On order | "Arriving Dec 2" | None; waiting |
| Ready to stage | "Available — not staged" | Pick and stage |
| Staged | "Staged" | None |

Each work order rolls these up into an **outlook** (Ready, On track, At risk, Action needed) and a list of next actions. Every next action is a button on the work-order screen. Work-order screens list program, site, production start, build quantity, and state as separate labeled fields, not a combined subheading.

Show timing separately: expected arrival versus production start, unknown arrival, and any known late quantity. For multiple shipments, retain quantities/dates and identify which source is assigned to which requirement; if the split has not been decided, show shared timing review rather than inventing an order-level ETA. A PO allocation may retain shipment-level quantity links for this purpose without duplicating its quantity.

A work order is **ready** only when all component requirements are accepted and staged, no blocking exception or undecided material shortage remains, and required manual fixture coverage is recorded. Fixture scheduling is still unverified. “Incoming coverage” is not “ready.” Do not calculate a buffered readiness date in this iteration.

### 5.5 Concrete acceptance examples

1. **Shared QA rejection:** A/B/C require 40/30/30 of the same part. A 100-unit receipt yields 80 accepted and 20 scrapped. Show 100 allocated / 80 available and "decision needed"; no automatic losing order. A draft 40/30/10 plan leaves C short 20 only in preview. Apply commits that outcome; available allocations sum to 80, the 20 scrapped units never return to supply, and repeating Apply does not duplicate stock.
2. **PO check-in:** A November 23 task concerns a December 1 arrival. An overdue task highlights follow-up only. Updating arrival to December 5 flags a linked December 3 work order while leaving its production start unchanged.
3. **Incoming assignment:** A PO line has 100 units, 70 already assigned. Planning exposes 30 unallocated; assigning 20 leaves 10, and the demand is marked on order rather than ready.
4. **Stage conservation:** Receiving 40 of 100 leaves 60 outstanding. Accepting the 40 yields 40 available, not 140. Staging those 40 changes stage only. Accepted inventory and the remaining PO quantities cannot both claim the same 40 units.
5. **Cancellation:** Canceling an order releases its unused stock/PO commitments, flags the PO for review, and does not cancel the supplier order or release already staged material.
6. **Stale scenario:** If QA or allocations change after preview, Apply requires refresh/review and makes no partial changes.

## 6. Trade-offs explored

| Trade-off | Selected direction | Consequence / remaining concern |
|---|---|---|
| Manual versus automatic reservation | Automatically reserve when the work order is finalized. | Less routine planning work; eligibility and priority rules need validation. |
| Reserve at creation versus finalization | Drafts do not commit inventory; finalization does. | Supports exploration without tying up stock prematurely. |
| Local-only reservation versus remote reservation | Local reservation plus provisional remote holds requiring planner action. | Protects potential supply while a decision is made, but can tie up another site’s inventory. |
| Work-order view versus consolidated buying view | Support both over shared requirements. | Useful perspectives; complexity lies in preserving allocations, not just changing grouping. |
| Bulk purchase savings versus production timing | Allow consolidation while retaining quantities and deadlines. | Savings must be weighed against the earliest need and partial-delivery risk. |
| Detailed QA versus quantity checkpoint | Record accepted/rejected quantities with linked stage records; rejected quantity is scrapped. | Preserves material truth while deferring inspection, rework, and disposition design. No use-as-is path. |
| Calculated turnaround versus production-start anchor | Show production start; defer buffers and expedite commitments. | Simpler queues; arrival on time is not a guarantee of staging on time. |
| Arrival tracking versus full dock/staff scheduling | Focus on expected arrivals and readiness. | Narrower concept; receiving-hours and capacity assumptions need validation. |
| Putaway first versus direct staging | Permit direct staging after required checks. | Avoids handling but needs clear allocation and location records. |
| Automatic priority versus manual scenario | Preview/apply allocations for material shortages only. | Preserves program judgment without a scheduling simulator. |
| PO-to-work-order cost linkage versus inventory then issue | Preserve operational allocations and separate accounting treatment. | Exact ERP mapping remains unverified. |
| Fixture coverage versus component reservation | Manual purchasing review for reusable fixture requirements. | Local coverage does not establish time-specific availability; engineering owns the required production method. |
| Live supplier integration versus simulation | Simulated supplier/carrier updates plus manual entry into the same records. | Demonstrates downstream decisions without building connectivity; real data reliability remains unvalidated. |
| AI planning versus explicit rules | AI assistance is an extension; rules validate availability. | Potentially easier exploration without treating AI output as authoritative inventory state. |

## 7. Integration boundaries and unverified assumptions

NetSuite was discussed as an ERP integration example. The concept requires preserving PO, receipt, allocation, and work-order context across systems, but does not establish how a particular NetSuite configuration stores those relationships.

Inventory receipt, reservation for a work order, physical staging, and accounting issue are distinct events. Do not claim that receipt or staging necessarily charges costs to a work order. Financial mapping, system ownership, and synchronization remain design work.

Likewise, lot tracking is a discussed requirement for parts that need traceability. The role background does not establish that this fictional exercise requires nuclear-specific workflows or a particular compliance regime.

## 8. Selected scope and deferred decisions

**Selected prototype behaviors:** Complete-kit readiness per upstream work order with an outlook and next action; local reservations and provisional remote holds (inventory planning queue); manual assignment of incoming supply; purchasing queue and by-part coverage view with suppliers and consolidation opportunities; manual/simulated arrival updates; PO check-in tasks; receiving and minimal accepted/scrapped QA; material-shortage visibility for purchasing/program management; manual allocation scenario with explicit Apply; picking/staging; unused-allocation release and PO review on cancellation/reduction.

**Screen principles:** one purpose per screen, reached from a side menu; tables rather than prose; one status and one next action per row instead of a column per quantity bucket; no decorative coverage bars; key facts (program, site, part, supplier, dates) as labeled fields; every next action reachable by a button on the screen where the problem is shown.

These decisions define behavior, not a requirement to polish every screen. The suggested connected demonstration is purchasing assigns supply → receiving records arrival → QA rejects part of a shared receipt → purchasing/program management review and apply allocations → remaining shortages stay visible. This demonstration sequence is an AI suggestion for Kyle to select, not a claim of completed validation.

**Explicitly deferred:** Work-order splitting/BOM explosion; operation-level partial starts; processing buffers and calculated readiness dates; expedite commitment workflows; detailed QA/rework; supplier-capacity modeling and confidence scores; supplier-level confirmation rules; automated recovery; freight optimization; broad scheduling scenarios; AI planning; live supplier/carrier/ERP connections; indirect purchasing; production execution and accounting issue.

Supplier capacity is addressed only through human judgment and check-ins. Consolidation surfaces potential logistics savings without computing freight cost. Manual/simulated updates demonstrate information flow, not improved supplier-date accuracy by themselves. These limits should remain explicit in Kyle’s write-up.

Remaining validation questions, not requests to expand the build:

- Which existing systems own work orders, inventory, quality release, and allocations in a real implementation?
- What remote-hold selection/expiry rules and replenishment formulas are needed? These earlier concept details remain open; do not add optimization implicitly.
- What revision, approved-source, lot/documentation, and substitution rules make inventory eligible? For seeded prototype data, assume exact part matches and explicitly acceptable inventory except demonstrated quality holds.
- ~~Is a simple externally authorized use-as-is record useful?~~ Resolved: rejected material is scrapped; there is no hold or use-as-is state.
- Do real users need processing buffers after reviewing the initial queues? Keep that as a follow-on review item.
- Which assumptions will Kyle test, and which actions/screens best communicate his chosen scope within the interview?

## 9. Validation and success criteria — proposed, not yet agreed

No user research or tests are claimed by this document. Questions to validate with planning, purchasing, receiving, and QA include:

1. Does automatic reservation at finalization match actual planning practice?
2. Would provisional remote holds help or obstruct site operations, and how quickly must they be resolved?
3. How are partial arrivals prioritized among competing builds today?
4. Which material can be independently inspected and released in smaller quantities?
5. Does showing production start alone provide enough context, or do queues later need separate processing targets?
6. How often do outside-hours arrivals, missing documentation, or receiving queues delay availability?
7. Which system owns inventory, allocations, quality release, and financial transactions?
8. Where do arrival estimates originate, and what makes them trustworthy enough for planning?
9. Who defines fixture quantities and production rates, and who confirms local coverage versus scheduling availability?
10. Can buyers maintain supplier commitments through a manual path, and what should happen when a carrier estimate conflicts with a supplier promise?

Candidate outcome measures are the share of kits staged by their need-by time, arrival-date accuracy, receipt-to-release/staging time, and time to resolve material blockers. Allocation accuracy and preserved traceability are guardrails. Baselines, targets, and the prototype’s demonstration scenarios remain to be selected.

## 10. Working sources

- **ArsenalOS PM Interview Prompt (v2 – Candidate):** Authoritative assignment scope and evaluation guidance; supplied PDF.
- **Anduril MDP Senior PM Research and Take-Home Context:** Supporting role background; supplied Markdown dossier. Its statement that the exact prompt was unavailable is superseded by the supplied prompt.
- **Planning discussion supplied in this conversation:** Source of the decisions and trade-offs recorded here. The latest discussion narrows QA, scenario planning, timing, and recovery; it adds manual incoming allocation and PO check-in tasks. Data-model mechanics marked proposed are AI-assisted implementation recommendations.

This document organizes the discussion with AI assistance. It does not establish that its assumptions have been tested, nor replace Kyle’s own process narrative about research, judgment, AI usage, and implementation choices.
