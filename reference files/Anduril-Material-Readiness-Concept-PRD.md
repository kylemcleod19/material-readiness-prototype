# Material Planning and Readiness — Concept PRD

**Anduril take-home working document · October 25, 2026**  
**Status:** Revised after terminology and repository workflow review. This revision preserves the accepted/scrapped QA simplification and consolidates purchasing decisions, removes repeated screen actions, and separates physical state, allocation, schedule outlook, and next action. These are implementation requirements for the next iteration, not claims that the app already behaves this way.

## 1. Purpose and source of requirements

Help material planners, purchasing, receiving, and QA coordinate material from an identified production need through a staged kit. The central question is: **What material will be ready for this work order, when, and what action is needed to make it ready?**

This document formalizes Kyle’s discussion and selected directions. It is a working reference for his prototype and subsequent decisions, not the final interview process write-up. Items marked **open** or **proposed** have not been settled or validated.

The assignment prompt is authoritative. It describes difficulty tracking supplier orders, understanding supplier capacity, obtaining accurate warehouse arrival dates, coordinating arrivals, minimizing logistics costs, and maintaining inventory visibility across US warehouses. It explicitly leaves scope to the candidate. The role-context dossier supplies background, not additional assignment requirements.

Our selected framing connects inbound supply and inventory to production material readiness. Work orders, QA, reservations, and kit staging are design choices supporting that framing; they are not explicitly mandated by the prompt. Actual Anduril workflows, ERP configuration, and nuclear-specific requirements have not been established.

## 1a. Operational vocabulary

Use these labels consistently in the interface. Internal field names may remain different when mapped explicitly; a naming cleanup does not require unnecessary schema renames. Do not introduce a second user-facing term for the same concept.

| Term | Meaning and display rule |
|---|---|
| **Available** | Accepted material physically in inventory, including allocated, picked, and staged units. Does not mean free to assign to another order. Do not introduce a separate “usable” classification. |
| **Available to allocate** | Accepted local stock not already allocated, staged, or reserved for transfer. Show this explicitly in sourcing decisions. |
| **Unallocated on order** | Open incoming supply that is not assigned to a requirement. Keep separate from available stock; show quantity and expected arrival. |
| **Allocated** | Supply set aside for a specific work-order requirement. Use this instead of alternating between committed/reserved/assigned as status labels. “Assign” is the action that creates an allocation. |
| **On order** | Purchased supply not yet physically received. Use specific “In transit” detail when known. Inbound transfers display “Transfer in transit”; material already at the dock or in QA must not display as still arriving. |
| **Awaiting receipt / Awaiting QA** | Material physically arrived but not yet accepted into available stock. The next action belongs to receiving/QA, not supplier date follow-up. |
| **Picked / Staged** | Physical warehouse stages. Staged material is in the work order’s kit and remains part of available inventory, counted once. |
| **Short** | A required quantity with no valid allocated supply. Show the quantity, such as “Short 20.” |
| **Allocation decision needed** | Existing supply supports competing work orders and someone must decide who gets it. Show any total supply deficit once at the source; do not declare each work order short by that amount. |
| **Stock at another site** | Potential supply or a provisional remote allocation requiring a transfer decision. It is not available locally. Avoid bare “hold.” |
| **Scrapped** | Rejected QA quantity excluded from inventory balances. Preserve receipt/QA/PO history. Use “Reject and scrap” for the action; there is no quality-hold or use-as-is workflow. |
| **Fully allocated** | All requirements have valid supply allocations. This does not imply arrival on time, acceptance, or kit readiness. Do not use bare “covered” as an overall verdict. |
| **Kit ready** | All required material is accepted and staged, blocking issues are resolved, and manual fixture coverage is recorded. |
| **Schedule outlook** | “On track,” “At risk,” or “Unknown,” calculated separately from task ownership and physical stage (§5.4). |
| **Next action** | A concrete operation: Source material, Allocate material, Record supplier update, Receive, Inspect, Pick and stage, or Confirm fixture coverage. |

Use “Short delivery,” “QA rejection,” or “Missing stock” to name an issue. “Exception” may describe the underlying record or history section, but is not a sufficient explanation or primary action label. Do not show “Receipt handoff,” “claims,” “uncovered,” or internal enum names as operator labels. Receiving-related reassignment is “Assign received material.”

