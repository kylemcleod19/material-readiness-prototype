// Response shapes from the backend read models. All quantities and statuses are
// computed server-side; the UI only displays them.

export type Role = "planning" | "purchasing" | "warehouse" | "qa";
export type Timing = "none" | "on_time" | "unknown" | "timing_review" | "late";

export interface WhRef { id: string; code: string; name: string }

export interface WorkOrderSummary {
  id: string; number: string; title: string; program: string; warehouse: WhRef;
  production_start_date: string; days_to_start: number; state: "draft" | "finalized" | "canceled";
  build_qty: number; outlook: Outlook; headline: string; ready: boolean; next_actions: NextAction[];
  kit: { lines: number; staged: number; short_lines: number };
  fixtures: { total: number; covered: number }; open_exceptions: number;
}

export interface SourceLine {
  allocation_id: string; source_type: "po_line" | "transfer_line" | "inventory"; source_id: string;
  label: string; qty: number;
  category: "incoming" | "available" | "picked" | "staged" | "remote_hold" | "review" | "blocked";
  expected_arrival: string | null; timing: Timing; late_qty: number; warehouse: string | null; detail: string | null;
  po_id: string | null;
}

export interface SupplyOption {
  source_type: "po_line" | "transfer_line" | "inventory"; source_id: string; label: string; supplier?: string;
  destination: WhRef; compatible: boolean; unallocated: number; expected_arrivals: (string | null)[];
  kind: "on_order" | "in_stock"; arrives_after_start: boolean;
}

export interface DemandRef {
  work_order_item_id: string; work_order_id: string; work_order_number: string; state: string;
  warehouse: WhRef; production_start_date: string; required: number; uncovered: number;
}

export interface ItemReadiness {
  item_id: string; work_order_id: string; line_no: number; part_id: string; part_number: string;
  description: string; uom: string; required: number; incoming: number; available: number; picked: number;
  staged: number; remote_hold: number; review: number; uncovered: number; timing: Timing; late_qty: number;
  expected: string | null; state: ReqState; action: NextAction | null;
  sources: SourceLine[]; exceptions: string[]; other_demand: DemandRef[]; supply_options: SupplyOption[];
  local_free_stock?: number;
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
  id: string; type: string; state: "open" | "acknowledged" | "closed"; title: string; detail: string | null;
  source_type: string; source_id: string; affected_qty: number; blocking: boolean; owner_role: string;
  raised_by: string; created_at: string; resolution_note: string | null; closed_at: string | null;
  part_number: string | null; links: ExceptionLink[];
}

export interface HistoryRow {
  id: number; at: string; actor: string; role: string; channel: string; entity_type: string; entity_id: string;
  action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  items: ItemReadiness[]; fixture_requirements: Fixture[]; exceptions: MaterialException[];
  history: HistoryRow[]; cancel_reason: string | null;
}

export interface WoRef {
  work_order_id: string; work_order_number: string; work_order_title: string; production_start_date: string;
  warehouse: WhRef; work_order_item_id: string; part_id: string; part_number: string;
}

export interface MaterialShortage {
  po_line_id: string; po_id: string; label: string; part_id: string; part_number: string; description: string;
  supplier: string; allocated: number; available: number; in_qa: number; not_received: number; scrapped: number;
  short: number; earliest_start: string | null; exceptions: string[]; draft_scenario_id: string | null;
  affected: { allocation_id: string; work_order_item_id: string; work_order_id: string; work_order_number: string;
    production_start_date: string; required_qty: number; allocated_qty: number }[];
}

export interface CheckIn {
  id: string; po_id: string; po_number: string; po_line_id: string | null; supplier: string; due_date: string;
  status: "overdue" | "due" | "upcoming"; owner: string; note: string | null; expected_arrivals: string[];
}

export interface Replenishment {
  part_id: string; part_number: string; description: string; warehouse: WhRef; free_on_hand: number;
  incoming_unallocated: number; projected: number; reorder_point: number; target_level: number;
  suggested_qty: number; lead_time_days: number | null; policy_source: string; next_incoming: string | null;
  preferred_supplier: string | null;
}

