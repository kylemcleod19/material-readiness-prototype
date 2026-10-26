import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";

import { useExceptions } from "@/api/hooks";
import type { MaterialException } from "@/api/types";
import { ExceptionActions } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, WoChips } from "@/components/domain";
import { Badge } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime, titleCase } from "@/lib/utils";

const col = createColumnHelper<MaterialException>();

const columns = [
  col.accessor("type", {
    header: "Type",
    cell: (c) => <Badge tone={c.row.original.state === "closed" ? "neutral" : c.row.original.blocking ? "red" : "amber"}>{titleCase(c.getValue())}</Badge>,
  }),
  col.accessor("state", { header: "State", cell: (c) => <Badge>{c.getValue()}</Badge> }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue() ?? "·"}</span> }),
  col.accessor("affected_qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("title", { header: "Summary", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
  col.display({
    id: "links", header: "Linked work orders",
    cell: (c) => <WoChips items={c.row.original.links.map((l) => ({ id: l.work_order_id, number: l.work_order_number, extra: l.claimed_qty ?? undefined }))} />,
  }),
  col.accessor("owner_role", { header: "Owner", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
  col.accessor("created_at", { header: "Raised", cell: (c) => <span className="whitespace-nowrap text-xs">{fmtDateTime(c.getValue())}</span> }),
  col.display({ id: "act", header: "", cell: (c) => <ExceptionActions exc={c.row.original} /> }),
];

export function ExceptionsPage() {
  const [closed, setClosed] = useState(false);
  const q = useExceptions(closed);
  return (
    <div>
      <PageHeader title="Exceptions" subtitle="Short receipts, QA rejections, and picking discrepancies."
        info="Closing records the follow-up. It does not create stock, clear a quality hold, or remove a shortage — those stay visible on the work order." />
      <QueryView q={q}>
        {(rows) => (
          <DataTable data={rows} columns={columns} getRowId={(r) => r.id} filterPlaceholder="Filter exceptions" empty="No exceptions."
            renderSubRow={(e) => (
              <div className="space-y-1 text-xs text-zinc-700">
                {e.detail && <div>{e.detail}</div>}
                <div className="text-zinc-500">Raised by {e.raised_by} · source {e.source_type}</div>
                {e.resolution_note && <div className="whitespace-pre-line text-zinc-500">Notes: {e.resolution_note}</div>}
              </div>
            )}
            toolbar={
              <Tabs value={closed ? "all" : "open"} onValueChange={(v) => setClosed(v === "all")}>
                <TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="all">Include closed</TabsTrigger></TabsList>
              </Tabs>
            } />
        )}
      </QueryView>
    </div>
  );
}
