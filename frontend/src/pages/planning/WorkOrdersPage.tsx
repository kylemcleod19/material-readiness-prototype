import { createColumnHelper } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useWorkOrders } from "@/api/hooks";
import type { WorkOrderSummary } from "@/api/types";
import { DataTable } from "@/components/DataTable";
import { OutlookBadge, PageHeader, QueryView, StartDate } from "@/components/domain";
import { actionLabel, NextActionButton } from "@/components/NextAction";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const col = createColumnHelper<WorkOrderSummary>();
const OUTLOOK_ORDER = { action_needed: 0, at_risk: 1, on_track: 2, ready: 3, not_reserved: 4, canceled: 5 };

const columns = [
  col.accessor("number", { header: "Work order", cell: (c) => <Link to={`/work-orders/${c.row.original.id}`} className="font-medium text-blue-700 hover:underline">{c.getValue()}</Link> }),
  col.accessor("title", { header: "Title", cell: (c) => <span className="text-zinc-600">{c.getValue()}</span> }),
  col.accessor("program", { header: "Program" }),
  col.accessor((r) => r.warehouse.name, { id: "site", header: "Site" }),
  col.accessor("production_start_date", { id: "start", header: "Production start", cell: (c) => <StartDate date={c.getValue()} days={c.row.original.days_to_start} /> }),
  col.accessor((r) => OUTLOOK_ORDER[r.outlook], {
    id: "outlook", header: "Outlook",
    cell: (c) => <span title={c.row.original.headline}><OutlookBadge outlook={c.row.original.outlook} /></span>,
  }),
  col.accessor((r) => r.kit.staged, {
    id: "kit", header: "Parts staged",
    cell: (c) => <span className="tabular whitespace-nowrap">{c.row.original.kit.staged} of {c.row.original.kit.lines}</span>,
  }),
  col.display({
    id: "next", header: "Next action",
    cell: (c) => {
      const w = c.row.original;
      const [first, ...rest] = w.next_actions;
      if (!first) return <span className="text-zinc-400">{w.outlook === "on_track" ? "Waiting on arrivals" : "—"}</span>;
      return (
        <span className="text-sm">
          {actionLabel(first)}
          {rest.length > 0 && <span className="ml-1 text-xs text-zinc-500">+{rest.length} more</span>}
        </span>
      );
    },
  }),
  col.display({
    id: "act", header: "",
    cell: (c) => {
      const w = c.row.original;
      const first = w.next_actions[0];
      if (!first) return null;
      return <NextActionButton action={first}
        ctx={{ woId: w.id, woNumber: w.number, warehouse: w.warehouse, start: w.production_start_date }} />;
    },
  }),
];

export function WorkOrdersPage() {
  const q = useWorkOrders();
  const [filter, setFilter] = useState("finalized");
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Work orders" subtitle="Can each build start on time, and what has to happen first?"
        info="Ready: every part staged. On track: everything available or arriving before production start. At risk: a late or unknown arrival, a transfer decision, or an unconfirmed fixture. Action needed: material is short or a shortage decision is open."
        actions={<Button asChild size="sm"><Link to="/work-orders/new"><Plus />New draft</Link></Button>} />
      <QueryView q={q}>
        {(rows) => (
          <DataTable data={filter === "all" ? rows : rows.filter((r) => r.state === filter)} columns={columns}
            getRowId={(r) => r.id} initialSort={[{ id: "outlook", desc: false }]} filterPlaceholder="Filter work orders"
            onRowClick={(r) => navigate(`/work-orders/${r.id}`)} empty="No work orders in this view."
            toolbar={
              <Tabs value={filter} onValueChange={setFilter}>
                <TabsList>
                  {["finalized", "draft", "canceled", "all"].map((f) => (
                    <TabsTrigger key={f} value={f}>
                      {f[0].toUpperCase() + f.slice(1)}
                      <span className="text-xs text-zinc-400">{f === "all" ? rows.length : rows.filter((r) => r.state === f).length}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            } />
        )}
      </QueryView>
    </div>
  );
}