export interface PurchasingQueue {
  today: string;
  counts: Record<string, number>;
  uncovered: (WoRef & { required: number; uncovered: number; options: SupplyOption[]; other_demand: DemandRef[];
    supplier: SupplierRef | null; unassigned_here: number })[];
  remote_holds: (WoRef & { allocation_id: string; qty: number; required: number; source_warehouse: WhRef;
    competing_demand: DemandRef[]; supplier: SupplierRef | null })[];
  material_shortages: MaterialShortage[];
  handoffs: { po_line_id: string; po_id: string; label: string; part_number: string; accepted_waiting: number;
    claims: (WoRef & { allocation_id: string; qty: number })[] }[];
  timing_conflicts: (WoRef & { timing: Timing; late_qty: number; sources: SourceLine[]; supplier: SupplierRef | null })[];
  checkins: CheckIn[];
  pos_needing_review: { id: string; number: string; supplier: string; review_note: string | null }[];
  exceptions: MaterialException[];
  replenishment: Replenishment[];
}

export interface InventoryRollup {
  part_id: string; part_number: string; warehouse: WhRef; in_qa: number; available: number; allocated: number;
  held_for_other_site: number; free: number; staged: number; in_transfer: number; awaiting_handoff: number;
}

export interface PartRequirement {
  work_order_item_id: string; work_order_id: string; work_order_number: string; warehouse: WhRef;
  production_start_date: string; required: number; from_stock: number; on_order: number; at_other_site: number;
  decision_needed: number; short: number; expected: string | null; state: ReqState; action: NextAction | null;
  sources: { label: string; qty: number; category: string; expected_arrival: string | null; po_id: string | null }[];
}

export interface PartView {
  id: string; part_number: string; description: string; uom: string; lead_time_days: number | null;
  supplier: SupplierRef | null; orders: number; needed: number; covered: number; gap: number; late_qty: number;
  verdict: "short" | "assign_existing" | "at_risk" | "covered" | "no_demand"; free_stock: number;
  requirements: PartRequirement[];
  purchases: { destination: WhRef; short: number; unassigned_here: number; demand: DemandRef[] }[];
}

export interface POShipment {
  shipment_id: string; shipment_line_id: string; number: string; status: string; qty: number; open_qty: number;
  expected_arrival: string | null; arrival_basis: string | null; arrival_channel: string;
  arrival_updated_at: string | null; carrier: string | null; tracking_number: string | null; carrier_eta: string | null;
}

export interface POLine {
  id: string; line_no: number; label: string; part_id: string; part_number: string; description: string; uom: string;
  ordered: number; canceled: number; closed_shortfall: number; received: number; outstanding: number;
  in_transit: number; unshipped: number; pending_qa: number; awaiting_handoff: number; claims: number;
  unallocated: number; deficit: number; expected_arrival: string | null; arrival_basis: string | null;
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

export interface ScenarioPreview {
  scenario_id: string; state: "draft" | "applied" | "discarded"; stale: boolean; feasible: boolean; errors: string[];
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
export interface ScenarioBrief {
  available: number; incoming: number; review: number; uncovered: number; staged: number; timing: Timing; state: ReqState;
}

export interface Master {
  today: string;
  parts: { id: string; part_number: string; description: string; uom: string; requires_qa: boolean; preferred_supplier_id: string | null }[];
  warehouses: (WhRef & { facility: string; city: string })[];
  suppliers: { id: string; name: string }[];
  programs: { id: string; name: string }[];
}

export interface DemoAction { name: string; title: string; role: Role }

export interface SupplierRef { id: string; name: string }

export type Outlook = "ready" | "on_track" | "at_risk" | "action_needed" | "not_reserved" | "canceled";

/** One status per requirement, in precedence order (see PRD §5.4). */
export type ReqState =
  | "short" | "decision_needed" | "transfer_decision" | "arrives_late" | "arrival_unknown"
  | "on_order" | "ready_to_stage" | "staged" | "not_reserved" | "canceled";

export interface NextAction {
  kind: "buy" | "resolve_shortage" | "decide_transfer" | "update_arrival" | "get_arrival_date" | "pick_stage"
    | "review_fixture" | "finalize" | "resolve_exception";
  qty?: number; state?: ReqState; item_id?: string; part_id?: string; part_number?: string;
  supplier?: SupplierRef | null; unassigned_here?: number;
  po_line_id?: string | null; po_line_label?: string; po_id?: string | null; po_number?: string;
  allocation_id?: string; from_warehouse?: WhRef | string;
  fixture_id?: string; exception_id?: string; label?: string;
}
