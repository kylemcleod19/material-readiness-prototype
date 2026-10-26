// Response shapes from the backend read models. All quantities, situations, and outlooks are
// computed server-side; the UI only displays them.

export type Role = "planning" | "purchasing" | "warehouse" | "qa";
export type Timing = "none" | "on_time" | "unknown" | "timing_review" | "late";

export interface WhRef { id: string; code: string; name: string }
export interface SupplierRef { id: string; name: string }

/** Schedule outlook, separate from task ownership and physical stage (PRD 5.4). */
export type Outlook = "kit_ready" | "on_track" | "unknown" | "at_risk" | "draft" | "canceled";

/** Situation kinds in default precedence order (PRD 5.4). */
export type SituationKind =
  | "allocation_decision" | "short" | "stock_at_other_site" | "arrives_late" | "arrival_unknown"
  | "awaiting_receipt" | "awaiting_qa" | "on_order" | "transfer_in_transit" | "ready_to_stage" | "staged"
  | "not_reserved" | "canceled";

export interface NextAction {
  kind: "source_material" | "allocate_material" | "record_supplier_update" | "receive" | "inspect"
    | "pick_and_stage" | "confirm_fixture" | "finalize" | "resolve_issue";
  qty?: number; situation?: SituationKind; item_id?: string; part_id?: string; part_number?: string;
  warehouse_id?: string; warehouse?: WhRef;
  po_line_id?: string; po_line_label?: string;
  po_id?: string; po_number?: string; target_type?: "shipment" | "po_line"; target_id?: string; target_label?: string;
  shipment_id?: string; shipment_number?: string; qa_batch_id?: string | null; work_order_id?: string;
  fixture_id?: string; exception_id?: string; label?: string;
}

export interface Situation {
  kind: SituationKind; qty: number; date: string | null; detail: string | null; action: NextAction | null;
}

export interface WorkOrderSummary {
  id: string; number: string; title: string; program: string; warehouse: WhRef;
  created_at: string; production_start_date: string; days_to_start: number; state: "draft" | "finalized" | "canceled";
  build_qty: number; outlook: Outlook; headline: string; kit_ready: boolean; next_actions: NextAction[];
  action_count: number; kit: { lines: number; staged: number };
  fixtures: { total: number; covered: number }; open_exceptions: number;
}

export interface SourceLine {
  allocation_id: string; source_type: "po_line" | "transfer_line" | "inventory"; source_id: string;
  label: string; qty: number;
  category: "incoming" | "available" | "picked" | "staged" | "remote_hold" | "review" | "blocked";
  expected_arrival: string | null; timing: Timing; late_qty: number; warehouse: string | null; detail: string | null;
  po_id: string | null;
}

export interface ItemReadiness {
  item_id: string; work_order_id: string; line_no: number; part_id: string; part_number: string;
  description: string; uom: string; required: number; incoming: number; available: number; picked: number;
  staged: number; remote_hold: number; review: number; uncovered: number; timing: Timing; late_qty: number;
  expected: string | null; situations: Situation[]; situation: Situation; state: SituationKind;
  action: NextAction | null; needs_attention: boolean;
  sources: SourceLine[]; exceptions: string[]; available_to_allocate?: number;
}

export interface Fixture {
  id: string; operation: string; fixture_type: string; quantity: number;
  coverage_state: "pending" | "covered" | "action_needed"; note: string | null;
  reviewed_by: string | null; reviewed_at: string | null;
}

export interface ExceptionLink {
  work_order_item_id: string; work_order_id: string; work_order_number: string;
  production_start_date: string; claimed_qty: number | null; part_number: string;
}

export interface MaterialException {
  id: string; type: string; label: string; state: "open" | "acknowledged" | "closed"; title: string;
  detail: string | null; source_type: string; source_id: string; affected_qty: number; blocking: boolean;
  owner_role: string; raised_by: string; created_at: string; resolution_note: string | null; closed_at: string | null;
  part_number: string | null; links: ExceptionLink[];
}

export interface HistoryRow {
  id: number; at: string; actor: string; role: string; channel: string; entity_type: string; entity_id: string;
  action: string; summary: string; note: string | null;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  items: ItemReadiness[]; fixture_requirements: Fixture[]; exceptions: MaterialException[];
  history: HistoryRow[]; cancel_reason: string | null;
}

// ------------------------------------------------------------------ purchasing queues (PRD 4.17)

export type SourceReason = "short" | "stock_at_other_site" | "replenishment";

