import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { usePurchaseOrders } from "@/api/hooks";
import type { PurchaseOrder } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView } from "@/components/domain";
import { Badge } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate } from "@/lib/utils";

const col = createColumnHelper<PurchaseOrder>();
const total = (po: PurchaseOrder, k: "ordered" | "received" | "claims" | "unallocated" | "deficit" | "outstanding") =>
  po.lines.reduce((a, l) => a + l[k], 0);

function nextEta(po: PurchaseOrder): string | null {
  const dates = po.lines.flatMap((l) => [
    ...l.shipments.filter((s) => s.open_qty > 0).map((s) => s.expected_arrival),
    ...(l.unshipped > 0 ? [l.expected_arrival] : []),
  ]).filter(Boolean) as string[];
  return dates.sort()[0] ?? null;
}

const columns = [
  col.accessor("number", { header: "PO", cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.id}`}>{c.getValue()}</Link> }),
  col.accessor((r) => r.supplier.name, { id: "supplier", header: "Supplier" }),
  col.accessor((r) => r.destination.code, { id: "to", header: "To" }),
  col.accessor((r) => r.lines.map((l) => l.part_number).join(", "), { id: "parts", header: "Parts" }),
  col.accessor((r) => total(r, "ordered"), { id: "ordered", header: "Ordered", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor((r) => total(r, "received"), { id: "received", header: "Received", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor((r) => total(r, "outstanding"), { id: "outstanding", header: "Not received", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  col.accessor((r) => total(r, "claims"), { id: "claims", header: "Allocated", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.accessor((r) => total(r, "unallocated"), { id: "free", header: "Unallocated", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  col.accessor((r) => total(r, "deficit"), { id: "short", header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  col.accessor((r) => nextEta(r) ?? "", { id: "eta", header: "Next arrival", cell: (c) => (c.getValue() ? fmtDate(c.getValue()) : "·") }),
  col.accessor((r) => r.next_checkin?.due_date ?? "", {
    id: "checkin", header: "Next check-in",
    cell: (c) => {
      const ck = c.row.original.next_checkin;
      if (!ck) return <span className="text-zinc-300">·</span>;
      return <Badge tone={ck.status === "overdue" ? "red" : ck.status === "due" ? "amber" : "neutral"}>{fmtDate(ck.due_date)} · {ck.status}</Badge>;
    },
  }),
  col.accessor("needs_review", { header: "Review", cell: (c) => (c.getValue() ? <Badge tone="amber">needs review</Badge> : null) }),
];

export function PurchaseOrdersPage() {
  const q = usePurchaseOrders();
  const [tab, setTab] = useState("all");
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Purchase orders" subtitle="Supplier commitments and the demand they support." />
      <QueryView q={q}>
        {(pos) => (
          <DataTable data={tab === "review" ? pos.filter((p) => p.needs_review) : pos} columns={columns} getRowId={(r) => r.id}
            filterPlaceholder="Filter by PO, supplier, part" onRowClick={(r) => navigate(`/purchasing/pos/${r.id}`)}
            empty={tab === "review" ? "No POs flagged for review." : "No purchase orders."}
            toolbar={
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="all">All <span className="text-xs text-zinc-400">{pos.length}</span></TabsTrigger>
                  <TabsTrigger value="review">Needs review <span className="text-xs text-zinc-400">{pos.filter((p) => p.needs_review).length}</span></TabsTrigger>
                </TabsList>
              </Tabs>
            } />
        )}
      </QueryView>
    </div>
  );
}
