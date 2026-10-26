import { createColumnHelper } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import type { PickTask, WarehouseQueue } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";
import { MobileRow, WarehouseScreen } from "./shared";

function PickAction({ t, size = "sm" }: { t: PickTask; size?: "sm" | "lg" }) {
  if (t.blocked) return <Button size={size} disabled><Lock />Pick</Button>;
  return <Button asChild size={size}><Link to={`/warehouse/pick/${t.allocation_id}`}>Pick</Link></Button>;
}

const col = createColumnHelper<PickTask>();
export const taskColumns = [
  col.accessor("production_start_date", { id: "start", header: "Start", cell: (c) => <StartDate date={c.getValue()} days={c.row.original.days_to_start} /> }),
  col.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("location", { header: "From", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
  col.accessor("lot", { header: "Lot", cell: (c) => c.getValue() ?? <span className="text-zinc-300">·</span> }),
  col.accessor("blocked", { header: "Status", cell: (c) => (c.getValue() ? <Badge tone="amber"><Lock />decision needed</Badge> : <Badge tone="green">ready</Badge>) }),
];

export function PickListPage() {
  return (
    <WarehouseScreen title="Pick" subtitle="Committed, accepted material to pick for kits."
      info="Only accepted material with a settled allocation can be picked. Material in QA or waiting on an allocation decision is blocked.">
      {(d) => (
        <PickTable d={d} />
      )}
    </WarehouseScreen>
  );
}

function PickTable({ d }: { d: WarehouseQueue }) {
  // Opened from a work order: show only that order's pick tasks, with a way back to the full list.
  const [params, setParams] = useSearchParams();
  const wo = params.get("wo");
  const picks = wo ? d.picks.filter((p) => p.work_order_id === wo) : d.picks;
  return (
        <DataTable data={picks} getRowId={(r) => r.allocation_id} initialSort={[{ id: "start", desc: false }]} empty={wo ? "No pick tasks for this work order." : "No pick tasks."}
          toolbar={wo ? <button className="text-sm text-blue-700 hover:underline" onClick={() => setParams({})}>Showing {picks[0]?.work_order_number ?? "one work order"} · show all</button> : undefined}
          columns={[...taskColumns, col.display({ id: "act", header: "", cell: (c) => <PickAction t={c.row.original} /> })]}
          mobileCard={(t) => <MobileRow title={`${t.qty} ${t.part_number}`} meta={`${t.work_order_number} · start ${fmtDate(t.production_start_date)} · ${t.location}`} action={<PickAction t={t} size="lg" />} />} />
  );
}