Physical state, allocation, and schedule are separate facts. A requirement can be fully allocated and still arrive late; a work order can need picking while remaining on track.

## 2. Product outcome and boundary

Give teams a shared view of demand, the supply covering it, the remaining blockers, and known arrival-date conflicts against production start. Track actual availability and staging separately. Translate visibility into decisions: reserve, transfer, purchase, expedite, inspect, resolve an exception, or revise the production plan.

The discussed workflow ends at **kit staged**. Physical production execution and component consumption are beyond this boundary. Staging must not automatically be treated as the accounting event that charges material to a work order.

The discussion has focused on direct production material. General-stock replenishment is included as a purchasing reason. Workflows for indirect purchases such as laptops and office chairs have not been designed.

## 3. Users and responsibilities

| User/function | Main decisions and responsibilities |
|---|---|
| Program/production planning | Review work-order readiness and production starts; choose priorities when material must be allocated across competing orders. Broad scheduling simulation remains deferred. |
| Material planning / purchasing | Review coverage, confirm or release remote inventory holds, arrange transfers, buy shortages, consolidate demand, replenish stock, and coordinate expedited handling manually. Treat these as one function for the prototype. |
| Receiving / warehouse | Anticipate arrivals, receive and count material, manage queues, pick and stage kits, and flag discrepancies. |
| QA | Record quantities accepted and rejected at a simple QA stage. Accepted quantity becomes available; rejected quantity is scrapped, with source links preserved. |

For material shortages, the program manager chooses priorities and purchasing applies allocations. Both roles see the impact. QA records outcomes; the prototype does not establish real-world authority to override quality decisions.

## 4. Core decisions

### 4.1 Work-order finalization allocates inventory

Draft or proposed work orders support planning without changing committed inventory reservations. When a work order is finalized, automatically reserve eligible, unallocated inventory in the warehouse attached to its manufacturing facility.

Reservation commits supply to demand; it does not physically pull the material. Picking and staging are separate warehouse activities.

For unmet demand, the latest selected direction is to **provisionally reserve eligible stock at other locations**, then require the material planner to confirm the transfer or release the hold and purchase externally. This supersedes the earlier idea of leaving all remote stock unreserved until a manual decision.

A remote hold must remain visibly distinct from local availability. It does not make the work order ready. The planner needs transfer timing, cost, and competing demand to make the decision. Existing commitments must not be silently taken from another order.

**Selected UI:** remote allocations appear within **Source material**, labeled “Stock at another site,” alongside local stock, open orders, and purchasing options. “Buy instead” opens the purchase flow for the same requirements; it must not merely release stock and navigate to a general queue. Preserve the remote allocation while the user edits; when the replacement purchase is confirmed, release the replaced quantity and create its new allocation together. Canceling the dialog changes nothing. A deliberate release without replacement remains a separate secondary action.

**Open:** Remote-site selection, hold duration and expiry, ownership, cross-site priority conflicts, and whether remote sites must approve transfers.

### 4.2 Consolidate sourcing by part and destination

The **Source material** queue defaults to one row per part and destination, with affected work orders expandable underneath. Show part/description, destination, preferred supplier if known, quantity short or requiring a source decision, earliest production start, and one primary **Source material** action. Replenishment is a filter/reason within this queue rather than another top-level page. Preserve separate replenishment and work-order quantities.

The sourcing panel brings together available-to-allocate local stock, unallocated open PO supply with dates, remote-stock options, and the remaining purchase quantity. Let purchasing choose supply and quantities while seeing which work orders receive them. Do not recommend a new buy as if existing supply did not exist. Do not automatically select a supplier, transfer, or allocation priority beyond the existing finalization rules.

Show supplier, destination, part, quantities, and production dates as explicit context. A supplier may be unknown before buying; label it “Not selected” rather than inventing one. Retain chosen requirements and quantities when switching sourcing options. Clearly show confirmed changes and the remaining short quantity after each action; an uncommitted dialog must not change live allocations.

“By part” and “By work order” are grouping/filter options over the same demand, not independent queues with duplicate purchase actions. Compatible demand may share a purchase, but each requirement keeps its quantity and date. Do not merge sites into a sourcing row or imply that all stock across sites is immediately usable locally.