export interface SourceRequirement {
  work_order_item_id: string; work_order_id: string; work_order_number: string; work_order_title: string;
  created_at: string; production_start_date: string; warehouse: WhRef; part_id: string; part_number: string;
  description: string; supplier: SupplierRef | null; required: number; short: number; at_other_site: number;
  reasons: SourceReason[]; remote_holds: { allocation_id: string; qty: number; warehouse: WhRef }[];
}

export interface SourceGroup {
  part_id: string; part_number: string; description: string; warehouse: WhRef; supplier: SupplierRef | null;
  lead_time_days: number | null; short: number; at_other_site: number; replenishment: number; to_source: number;
  reasons: SourceReason[]; requirements: SourceRequirement[]; earliest_start: string | null;
  available_to_allocate: number; unallocated_on_order: number;
}

export type FollowUpReason =
  | { type: "check_in"; status: "overdue" | "due"; date: string; task_id: string; note: string | null }
  | { type: "late_arrival" | "unknown_arrival"; qty: number; date: string | null; part_number: string;
      work_order_id: string; work_order_number: string; production_start_date: string;
      target_type: "shipment" | "po_line"; target_id: string }
  | { type: "po_review"; note: string | null };

export interface ArrivalTarget {
  target_type: "shipment" | "po_line"; target_id: string; label: string; qty: number;
  expected_arrival: string | null; basis: string | null;
}

export interface FollowUpItem {
  po_id: string; po_number: string; supplier: string; destination: WhRef; reasons: FollowUpReason[];
  next_checkin: string | null; open_checkin_ids: string[]; earliest_start: string | null;
  targets: ArrivalTarget[]; needs_review: boolean;
}

export interface AllocationDecision {
  kind: "shortage" | "received"; po_line_id: string; po_id: string; label: string; part_id: string; part_number: string;
  description: string; supplier: string; warehouse: string; allocated: number; available: number; in_qa: number;
  not_received: number; scrapped: number; short: number; earliest_start: string | null; draft_scenario_id: string | null;
  issues: { id: string; type: string; title: string }[];
  affected: { allocation_id: string; work_order_item_id: string; work_order_id: string; work_order_number: string;
    production_start_date: string; required_qty: number; allocated_qty: number }[];
}

export interface PurchasingQueue {
  today: string;
  counts: { source_material: number; supplier_follow_up: number; allocate_material: number; issues: number; pos_review: number };
  source_material: { groups: SourceGroup[]; requirements: SourceRequirement[] };
  supplier_follow_up: FollowUpItem[];
  allocate_material: AllocationDecision[];
}

export interface SourceOption {
  source_type: "inventory" | "po_line" | "transfer_line"; source_id: string; label: string; qty: number;
  supplier?: string; po_id?: string; lot?: string | null; expected_arrival?: string | null; multiple_arrivals?: boolean;
}

export interface SourcingOptions {
  part: { id: string; part_number: string; description: string; uom: string; lead_time_days: number | null };
  warehouse: WhRef; supplier: SupplierRef | null; requirements: SourceRequirement[];
  available_to_allocate: SourceOption[]; on_order: SourceOption[];
  other_sites: { inventory_record_id: string; warehouse: WhRef; qty: number }[]; replenishment: number;
}

export interface SourcingResult {
  changes: string[]; po_number: string | null;
  remaining: { work_order_number: string; short: number; at_other_site: number; situation: SituationKind }[];
}

// ------------------------------------------------------------------ inventory, POs, warehouse

export interface InventoryRollup {
  part_id: string; part_number: string; warehouse: WhRef; in_qa: number; available: number; allocated: number;
  held_for_other_site: number; free: number; staged: number; in_transfer: number; awaiting_handoff: number;
}

export interface POShipment {
  shipment_id: string; shipment_line_id: string; number: string; status: string; qty: number; open_qty: number;
  expected_arrival: string | null; arrival_basis: string | null; arrival_channel: string;
  arrival_updated_at: string | null; carrier: string | null; tracking_number: string | null; carrier_eta: string | null;
}

export interface POLine {
  id: string; line_no: number; label: string; part_id: string; part_number: string; description: string; uom: string;
  ordered: number; canceled: number; closed_shortfall: number; received: number; outstanding: number;
  in_transit: number; unshipped: number; awaiting_qa: number; received_unassigned: number; allocated: number;
  unallocated: number; deficit: number; next_arrival: string | null; multiple_arrivals: boolean; issue: string | null;
  expected_arrival: string | null; arrival_basis: string | null;
  arrival_channel: string; arrival_updated_at: string | null; supplier_promised_date: string | null;
  acknowledged_at: string | null;
  allocations: { allocation_id: string; work_order_id: string; work_order_number: string;
    production_start_date: string; qty: number; review: boolean; timing: Timing; late_qty: number }[];
  shipments: POShipment[];
}

