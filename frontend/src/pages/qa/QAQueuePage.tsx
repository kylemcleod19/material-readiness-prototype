import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { useQAQueue } from "@/api/hooks";
import type { QAPending } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { MobileRow } from "@/pages/warehouse/shared";

const col = createColumnHelper<QAPending>();
const inspect = (b: QAPending, size: "sm" | "lg" = "sm") => <Button asChild size={size}><Link to={`/qa/${b.qa_batch_id}`}>Inspect</Link></Button>;

const columns = [
  col.accessor("earliest_start", { header: "Earliest start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()!} /> : <span className="text-zinc-300">·</span>) }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("input_qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("label", { header: "PO line" }),
  col.accessor("lot", { header: "Lot", cell: (c) => c.getValue() ?? <span className="text-zinc-300">·</span> }),
  col.accessor((r) => r.warehouse.code, { id: "site", header: "Site" }),
  col.display({ id: "for", header: "For", cell: (c) => <span className="text-xs">{c.row.original.demand.map((x) => x.work_order_number).join(", ") || "general stock"}</span> }),
  col.accessor("created_at", { header: "Received", cell: (c) => <span className="whitespace-nowrap text-xs">{fmtDateTime(c.getValue())}</span> }),
  col.display({ id: "act", header: "", cell: (c) => inspect(c.row.original) }),
];

export function QAQueuePage() {
  const q = useQAQueue();
  return (
    <div>
      <PageHeader title="QA queue" subtitle="Received material awaiting an accepted/rejected count."
        info="Material in QA is not available yet. Accepted units become available; rejected units are scrapped and raise a purchasing exception." />
      <QueryView q={q}>
        {(rows) => (
          <DataTable data={rows} columns={columns} getRowId={(r) => r.qa_batch_id} empty="Nothing waiting for QA."
            mobileCard={(b) => <MobileRow title={`${b.input_qty} ${b.part_number}`} meta={`${b.label}${b.earliest_start ? ` · start ${fmtDate(b.earliest_start)}` : ""}`} action={inspect(b, "lg")} />} />
        )}
      </QueryView>
    </div>
  );
}
