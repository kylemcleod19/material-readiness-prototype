import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { useAction, usePurchasingQueue } from "@/api/hooks";
import type { PurchasingQueue } from "@/api/types";
import { PromptDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";

type Handoff = PurchasingQueue["handoffs"][number];
type Row = Handoff["claims"][number] & { line: Handoff };
const col = createColumnHelper<Row>();

function HandoffAction({ r }: { r: Row }) {
  const max = Math.min(r.qty, r.line.accepted_waiting);
  const handoff = useAction<{ qty: number }>(`/allocations/${r.allocation_id}/handoff`, { success: "Handed off to inventory" });
  return (
    <PromptDialog title={`Give available units to ${r.work_order_number}`} label={`Quantity (max ${max})`} inputType="number"
      initial={String(max)} confirm="Hand off" description="The rest of the claim stays on incoming supply."
      trigger={<Button size="sm" variant="outline">Hand off</Button>}
      onSubmit={(v, close) => handoff.mutate({ qty: Number(v) }, { onSuccess: close })} />
  );
}

const columns = [
  col.accessor((r) => r.line.label, {
    id: "line", header: "PO line",
    cell: (c) => <Link className="text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.line.po_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor((r) => r.line.part_number, { id: "part", header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor((r) => r.line.accepted_waiting, { id: "waiting", header: "Available, not yet assigned", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  col.accessor("work_order_number", {
    header: "Allocated to",
    cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor("production_start_date", { header: "Start", cell: (c) => <StartDate date={c.getValue()} /> }),
  col.accessor("qty", { header: "Allocated", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.display({ id: "act", header: "", cell: (c) => <HandoffAction r={c.row.original} /> }),
];

export function HandoffsPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Receipt handoffs" subtitle="Part of a delivery is available. Choose which work order gets it."
        info="Material still on order covers every allocation, so no order is short. Choosing which order gets the available units first is a priority decision, so it is made by hand." />
      <QueryView q={q}>
        {(d) => {
          const rows: Row[] = d.handoffs.flatMap((line) => line.claims.map((c) => ({ ...c, line })));
          return <DataTable data={rows} columns={columns} getRowId={(r) => r.allocation_id} empty="No available units waiting for a decision." />;
        }}
      </QueryView>
    </div>
  );
}