**Selected UI — queue split:** a toggle switches between the two groupings; the chosen grouping is kept in the URL so it survives refresh and can be shared.

- **By part number** (default): one row per part and destination site with total short, earliest production start, preferred supplier, and reasons (short, stock at another site, replenishment). Expanding a row lists each affected work order with its created date, production start, and quantity. Source material for the group covers all listed requirements.
- **By work order:** one row per requirement with work order, **created date**, site, production start, part, supplier, and quantity. It does not list which other work orders are short for the same part; combining demand belongs to the by-part grouping. Source material from this row preselects only this requirement.

### 4.3 One PO line can support multiple work orders

A PO line can have multiple quantity allocations to different work orders. Each allocation retains its quantity and derives its need-by date from the linked work order’s production start. Any remainder can remain unallocated for general inventory.

For example, one purchase of 1,000 units could cover 200 for work order A, 300 for B, 400 for C, and 100 for general stock. Consolidation does not merge the work orders’ individual requirements or deadlines.

Receiving records what arrived against the PO. Allocations preserve which demand the supply supports. Partial arrivals and partial QA release must expose which work-order quantities are actually covered and which are still waiting.

**Selected:** Do not automatically prioritize competing work orders after a short receipt or QA rejection. Surface the shortfall as a **material shortage** with its linked work orders to purchasing and the program manager. Use scenario planning to preview and apply a manual allocation decision. Until then, show "Allocation decision needed"; do not claim every linked order is individually short or fully covered.

### 4.4 General inventory can trigger replenishment

Allow a part to carry a stock threshold so planning/purchasing can identify a replenishment need even without an individual work order. This is particularly relevant for long-lead-time material.

The discussed implementation direction is a warehouse-specific reorder threshold and target level, potentially populated from a company default. Account for reservations and incoming or already-requested supply to avoid repeatedly suggesting the same purchase. Timing matters: future supply may not prevent an earlier shortage.

The system flags or suggests the need; automatic vendor order placement has not been selected.

**Open:** Exact threshold calculation, time horizon, company-versus-site configuration, and buyer confirmation details.

### 4.5 Complete-kit readiness uses production start as its date anchor

Work orders enter with explicit required parts and quantities. Do not calculate requirements from a BOM. All required material must be available and staged for the work order to be ready. Splitting a build into work orders for different stages or long-lead components happens upstream and is outside this prototype.

Show **production start date** on receiving screens, warehouse screens, and their queues. For shared supply, show the linked work orders and their production start dates; an earliest-start summary may be used without implying an allocation priority. Do not add separate receiving, QA, or staging target dates or processing-buffer calculations yet.

Arrival is still distinct from readiness: on-order supply, transfers in transit, material awaiting receipt, and material awaiting QA are not available or staged. Display their actual stage rather than collapsing them into “On order.” Compare expected arrival to production start to identify known delivery conflicts. Arrival on or before production start means no known arrival-date conflict, not a guarantee that processing and staging can finish in time. Missing arrival dates mean timing is unknown.

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

If 100 units support three work orders and QA accepts 80, show **100 allocated / 80 available — allocation decision needed**. Do not automatically select which order loses 20 units. The 20 scrapped units never count as supply; the material shortage goes to scenario planning. Fine-grained urgent inspection splitting is deferred; separate receipts/QA batches still retain their source links.

### 4.9 Exceptions retain their operational impact

Report short receipts, QA rejection, and picking discrepancies where discovered. Preserve source, affected quantity, owner, linked work orders, production start dates, and review status. Purchasing and the program manager see material shortfalls; warehouse staff record facts without choosing program priority.

Distinguish an unresolved allocation decision from a confirmed shortage on a particular work order. After a plan is applied, show the actual remaining shortages by order. Acknowledging an exception does not create stock, reverse scrap, or erase a shortage. The exception may be closed when its review/action is recorded, while any unresolved material shortage remains visible independently.

### 4.10 Allocate material across competing work orders