export interface PurchaseOrder {
  id: string; number: string; status: string; buyer: string; supplier: { id: string; name: string };
  destination: WhRef; needs_review: boolean; review_note: string | null; lines: POLine[];
  next_checkin: { id: string; due_date: string; status: string } | null;
  checkins?: { id: string; po_line_id: string | null; due_date: string; owner: string; note: string | null;
    state: string; outcome: string | null; completed_at: string | null; status: string }[];
  arrival_targets?: ArrivalTarget[]; open_checkin_ids?: string[];
}

export interface Demand { work_order_number: string; work_order_id: string; production_start_date: string; qty: number; review: boolean }

export interface ArrivalLine {
  shipment_line_id: string | null; po_line_id: string; label: string; part_number: string; description: string;
  uom: string; requires_qa: boolean; lot_tracked: boolean; open_qty: number; demand: Demand[];
}

export interface Arrival {
  kind: "shipment" | "unshipped"; shipment_id: string | null; number: string; status: string; supplier: string;
  destination: WhRef; expected_arrival: string | null; arrival_basis: string | null; arrival_channel: string;
  arrival_updated_at: string | null; carrier: string | null; tracking_number: string | null;
  lines: ArrivalLine[]; earliest_start: string | null;
}

export interface QAPending {
  qa_batch_id: string; input_qty: number; part_number: string; description: string; uom: string; label: string;
  lot: string | null; warehouse: WhRef; created_at: string; demand: Demand[]; earliest_start: string | null;
}

export interface PickTask {
  allocation_id: string; inventory_record_id: string; work_order_id: string; work_order_number: string;
  work_order_title: string; production_start_date: string; days_to_start: number; part_number: string;
  description: string; uom: string; qty: number; location: string; lot: string | null; blocked: boolean;
  blocked_reason: string | null;
}

export interface StockRow {
  inventory_record_id: string; part_number: string; description: string; qty: number; uom: string;
  location: string; warehouse: WhRef; lot: string | null; awaiting_handoff?: boolean; origin?: string | null;
}

export interface WarehouseQueue {
  today: string; warehouses: WhRef[]; arrivals: Arrival[]; qa_pending: QAPending[]; putaway: StockRow[];
  picks: PickTask[]; stage: PickTask[];
  transfers: { id: string; part_number: string; qty: number; source: WhRef; destination: WhRef; status: string;
    expected_arrival: string | null }[];
}

export interface InventoryView {
  summary: InventoryRollup[];
  records: { id: string; part_number: string; warehouse: WhRef; location: string; lot: string | null; qty: number;
    status: "available" | "in_qa"; stage: string; pooled_for: string | null; reserved_for_transfer: string | null;
    origin: string;
    allocations: { allocation_id: string; qty: number; state: string; review: boolean; work_order_number: string }[] }[];
}

// ------------------------------------------------------------------ allocation workspace

export interface ScenarioBrief {
  available: number; incoming: number; review: number; uncovered: number; staged: number; timing: Timing; state: SituationKind;
}

export interface ScenarioPreview {
  scenario_id: string; state: "draft" | "applied" | "discarded"; stale: boolean; feasible: boolean; errors: string[];
  kind: "shortage" | "received"; issues: { id: string; type: string; title: string }[];
  po_line_id: string; po_id: string; label: string; part_number: string; description: string; supplier: string;
  warehouse: string; uom: string; owner: string;
  supply: { available: number; incoming: number; allocated: number; short: number };
  proposed: { available: number; incoming: number };
  rows: {
    work_order_item_id: string; work_order_id: string; work_order_number: string; work_order_title: string;
    production_start_date: string; required_qty: number; allocated_qty: number; proposed_available_qty: number;
    proposed_incoming_qty: number; max_from_source: number;
    live: ScenarioBrief; preview: ScenarioBrief;
  }[];
}

export interface Master {
  today: string;
  parts: { id: string; part_number: string; description: string; uom: string; requires_qa: boolean; preferred_supplier_id: string | null }[];
  warehouses: (WhRef & { facility: string; city: string })[];
  suppliers: { id: string; name: string }[];
  programs: { id: string; name: string }[];
}

export interface DemoAction { name: string; title: string; role: Role }
