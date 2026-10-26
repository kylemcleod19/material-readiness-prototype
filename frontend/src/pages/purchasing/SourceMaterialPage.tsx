import { createColumnHelper } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { SourceGroup, SourceReason, SourceRequirement } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate } from "@/components/domain";
import { SourceMaterialButton } from "@/components/ActionHost";
import { Select } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate } from "@/lib/utils";

const REASON: Record<SourceReason, string> = {
  short: "Short", stock_at_other_site: "Stock at another site", replenishment: "Replenishment",
};
const reasonText = (rs: SourceReason[]) => rs.map((r) => REASON[r]).join(" · ");

const sourceButton = (partId: string, warehouseId: string, itemIds?: string[]) => (
  <SourceMaterialButton partId={partId} warehouseId={warehouseId} itemIds={itemIds} />
);

// ------------------------------------------------------------------ by part number (default)

const gcol = createColumnHelper<SourceGroup>();
const byPart = [
  gcol.accessor("part_number", {
    header: "Part",
    cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
  }),
  gcol.accessor((r) => r.warehouse.name, { id: "site", header: "Destination" }),
  gcol.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Preferred supplier", cell: (c) => c.getValue() || <span className="text-zinc-400">Not selected</span> }),
  gcol.accessor((r) => reasonText(r.reasons), { id: "reasons", header: "Reason" }),
  gcol.accessor("to_source", { header: "To source", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  gcol.accessor((r) => r.requirements.length, { id: "orders", header: "Work orders", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  gcol.accessor((r) => r.earliest_start ?? "", { id: "start", header: "Earliest production start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()} /> : <span className="text-zinc-400">—</span>) }),
  gcol.display({ id: "act", header: "", cell: (c) => <div className="flex justify-end">{sourceButton(c.row.original.part_id, c.row.original.warehouse.id)}</div> }),
];

const rcol = createColumnHelper<SourceRequirement>();
function GroupDetail({ g }: { g: SourceGroup }) {
  const columns = [
    rcol.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
    rcol.accessor("work_order_title", { header: "Title", cell: (c) => <span className="text-zinc-600">{c.getValue()}</span> }),
    rcol.accessor("created_at", { header: "Created", cell: (c) => <span className="tabular">{fmtDate(c.getValue())}</span> }),
    rcol.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
    rcol.accessor("short", { header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
    rcol.accessor("at_other_site", { header: "Stock at another site", ...right, cell: (c) => <Num v={c.getValue()} tone="violet" /> }),
  ];
  return (
    <div className="space-y-2">
      {g.requirements.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-white">
          <DataTable bare data={g.requirements} columns={columns} getRowId={(r) => r.work_order_item_id} />
        </div>
      )}
      <div className="text-xs text-zinc-500 tabular">
        {g.available_to_allocate} available to allocate · {g.unallocated_on_order} unallocated on order at {g.warehouse.code}
        {g.replenishment > 0 && <> · replenishment suggests {g.replenishment} for general stock</>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ by work order

const byWorkOrder = [
  rcol.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
  rcol.accessor("created_at", { header: "Created", cell: (c) => <span className="tabular whitespace-nowrap">{fmtDate(c.getValue())}</span> }),
  rcol.accessor((r) => r.warehouse.name, { id: "site", header: "Site" }),
  rcol.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
  rcol.accessor("part_number", {
    header: "Part",
    cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
  }),
  rcol.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Preferred supplier", cell: (c) => c.getValue() || <span className="text-zinc-400">Not selected</span> }),
  rcol.accessor("short", { header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  rcol.accessor("at_other_site", { header: "Stock at another site", ...right, cell: (c) => <Num v={c.getValue()} tone="violet" /> }),
  rcol.display({ id: "act", header: "", cell: (c) => <div className="flex justify-end">{sourceButton(c.row.original.part_id, c.row.original.warehouse.id, [c.row.original.work_order_item_id])}</div> }),
];

// ------------------------------------------------------------------ page

export function SourceMaterialPage() {
  const q = usePurchasingQueue();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "work_order" ? "work_order" : "part";
  const reason = (params.get("reason") ?? "all") as SourceReason | "all";
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const toolbar = (
    <>
      <Select className="h-9 w-48" value={reason} onChange={(e) => setParam("reason", e.target.value === "all" ? null : e.target.value)} aria-label="Reason">
        <option value="all">All reasons</option>
        <option value="short">Short</option>
        <option value="stock_at_other_site">Stock at another site</option>
        <option value="replenishment">Replenishment</option>
      </Select>
      <Tabs value={view} onValueChange={(v) => setParam("view", v === "part" ? null : v)}>
        <TabsList>
          <TabsTrigger value="part">By part number</TabsTrigger>
          <TabsTrigger value="work_order">By work order</TabsTrigger>
        </TabsList>
      </Tabs>
    </>
  );
  return (
    <div>
      <PageHeader title="Source material" subtitle="Requirements without supply, stock at another site, and replenishment."
        info="Source material brings together available-to-allocate stock, unallocated on-order supply, stock at another site, and a purchase. Each work order keeps its own quantity and production start; nothing changes until you confirm." />
      <QueryView q={q}>
        {(d) => {
          const groups = d.source_material.groups.filter((g) => reason === "all" || g.reasons.includes(reason));
          const reqs = d.source_material.requirements.filter((r) => reason === "all" || r.reasons.includes(reason as SourceReason));
          return view === "part" ? (
            <DataTable key="part" data={groups} columns={byPart} getRowId={(r) => `${r.part_id}-${r.warehouse.id}`} toolbar={toolbar}
              filterPlaceholder="Filter by part, site, or supplier" empty="Nothing to source." renderSubRow={(g) => <GroupDetail g={g} />} />
          ) : (
            <DataTable key="wo" data={reqs} columns={byWorkOrder} getRowId={(r) => r.work_order_item_id} toolbar={toolbar}
              filterPlaceholder="Filter by work order, part, or supplier"
              empty={reason === "replenishment" ? "Replenishment has no work order; use By part number." : "Nothing to source."} />
          );
        }}
      </QueryView>
    </div>
  );
}
