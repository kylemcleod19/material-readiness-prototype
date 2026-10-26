import { createColumnHelper } from "@tanstack/react-table";
import { GitCompareArrows } from "lucide-react";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { AllocationDecision } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate, WoChips } from "@/components/domain";
import { NextActionButton } from "@/components/NextAction";
import { Button } from "@/components/ui/button";

const col = createColumnHelper<AllocationDecision>();
const columns = [
  col.accessor("part_number", {
    header: "Part",
    cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
  }),
  col.accessor((r) => (r.kind === "shortage" ? `Short ${r.short}` : `${r.available} received to assign`), {
    id: "decision", header: "Decision",
    cell: (c) => <span className={c.row.original.kind === "shortage" ? "text-red-700" : "text-amber-700"}>{c.getValue()}</span>,
  }),
  col.accessor((r) => r.issues.map((i) => i.title).join("; "), { id: "issue", header: "Issue", cell: (c) => <span className="text-xs text-zinc-600">{c.getValue() || "—"}</span> }),
  col.accessor("label", { header: "PO line", cell: (c) => <Link className="whitespace-nowrap text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.po_id}`}>{c.getValue()}</Link> }),
  col.accessor("supplier", { header: "Supplier" }),
  col.accessor("warehouse", { header: "Site" }),
  col.accessor("allocated", { header: "Allocated", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("available", { header: "Available", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  col.accessor((r) => r.in_qa + r.not_received, { id: "on_order", header: "On order", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  col.display({ id: "orders", header: "Work orders (allocated)", cell: (c) => <WoChips items={c.row.original.affected.map((a) => ({ id: a.work_order_id, number: a.work_order_number, extra: a.allocated_qty }))} /> }),
  col.accessor((r) => r.earliest_start ?? "", { id: "start", header: "Earliest start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()} /> : null) }),
  col.display({
    id: "act", header: "",
    cell: (c) => {
      const d = c.row.original;
      return d.draft_scenario_id ? (
        <Button asChild size="sm" variant="outline"><Link to={`/scenarios/${d.draft_scenario_id}`}><GitCompareArrows />Continue</Link></Button>
      ) : <NextActionButton action={{ kind: "allocate_material", po_line_id: d.po_line_id }} />;
    },
  }),
];

/** Shared shortages and received material that competing work orders depend on (PRD 4.10, 4.17). */
export function AllocateMaterialPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Allocate material" subtitle="Decide which work orders get scarce or newly received material."
        info="A shortage means allocations exceed what the supply can now deliver; the deficit is shown once here, not against each order. Received material means part of a delivery is available and several orders could take it. Program management chooses; nothing is applied automatically." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.allocate_material} columns={columns} getRowId={(r) => r.po_line_id} empty="No allocation decisions waiting." />}
      </QueryView>
    </div>
  );
}