For this prototype, use one focused allocation workspace for a shared shortage or an ambiguous partial receipt. A partial receipt can require choosing who receives accepted stock now even when the remaining incoming supply will cover every order. Only the first case implies a total supply deficit. Purchasing and the program manager inspect the remaining supply, allocate it between available and incoming quantities per work order, retaining separate on-order, transfer, and awaiting-QA detail, and see which orders remain short alongside production start dates. The scenario screen names the part, PO line, supplier, and destination as separate labeled fields. Reuse the same draft for the same decision when reached from different screens; do not create duplicate scenarios on each click.

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

Within Source material, show matching incoming PO and transfer supply, quantity not already allocated, destination, and expected arrival. Label PO supply **On order** and transfers **Transfer in transit**, not available stock. The purchaser can assign an unallocated quantity to a work-order item before deciding to buy more. Do not automatically allocate incoming supply or recommend a new buy as if that supply did not exist. Supply arriving after production start may be assigned, but its timing conflict stays visible.

### 4.15 Purchase order check-in tasks

Purchasing can add an optional **purchase order check-in task**, with due date, owner, and short note. For example, November 23 is the check-in date for a December 1 delivery. These are separate dates and records.

The Supplier follow-up queue shows the next open check-in date and highlights due/overdue tasks with a link to the PO. Completing a check-in records an outcome and may update expected arrival. An overdue check-in means follow-up is needed; it does not by itself mean the material is late. A check-in finding a later arrival triggers the work-order impact rules above.

Supplier-capacity concerns are handled through purchaser judgment, notes, and these tasks. Do not add supplier-level confirmation-required settings, confidence scoring, or modeled capacity constraints.

### 4.16 Consolidation is the logistics-cost scope

Flag other compatible demand as an opportunity to combine purchases into one PO. Show quantities, supplier/destination compatibility, and affected production start dates so purchasing can judge timing. Preserve each work-order allocation. This is a decision aid for potential savings, not a freight-price calculation or a claim that every combined purchase reduces shipping cost. Detailed freight optimization is deferred.

### 4.17 Navigation follows decisions

Purchasing has three primary work queues:

| Queue | Contents | Primary operation |
|---|---|---|
| **Source material** | Short requirements, remote-stock decisions, replenishment | Assign stock/incoming supply, arrange transfer, or purchase |
| **Supplier follow-up** | Due check-ins, missing/late supplier arrivals, PO reviews | Record supplier update and follow-up outcome |
| **Allocate material** | Shared shortages and accepted receipts needing allocation decisions | Preview and apply allocations across work orders |

Purchase orders, Work orders, and Inventory are reference views. Program management sees Work orders and the same Allocate material workspace. Warehouse and QA retain task-specific views appropriate to physical work; do not merge separate physical confirmations merely to reduce clicks.

Consolidate related alerts under their source decision. A PO check-in and a late shipment can appear as reasons on one follow-up item, retaining shipment-level updates and task identities. A QA rejection and its allocation deficit open the same allocation decision with issue context. Counts represent actionable items, not the sum of duplicate alerts. Independent decisions may still appear separately.

Filter by site, supplier, work order, and issue type where useful. A filter or alternate grouping does not need its own top-level sidebar destination. Use specific issue labels; keep a full exception/history register as a secondary reference if needed.

### 4.18 Complete actions in context

Every primary action opens the relevant record/task with part, source, destination, requirement, and quantity preselected where known. No generic “Open exception,” unfiltered pick-list redirect, or arrival dialog that asks the user to re-identify the source they just selected.

Record supplier update supports an outcome note, optional expected-arrival changes for selected shipment/PO lines, completion of the relevant check-in, and an optional next check-in. These changes belong in one interaction. Show affected production starts and remaining conflicts; do not imply that recording a later date resolves lateness. External supplier negotiation remains manual.

Exception follow-up is captured alongside the operational action. Acknowledge is not a mandatory separate click. Record links to the applied allocation, replacement purchase, or follow-up. Close only the issue review actually completed; unresolved shortages and independent blockers stay visible. Reject and scrap remains irreversible within this prototype’s ordinary workflow.

After confirmation, refresh affected work-order, PO, inventory, task, and queue summaries. Show what changed and what remains to do. Cancel/Discard leaves uncommitted changes untouched. Consolidated interactions must preserve atomic quantity updates and manual priority decisions.

