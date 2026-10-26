import { createColumnHelper } from "@tanstack/react-table";

import { usePurchasingQueue } from "@/api/hooks";
import type { Replenishment } from "@/api/types";
import { PurchaseDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";

const col = createColumnHelper<Replenishment>();

const columns = [
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor((r) => r.warehouse.code, { id: "site", header: "Site" }),
  col.accessor("free_on_hand", { header: "Free stock", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  col.accessor("incoming_unallocated", { header: "Unallocated on order", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  col.accessor("projected", { header: "Projected", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("reorder_point", { header: "Reorder at", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("target_level", { header: "Target", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("suggested_qty", { header: "Suggested", ...right, cell: (c) => <Num v={c.getValue()} tone="amber" /> }),
  col.accessor("lead_time_days", { header: "Lead time", ...right, cell: (c) => (c.getValue() ? `${c.getValue()}d` : "·") }),
  col.accessor("next_incoming", {
    header: "Next incoming",
    cell: (c) => {
      const r = c.row.original;
      if (!r.incoming_unallocated) return <span className="text-zinc-300">·</span>;
      return (
        <span className="whitespace-nowrap">
          {fmtDate(c.getValue())}
          {r.free_on_hand < r.reorder_point && <Badge tone="amber" className="ml-1" title="Future supply may not prevent an earlier shortage">timing</Badge>}
        </span>
      );
    },
  }),
  col.accessor("policy_source", { header: "Policy", cell: (c) => <span className="text-xs text-zinc-500">{c.getValue()}</span> }),
  col.display({
    id: "act", header: "",
    cell: (c) => {
      const r = c.row.original;
      return (
        <PurchaseDialog partId={r.part_id} partNumber={r.part_number} destination={r.warehouse} demand={[]}
          defaultGeneralStock={r.suggested_qty} trigger={<Button size="sm" variant="outline">Buy {r.suggested_qty}</Button>} />
      );
    },
  }),
];

export function ReplenishmentPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Replenishment" subtitle="General stock below its reorder point."
        info="Projected = free accepted stock + unallocated incoming supply at the site. Suggestions only; nothing is ordered automatically." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.replenishment} columns={columns} getRowId={(r) => `${r.part_id}-${r.warehouse.id}`}
          empty="All stock is above its reorder point." />}
      </QueryView>
    </div>
  );
}
