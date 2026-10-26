import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { useParts } from "@/api/hooks";
import type { PartRequirement, PartView } from "@/api/types";
import { PurchaseDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { CoverageText, PageHeader, QueryView, ReqStatus, StartDate } from "@/components/domain";
import { NextActionButton } from "@/components/NextAction";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";

const VERDICT: Record<PartView["verdict"], { tone: Tone; label: (p: PartView) => string }> = {
  short: { tone: "red", label: (p) => `No — short ${p.gap}` },
  assign_existing: { tone: "amber", label: (p) => `Yes, if ${p.gap} unassigned supply is assigned` },
  at_risk: { tone: "amber", label: () => "Covered, but timing at risk" },
  covered: { tone: "green", label: () => "Yes" },
  no_demand: { tone: "neutral", label: () => "No open demand" },
};

const col = createColumnHelper<PartView>();
const columns = [
  col.accessor("part_number", {
    header: "Part",
    cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
  }),
  col.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Supplier" }),
  col.accessor("lead_time_days", { header: "Lead time", ...right, cell: (c) => (c.getValue() ? `${c.getValue()}d` : "·") }),
  col.accessor("orders", { header: "Work orders", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("needed", { header: "Needed", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("covered", { header: "Covered", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("gap", { header: "Gap", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  col.accessor("verdict", {
    header: "Can we meet it?",
    cell: (c) => { const v = VERDICT[c.getValue()]; return <Badge tone={v.tone}>{v.label(c.row.original)}</Badge>; },
  }),
  col.display({
    id: "act", header: "",
    cell: (c) => {
      const p = c.row.original;
      return (
        <div className="flex justify-end gap-2">
          {p.purchases.map((g) => (
            <PurchaseDialog key={g.destination.id} partId={p.id} partNumber={p.part_number} destination={g.destination}
              demand={g.demand} defaultSupplierId={p.supplier?.id}
              trigger={<Button size="sm">Buy {g.short} → {g.destination.code}{g.demand.length > 1 ? ` (${g.demand.length} orders)` : ""}</Button>} />
          ))}
        </div>
      );
    },
  }),
];

function Requirements({ p }: { p: PartView }) {
  const rcol = createColumnHelper<PartRequirement>();
  const rcolumns = [
    rcol.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
    rcol.accessor((r) => r.warehouse.name, { id: "site", header: "Site" }),
    rcol.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
    rcol.accessor("required", { header: "Needed", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    rcol.accessor("state", { header: "Status", cell: (c) => <ReqStatus state={c.getValue()} short={c.row.original.short} expected={c.row.original.expected} /> }),
    rcol.display({
      id: "how", header: "Covered by",
      cell: (c) => {
        const r = c.row.original;
        return (
          <div className="space-y-0.5">
            <CoverageText available={r.from_stock} onOrder={r.on_order} otherSite={r.at_other_site} decision={r.decision_needed} short={r.short} />
            <div className="text-xs text-zinc-500">
              {r.sources.map((s) => `${s.qty} ${s.label}${s.expected_arrival ? ` (${fmtDate(s.expected_arrival)})` : ""}`).join(" · ")}
            </div>
          </div>
        );
      },
    }),
    rcol.display({
      id: "act", header: "Next action",
      cell: (c) => {
        const r = c.row.original;
        if (!r.action) return null;
        return <NextActionButton action={{ ...r.action, item_id: r.work_order_item_id, part_id: p.id, part_number: p.part_number, supplier: p.supplier }}
          ctx={{ woId: r.work_order_id, woNumber: r.work_order_number, warehouse: r.warehouse, start: r.production_start_date, required: r.required }} />;
      },
    }),
  ];
  return (
    <div className="overflow-hidden rounded-md border bg-white">
      <DataTable bare data={p.requirements} columns={rcolumns} getRowId={(r) => r.work_order_item_id} empty="No finalized work orders need this part." />
      {p.free_stock > 0 && <div className="border-t px-3 py-2 text-xs text-zinc-500">{p.free_stock} in stock not assigned to any work order.</div>}
    </div>
  );
}

export function PartsPage() {
  const q = useParts();
  return (
    <div>
      <PageHeader title="By part" subtitle="Can current stock and open orders meet every work order's requirement?"
        info="Needed is the total for finalized work orders. Covered is what is already staged, available, on order, or held at another site for them. Gap includes short requirements and any material shortage on a shared PO line." />
      <QueryView q={q}>
        {(parts) => <DataTable data={parts} columns={columns} getRowId={(r) => r.id} filterPlaceholder="Filter parts or suppliers"
          renderSubRow={(p) => <Requirements p={p} />} defaultExpanded={(p) => p.verdict !== "covered" && p.verdict !== "no_demand"} />}
      </QueryView>
    </div>
  );
}
