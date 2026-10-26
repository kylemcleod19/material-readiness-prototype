import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { CheckIn } from "@/api/types";
import { CompleteCheckInDialog } from "@/components/actions";
import { DataTable } from "@/components/DataTable";
import { PageHeader, QueryView } from "@/components/domain";
import { Badge } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";

const col = createColumnHelper<CheckIn>();
const STATUS_ORDER = { overdue: 0, due: 1, upcoming: 2 };

const columns = [
  col.accessor("due_date", { header: "Due", cell: (c) => <span className="font-medium tabular">{fmtDate(c.getValue())}</span> }),
  col.accessor((r) => STATUS_ORDER[r.status], {
    id: "status", header: "Status",
    cell: (c) => {
      const s = c.row.original.status;
      return <Badge tone={s === "overdue" ? "red" : s === "due" ? "amber" : "neutral"}>{s}</Badge>;
    },
  }),
  col.accessor("po_number", {
    header: "PO",
    cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.po_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor("supplier", { header: "Supplier" }),
  col.accessor((r) => r.expected_arrivals.join(), {
    id: "eta", header: "Expected arrival",
    cell: (c) => <span className="tabular">{c.row.original.expected_arrivals.map((e) => fmtDate(e)).join(", ") || "unknown"}</span>,
  }),
  col.accessor("owner", { header: "Owner", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
  col.accessor("note", { header: "Note", cell: (c) => <span className="text-xs text-zinc-600">{c.getValue()}</span> }),
  col.display({
    id: "act", header: "",
    cell: (c) => <CompleteCheckInDialog taskId={c.row.original.id} poId={c.row.original.po_id} poNumber={c.row.original.po_number} />,
  }),
];

export function CheckInsPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="PO check-ins" subtitle="Scheduled supplier follow-ups."
        info="A check-in date is separate from the expected arrival. Overdue means follow up — it does not by itself mean the material is late. Recording a later arrival flags linked work orders." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.checkins} columns={columns} getRowId={(r) => r.id} empty="No open check-ins."
          initialSort={[{ id: "status", desc: false }]} />}
      </QueryView>
    </div>
  );
}