### 4.19 Screen hierarchy and information density

**Work-order detail:** compact header with order identity, program, site, production start, build quantity, and kit/schedule summary. Use one requirements table: Part (with description), Needed, Current situation, Next action. Provide Attention needed / All requirements filtering. Do not repeat the same requirements in a second “What needs to happen” action table. Expand a row for allocations, shipment/QA details, secondary issues, and history. Hide empty fixture/exception panels; move Reduce requirement and Cancel order into secondary menus. Show fixture review only when relevant.

**PO detail:** default line table uses Part, Ordered, Received, Next arrival, Issue, Action. Expand one selected line for shipment, allocation, QA, and quantity breakdowns. Do not expand every line by default. Show a concise “Multiple arrivals” summary where one date would mislead. Completed check-ins/history are secondary. Supplier simulation belongs in demo controls, not the normal purchasing action area.

**Allocation workspace:** show part/source/supplier/site, remaining available and incoming supply, and a work-order allocation table with production starts and proposed outcome. Keep Preview and Apply together. Omit empty source columns (for example incoming when none exists). Retain stale-state warnings and both live and proposed consequences without repeating the same totals in several cards.

Use brief factual labels and operational quantities. Put rule explanations in help/detail only when useful. Avoid decorative coverage bars, repeated colored badges, raw JSON history, and paragraphs repeating the table. One primary action may open several legitimate options; it must not hide mixed shortages or force an artificial one-state model.

## 5. Data model and quantity rules

The relationships and quantity constraints below implement the discussion. Field names, helper records, and status names are **proposed implementation defaults**, not requirements independently chosen by Kyle or claims about Anduril’s systems. A coding agent may adapt the schema while preserving these behaviors.

### 5.1 Core records

All records have stable IDs. Mutable records carry `updated_at`; records changed by scenario Apply also carry a version for stale-state checks. Quantities use the part’s unit of measure; unit conversions are out of scope.

| Record | Minimum fields and relationships |
|---|---|
| Part | `id`, `part_number`, description, unit of measure, `requires_qa`; optional traceability/replenishment settings. Fixtures remain a separate requirement type. |
| Warehouse | `id`, name, facility reference. Inventory is location-specific, never just a global part-number balance. |
| WorkOrder | `id`, program, facility/warehouse, `production_start_date`, state (`draft`, `finalized`, `canceled`), `created_at` (when the upstream work order was created; shown in queues and work-order views). |
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

If the remaining supply is insufficient for all allocations, do not choose winners during this handoff. Mark it as a material shortage with the linked work orders as "Allocation decision needed", block affected quantities from picking, and let scenario Apply assign available inventory and any remaining incoming supply, with its actual stage shown. Existing allocations remain visible as demand, not additional stock. Scrapped quantities can never back allocations. After Apply, any demand without a valid source is explicitly short.

For a normal partial receipt with enough remaining on-order quantity to honor all allocations, preserve the allocations. Any choice about which order receives the now-available subset is manual if ambiguous through **Assign received material** in the Allocate material workspace; a partial shipment alone need not mean a material shortage.

Transfers follow the same conservation rule: source stock reserved for transfer cannot also cover a local order; receipt at destination retires the corresponding in-transit quantity and establishes destination inventory once. For the prototype, manually seeded/updated transfer records are sufficient.

### 5.3 Quantity invariants

- Quantities are nonnegative and allocations require matching part/unit. Active allocations cannot exceed a work-order item’s requirement or available source quantity when created/applied. A later real-world shortfall may invalidate existing claims; surface that conflict rather than silently reprioritizing them.
- Track disjoint remaining quantities: unshipped, shipped-not-received, received-pending-QA, accepted (available), scrapped. Historical shipment/receipt/QA totals are not additive inventory balances.
- For completed QA: `accepted_qty + rejected_qty = input_qty`. Across batches, total input cannot exceed the receipt quantity. Pending QA is unavailable. A part that does not require QA can become accepted through receipt completion.
- Ordered quantity minus canceled quantity reconciles to unshipped, in-transit, and cumulatively received quantities. A short delivery either leaves a known outstanding balance or is recorded as a closed shortfall; do not silently delete the missing units. Over-receipts require manual review.
- Accepted quantity remains inventory when picked/staged; update its location/stage rather than adding it again. Staged material stays reserved. Consumption/accounting issue is outside this workflow.
- Only unused allocations are automatically released for demand reduction/cancellation. Picked/staged material is not made available by an administrative release.
- Posting a receipt, QA outcome, handoff, or scenario twice must not double the quantity. Use operation IDs or equivalent duplicate-submit protection. This does not require production-grade supplier integration event handling.

