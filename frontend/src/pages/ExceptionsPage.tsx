import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useExceptions } from "@/api/hooks";
import type { MaterialException } from "@/api/types";
import { ExceptionActions } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, WoChips } from "@/components/domain";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime } from "@/lib/utils";

const col = createColumnHelper<MaterialException>();

const columns = [
  col.accessor("label", {
    header: "Issue",
    cell: (c) => <span className={c.row.original.state === "closed" ? "text-zinc-500" : "font-medium"}>{c.getValue()}</span>,
  }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue() ?? "·"}</span> }),
  col.accessor("affected_qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor("title", { header: "Summary", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
  col.display({
    id: "links", header: "Work orders",
    cell: (c) => <WoChips items={c.row.original.links.map((l) => ({ id: l.work_order_id, number: l.work_order_number, extra: l.claimed_qty ?? undefined }))} />,
  }),
  col.accessor("state", { header: "Review", cell: (c) => <span className="text-xs">{c.getValue() === "closed" ? "Closed" : "Open"}</span> }),
  col.accessor("created_at", { header: "Raised", cell: (c) => <span className="whitespace-nowrap text-xs">{fmtDateTime(c.getValue())}</span> }),
  col.display({ id: "act", header: "", cell: (c) => <div className="flex justify-end"><ExceptionActions exc={c.row.original} /></div> }),
];

/** Secondary register of short deliveries, QA rejections, and other issues (PRD 4.17). */
export function ExceptionsPage() {
  const [closed, setClosed] = useState(false);
  const [params, setParams] = useSearchParams();
  const only = params.get("id");
  const q = useExceptions(closed || !!only);
  return (
    <div>
      <PageHeader title="Issues" subtitle="Short deliveries, QA rejections, and warehouse discrepancies, with their history."
        info="The operational decision for an issue lives in its queue (Allocate material, Source material, Supplier follow-up). Closing a review here does not create stock, reverse scrap, or remove a shortage." />
      <QueryView q={q}>
        {(rows) => (
          <DataTable data={only ? rows.filter((r) => r.id === only) : rows} columns={columns} getRowId={(r) => r.id}
            filterPlaceholder="Filter issues" empty="No issues." defaultExpanded={() => !!only}
            renderSubRow={(e) => (
              <div className="space-y-1 text-xs text-zinc-700">
                {e.detail && <div>{e.detail}</div>}
                <div className="text-zinc-500">Raised by {e.raised_by}</div>
                {e.resolution_note && <div className="whitespace-pre-line text-zinc-500">Notes: {e.resolution_note}</div>}
              </div>
            )}
            toolbar={only ? (
              <button className="text-sm text-blue-700 hover:underline" onClick={() => setParams({})}>Show all issues</button>
            ) : (
              <Tabs value={closed ? "all" : "open"} onValueChange={(v) => setClosed(v === "all")}>
                <TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="all">Include closed</TabsTrigger></TabsList>
              </Tabs>
            )} />
        )}
      </QueryView>
    </div>
  );
}
