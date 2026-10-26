import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { FollowUpItem, FollowUpReason } from "@/api/types";
import { DataTable } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate } from "@/components/domain";
import { SupplierUpdateButton } from "@/components/ActionHost";
import { fmtDate } from "@/lib/utils";

function reasonLine(r: FollowUpReason) {
  switch (r.type) {
    case "check_in":
      return <span className={r.status === "overdue" ? "text-amber-700" : ""}>Check-in {r.status} ({fmtDate(r.date)}){r.note ? ` — ${r.note}` : ""}</span>;
    case "late_arrival":
      return <span className="text-red-700">{r.qty} {r.part_number} arrive {fmtDate(r.date)} — {r.work_order_number} starts {fmtDate(r.production_start_date)}</span>;
    case "unknown_arrival":
      return <span>{r.part_number} arrival date unknown — {r.work_order_number} starts {fmtDate(r.production_start_date)}</span>;
    case "po_review":
      return <span>PO review: {r.note}</span>;
  }
}

/** Preselect the shipment/line behind the first delivery problem, if there is one. */
function firstTarget(f: FollowUpItem) {
  const r = f.reasons.find((x) => x.type === "late_arrival" || x.type === "unknown_arrival");
  return r && "target_id" in r ? { type: r.target_type, id: r.target_id } : undefined;
}

const col = createColumnHelper<FollowUpItem>();
const columns = [
  col.accessor("po_number", { header: "PO", cell: (c) => <Link className="whitespace-nowrap font-medium text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.po_id}`}>{c.getValue()}</Link> }),
  col.accessor("supplier", { header: "Supplier" }),
  col.accessor((r) => r.destination.name, { id: "dest", header: "Destination" }),
  col.display({ id: "reasons", header: "Why follow up", cell: (c) => <div className="space-y-0.5 text-sm">{c.row.original.reasons.map((r, i) => <div key={i}>{reasonLine(r)}</div>)}</div> }),
  col.accessor((r) => r.earliest_start ?? "", { id: "start", header: "Earliest affected start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()} /> : <span className="text-zinc-400">—</span>) }),
  col.accessor((r) => r.next_checkin ?? "", { id: "next", header: "Next check-in", cell: (c) => <span className="tabular">{c.getValue() ? fmtDate(c.getValue()) : "—"}</span> }),
  col.display({
    id: "act", header: "",
    cell: (c) => (
      <div className="flex justify-end">
        <SupplierUpdateButton poId={c.row.original.po_id} target={firstTarget(c.row.original)} />
      </div>
    ),
  }),
];

export function SupplierFollowUpPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Supplier follow-up" subtitle="Due check-ins, late or unknown arrivals, and PO reviews, one row per PO."
        info="An overdue check-in means follow up; it does not by itself mean material is late. Recording a later date keeps the conflict visible; production start is never changed." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.supplier_follow_up} columns={columns} getRowId={(r) => r.po_id}
          filterPlaceholder="Filter by PO, supplier, or work order" empty="No supplier follow-up needed." />}
      </QueryView>
    </div>
  );
}