### 5.4 Derived facts and operator summaries

Calculate required quantity, allocated incoming quantity by stage, allocated available quantity, staged quantity, short quantity, and allocation-review state. Staged is a subset of available, not additional supply. Disputed commitments are not fully allocated coverage. Preserve this detail behind the summary; do not render a separate default column for every internal quantity bucket.

Each requirement has one **primary situation** and one **primary action**, with secondary issues visible on expansion. Default situation precedence is allocation decision, confirmed short quantity, remote transfer decision, late arrival, unknown arrival, awaiting receipt, awaiting QA, remaining incoming supply, ready to stage, staged. Precedence selects the summary, not which facts exist or who gets stock. A confirmed short quantity independent of a disputed allocation must remain visible in detail.

| Situation example | Primary action / behavior |
|---|---|
| Allocation decision needed | Allocate material; open the specific shared source/draft |
| Short 20 | Source material; preselect the requirement and destination |
| Stock at another site | Source material; show transfer and purchase options |
| 20 arrive Dec 5 — start Dec 3 | Record supplier update; preselect the shipment/PO line |
| Arrival date unknown | Record supplier update for the specific incoming source |
| Arrived — awaiting receipt | Open the specific receiving task |
| 40 awaiting QA | Open the specific QA task; do not request a supplier ETA |
| 60 on order — arriving Dec 2 | No mandatory action; scheduled follow-up remains independently visible |
| Transfer in transit — arriving Dec 2 | View transfer; supplier follow-up is not implied |
| Available — not staged | Open this order’s pick/stage tasks |
| Staged | No action |

Already received quantities do not remain late or unknown because of an obsolete arrival estimate. They can still be unready because receipt, QA, or staging is incomplete. For mixed supplies, retain quantities, dates, stages, and affected requirements in expanded detail. If shipment attribution is undecided, explicitly show timing review rather than inventing a precise order-level arrival.

**Work-order summary:** show Kit ready when all material is accepted/staged, all blocking issues or allocation decisions are resolved, and manual fixture coverage is recorded. Otherwise show a separate schedule outlook and outstanding actions. Use these prototype rules:

- **At risk:** a known late incoming quantity, confirmed shortage, unresolved shared allocation, blocking material issue, unconfirmed required fixture coverage, or an incomplete kit at/past production start.
- **Unknown:** no known At risk condition, but a required incoming arrival or transfer timing is unknown/unconfirmed.
- **On track:** no known risk/unknown condition; valid allocations exist and known incoming dates meet production start. Receiving, QA, or staging may still be pending. This is not a processing-time forecast or guarantee.

At risk takes precedence over Unknown, which takes precedence over On track. Draft and canceled work orders show their lifecycle state rather than a readiness forecast. “Action needed” is a task indicator, not a competing schedule-outlook category. An overdue check-in alone does not imply late material or an At risk work order.

No receiving/QA/staging buffers or predicted readiness dates are added. The model still records physical state and process tasks even when schedule outlook is On track.

### 5.5 Concrete acceptance examples

1. **Shared QA rejection:** A/B/C require 40/30/30 of the same part. A 100-unit receipt yields 80 accepted and 20 scrapped. Show 100 allocated / 80 available and "Allocation decision needed"; no automatic losing order. A draft 40/30/10 plan leaves C short 20 only in preview. Apply commits that outcome; available allocations sum to 80, the 20 scrapped units never return to supply, and repeating Apply does not duplicate stock.
2. **PO check-in:** A November 23 task concerns a December 1 arrival. An overdue task highlights follow-up only. Updating arrival to December 5 flags a linked December 3 work order while leaving its production start unchanged.
3. **Incoming assignment:** A PO line has 100 units, 70 already assigned. Planning exposes 30 unallocated; assigning 20 leaves 10, and the demand is marked on order rather than ready.
4. **Stage conservation:** Receiving 40 of 100 leaves 60 outstanding. Accepting the 40 yields 40 available, not 140. Staging those 40 changes stage only. Accepted inventory and the remaining PO quantities cannot both claim the same 40 units.
5. **Cancellation:** Canceling an order releases its unused stock/PO commitments, flags the PO for review, and does not cancel the supplier order or release already staged material.
6. **Stale scenario:** If QA or allocations change after preview, Apply requires refresh/review and makes no partial changes.


