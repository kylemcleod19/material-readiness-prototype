import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { PurchasingQueue, SourceLine } from "@/api/types";
import { UpdateArrivalDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate, TimingBadge } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/utils";

type Row = Omit<PurchasingQueue["timing_conflicts"][number], "sources"> & { source: SourceLine };
const col = createColumnHelper<Row>();

const columns = [
  col.accessor("work_order_number", {
    header: "Work order",
    cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor("production_start_date", { header: "Start", cell: (c) => <StartDate date={c.getValue()} /> }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Supplier" }),
  col.accessor((r) => r.source.label, {
    id: "source", header: "Source",
    cell: (c) => c.row.original.source.po_id
      ? <Link className="text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.source.po_id}`}>{c.getValue()}</Link>
      : c.getValue(),
  }),
  col.accessor((r) => r.source.qty, { id: "qty", header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor((r) => r.source.expected_arrival, {
    id: "eta", header: "Expected",
    cell: (c) => c.getValue() ? fmtDate(c.getValue()) : <span className="text-xs text-zinc-500">{c.row.original.source.detail ? "multiple" : "unknown"}</span>,
  }),
  col.accessor((r) => r.source.timing, { id: "timing", header: "Timing", cell: (c) => <TimingBadge timing={c.getValue()} /> }),
  col.accessor((r) => r.source.late_qty, { id: "late", header: "Late qty", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  col.display({
    id: "act", header: "",
    cell: (c) => c.row.original.source.po_id ? (
      <UpdateArrivalDialog poId={c.row.original.source.po_id} trigger={<Button size="sm" variant="outline">Update arrival</Button>} />
    ) : null,
  }),
];

export function TimingPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Arrival conflicts" subtitle="Incoming supply expected after production start, or with no date."
        info="Production start is never moved, so the conflict stays visible. Arrival on or before start means no known conflict, not a guarantee that receiving, QA and staging finish in time." />
      <QueryView q={q}>
        {(d) => {
          const rows: Row[] = d.timing_conflicts.flatMap(({ sources, ...t }) => sources.map((source) => ({ ...t, source })));
          return <DataTable data={rows} columns={columns} getRowId={(r) => r.source.allocation_id} empty="No known arrival conflicts."
            initialSort={[{ id: "production_start_date", desc: false }]} />;
        }}
      </QueryView>
    </div>
  );
}
