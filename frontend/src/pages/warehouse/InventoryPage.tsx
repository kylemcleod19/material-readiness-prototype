import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";

import { useInventory } from "@/api/hooks";
import type { InventoryRollup, InventoryView } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView } from "@/components/domain";
import { Badge } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const scol = createColumnHelper<InventoryRollup>();
const summaryColumns = [
  scol.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  scol.accessor((r) => r.warehouse.name, { id: "site", header: "Site" }),
  scol.accessor("available", { header: "Available", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  scol.accessor("allocated", { header: "Allocated to work orders", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  scol.accessor("held_for_other_site", { header: "Held for another site", ...right, cell: (c) => <Num v={c.getValue()} tone="violet" /> }),
  scol.accessor("free", { header: "Unallocated", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  scol.accessor("staged", { header: "Staged", ...right, cell: (c) => <Num v={c.getValue()} tone="dark" /> }),
  scol.accessor("in_qa", { header: "In QA (not available)", ...right, cell: (c) => <Num v={c.getValue()} tone="amber" /> }),
  scol.accessor("in_transfer", { header: "Leaving by transfer", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  scol.accessor("awaiting_handoff", { header: "Awaiting handoff", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
];

type Rec = InventoryView["records"][number];
const rcol = createColumnHelper<Rec>();
const recordColumns = [
  rcol.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  rcol.accessor((r) => r.warehouse.code, { id: "site", header: "Site" }),
  rcol.accessor("location", { header: "Location", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
  rcol.accessor("lot", { header: "Lot", cell: (c) => c.getValue() ?? <span className="text-zinc-300">·</span> }),
  rcol.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  rcol.accessor("status", {
    header: "Status",
    cell: (c) => <Badge tone={c.getValue() === "available" ? "green" : "amber"}>{c.getValue() === "available" ? "Available" : "In QA"}</Badge>,
  }),
  rcol.accessor("stage", { header: "Stage", cell: (c) => <Badge>{c.getValue()}</Badge> }),
  rcol.accessor("origin", { header: "Origin", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
  rcol.display({
    id: "alloc", header: "Allocated to",
    cell: (c) => {
      const r = c.row.original;
      if (r.pooled_for) return <Badge tone="blue">backing {r.pooled_for}</Badge>;
      if (r.reserved_for_transfer) return <Badge tone="violet">reserved for transfer</Badge>;
      return <span className="text-xs">{r.allocations.map((a) => `${a.work_order_number} ${a.qty}${a.state === "remote_hold" ? " (hold)" : ""}${a.review ? " (review)" : ""}`).join(", ") || "·"}</span>;
    },
  }),
];

export function InventoryPage() {
  const q = useInventory();
  const [tab, setTab] = useState("summary");
  const tabs = (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList><TabsTrigger value="summary">By part & site</TabsTrigger><TabsTrigger value="records">Records</TabsTrigger></TabsList>
    </Tabs>
  );
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock by site: what is available, allocated, and staged."
        info="Balances are summaries of individual records, never separately stored. Staged is part of available, not added to it. Scrapped material is not inventory." />
      <QueryView q={q}>
        {(d) => tab === "summary"
          ? <DataTable data={d.summary} columns={summaryColumns} getRowId={(r) => `${r.part_id}-${r.warehouse.id}`} filterPlaceholder="Filter parts" toolbar={tabs} />
          : <DataTable data={d.records} columns={recordColumns} getRowId={(r) => r.id} filterPlaceholder="Filter records" toolbar={tabs} />}
      </QueryView>
    </div>
  );
}