7. **Context preservation:** Buy instead opens the purchase flow for the selected remote allocation; canceling changes nothing. Confirmation replaces only the selected quantity. Pick/QA/receipt actions open the specific task or an order-filtered task list, not a general queue.
8. **Mixed condition:** A requirement can be short 20 and have another 30 arriving late. The primary situation follows precedence; expanded detail shows both, with each relevant action. The short quantity is not silently removed when an arrival is updated.
9. **Received material:** Accepted or pending-QA receipt quantities are not labeled Arriving and do not ask for supplier dates. QA rejection scraps stock and opens the appropriate source/allocation issue without a quality-hold workflow.
10. **Consolidated follow-up:** A due check-in and late shipment on the same PO can be handled in one update interaction. Completing the task does not remove an unresolved delivery conflict.
11. **No duplicate work:** A work-order requirement has one action-bearing row. Related exception context opens the same operational decision; independent blockers remain visible after that decision is completed.

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

**Selected prototype behaviors:** Complete-kit readiness per upstream work order with a kit/schedule summary and next action; local allocations and provisional remote allocations within Source material; manual assignment of incoming supply; consolidated sourcing by part/destination with suppliers and work-order detail; manual/simulated arrival updates; PO check-in tasks; receiving and minimal accepted/scrapped QA; material-shortage visibility for purchasing/program management; manual allocation scenario with explicit Apply; picking/staging; unused-allocation release and PO review on cancellation/reduction.

**Screen principles:** organize queues around the three decisions in §4.17, preserve action context (§4.18), and use progressive detail (§4.19). One primary situation/action summarizes each requirement without suppressing other facts. No duplicate action table or top-level page for every condition.

These decisions define behavior, not a requirement to polish every screen. The suggested connected demonstration is purchasing assigns supply → receiving records arrival → QA rejects part of a shared receipt → purchasing/program management review and apply allocations → remaining shortages stay visible. This demonstration sequence is an AI suggestion for Kyle to select, not a claim of completed validation.

**Explicitly deferred:** Work-order splitting/BOM explosion; operation-level partial starts; processing buffers and calculated readiness dates; expedite commitment workflows; detailed QA/rework; supplier-capacity modeling and confidence scores; supplier-level confirmation rules; automated recovery; freight optimization; broad scheduling scenarios; AI planning; live supplier/carrier/ERP connections; indirect purchasing; production execution and accounting issue.

Supplier capacity is addressed only through human judgment and check-ins. Consolidation surfaces potential logistics savings without computing freight cost. Manual/simulated updates demonstrate information flow, not improved supplier-date accuracy by themselves. These limits should remain explicit in Kyle’s write-up.

Remaining validation questions, not requests to expand the build:

- Which existing systems own work orders, inventory, quality release, and allocations in a real implementation?
- What remote-hold selection/expiry rules and replenishment formulas are needed? These earlier concept details remain open; do not add optimization implicitly.
- What revision, approved-source, lot/documentation, and substitution rules make inventory eligible? For seeded prototype data, assume exact part matches and explicitly acceptable inventory except demonstrated pending QA or scrap.
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
- **Planning discussion supplied in this conversation:** Source of the decisions and trade-offs recorded here. The latest discussion establishes consistent operator terminology and consolidates sourcing, supplier follow-up, and allocation decisions. The source review identified duplicate work-order actions, context-losing links, and excessive default quantity detail; this revision specifies the next iteration, not completed implementation. Data-model mechanics marked proposed are AI-assisted implementation recommendations.

This document organizes the discussion with AI assistance. It does not establish that its assumptions have been tested, nor replace Kyle’s own process narrative about research, judgment, AI usage, and implementation choices.
