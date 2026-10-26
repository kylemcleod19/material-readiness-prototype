import { createColumnHelper } from "@tanstack/react-table";

import { useAction } from "@/api/hooks";
import type { StockRow } from "@/api/types";
import { PromptDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { MobileRow, WarehouseScreen } from "./shared";

function PutawayAction({ r, size = "sm" }: { r: StockRow; size?: "sm" | "lg" }) {
  const put = useAction<{ location: string }>(`/inventory/${r.inventory_record_id}/putaway`, { success: "Put away" });
  return (
    <PromptDialog title={`Put away ${r.qty} ${r.part_number}`} label="Storage location" placeholder="A-02-04" confirm="Put away"
      trigger={<Button size={size} variant="outline">Put away</Button>}
      onSubmit={(location, close) => put.mutate({ location }, { onSuccess: close })} />
  );
}

const col = createColumnHelper<StockRow>();
const columns = [
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("description", { header: "Description", cell: (c) => <span className="text-zinc-600">{c.getValue()}</span> }),
  col.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("location", { header: "At", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
  col.accessor("lot", { header: "Lot", cell: (c) => c.getValue() ?? <span className="text-zinc-300">·</span> }),
  col.accessor("awaiting_handoff", { header: "Note", cell: (c) => (c.getValue() ? <Badge tone="blue">awaiting handoff</Badge> : null) }),
  col.display({ id: "act", header: "", cell: (c) => <PutawayAction r={c.row.original} /> }),
];

export function PutawayPage() {
  return (
    <WarehouseScreen title="Put away" subtitle="Accepted material still at the dock."
      info="Material already allocated to a kit can skip putaway and go straight to Pick.">
      {(d) => (
        <DataTable data={d.putaway} columns={columns} getRowId={(r) => r.inventory_record_id} empty="Dock is clear."
          mobileCard={(r) => <MobileRow title={`${r.qty} ${r.part_number}`} meta={`at ${r.location}`} action={<PutawayAction r={r} size="lg" />} />} />
      )}
    </WarehouseScreen>
  );
}
