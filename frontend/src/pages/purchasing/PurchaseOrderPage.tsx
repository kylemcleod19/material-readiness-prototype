import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAction, usePurchaseOrder } from "@/api/hooks";
import type { POLine, POShipment, PurchaseOrder } from "@/api/types";
import { DataTable, Num, right, SubTable } from "@/components/DataTable";
import { ArrivalInfo, FactList, PageHeader, QueryView, StartDate, TimingBadge } from "@/components/domain";
import { SupplierUpdateButton } from "@/components/ActionHost";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Field, Input, Table, TD, TH, TR } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export function PurchaseOrderPage() {
  const { id = "" } = useParams();
  const q = usePurchaseOrder(id);
  return <QueryView q={q}>{(po) => <PODetail po={po} />}</QueryView>;
}

function PODetail({ po }: { po: PurchaseOrder }) {
  const [showCheckins, setShowCheckins] = useState(false);
  const lcol = createColumnHelper<POLine>();
  const columns = [
    lcol.accessor("part_number", {
      header: "Part",
      cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
    }),
    lcol.accessor("ordered", { header: "Ordered", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    lcol.accessor("received", { header: "Received", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    lcol.accessor("next_arrival", {
      header: "Next arrival",
      cell: (c) => c.row.original.multiple_arrivals ? <span className="text-zinc-600">Multiple arrivals</span>
        : c.row.original.outstanding ? <span className="tabular">{fmtDate(c.getValue())}</span> : <span className="text-zinc-400">—</span>,
    }),
    lcol.accessor("issue", { header: "Issue", cell: (c) => c.getValue() ? <span className="text-amber-700">{c.getValue()}</span> : <span className="text-zinc-400">—</span> }),
    lcol.display({
      id: "act", header: "",
      cell: (c) => c.row.original.outstanding > 0 ? (
        <div className="flex justify-end">
          <SupplierUpdateButton variant="outline" poId={po.id} target={{ type: c.row.original.shipments.find((s) => s.open_qty > 0 && s.status !== "arrived") ? "shipment" : "po_line",
            id: c.row.original.shipments.find((s) => s.open_qty > 0 && s.status !== "arrived")?.shipment_id ?? c.row.original.id }} />
        </div>
      ) : null,
    }),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">{po.number}{po.needs_review && <Badge tone="amber">Needs review</Badge>}</span>}
        actions={<SupplierUpdateButton poId={po.id} />}
      />
      <FactList className="lg:grid-cols-5" facts={[
        ["Supplier", po.supplier.name],
        ["Destination", po.destination.name],
        ["Status", po.status],
        ["Buyer", po.buyer],
        ["Next check-in", po.next_checkin ? `${fmtDate(po.next_checkin.due_date)} (${po.next_checkin.status})` : "None"],
      ]} />
      {po.needs_review && <p className="text-sm text-amber-700">{po.review_note}</p>}

      <SubTable title="Lines">
        <DataTable bare data={po.lines} columns={columns} getRowId={(r) => r.id} renderSubRow={(l) => <LineDetail l={l} />} />
      </SubTable>

      {(po.checkins?.length ?? 0) > 0 && (
        <SubTable title="Check-ins and history" actions={<Button size="sm" variant="ghost" onClick={() => setShowCheckins(!showCheckins)}>{showCheckins ? "Hide" : "Show"}</Button>}>
          {showCheckins && (
            <Table>
              <thead><tr><TH>Due</TH><TH>Status</TH><TH>Note</TH><TH>Outcome</TH></tr></thead>
              <tbody>
                {po.checkins!.map((c) => (
                  <TR key={c.id}>
                    <TD className="tabular">{fmtDate(c.due_date)}</TD>
                    <TD>{c.status}</TD>
                    <TD className="text-xs">{c.note}</TD>
                    <TD className="text-xs text-zinc-600">{c.outcome}{c.completed_at && ` (${fmtDateTime(c.completed_at)})`}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </SubTable>
      )}
    </div>
  );
}

const BASIS: Record<string, string> = { supplier_promise: "supplier", carrier_estimate: "carrier", buyer_estimate: "buyer" };

const shcol = createColumnHelper<POShipment>();
const shipmentColumns = [
  shcol.accessor("number", { header: "Shipment", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  shcol.accessor("status", { header: "Status", cell: (c) => (c.getValue() === "arrived" ? "Awaiting receipt" : c.getValue() === "received" ? "Received" : "In transit") }),
  shcol.accessor("open_qty", { header: "Open", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  shcol.accessor("expected_arrival", { header: "Expected", cell: (c) => <ArrivalInfo compact date={c.getValue()} /> }),
  shcol.accessor("arrival_basis", { header: "Source", cell: (c) => <span className="text-xs">{c.getValue() ? BASIS[c.getValue()!] : "·"} · {c.row.original.arrival_channel} · {fmtDateTime(c.row.original.arrival_updated_at)}</span> }),
  shcol.accessor("tracking_number", { header: "Tracking", cell: (c) => <span className="text-xs">{c.row.original.carrier} {c.getValue()}</span> }),
];

type Alloc = POLine["allocations"][number];
const acol = createColumnHelper<Alloc>();
const allocColumns = [
  acol.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
  acol.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
  acol.accessor("qty", { header: "Allocated", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  acol.display({ id: "timing", header: "Arrival vs. start", cell: (c) => c.row.original.review ? <span className="text-amber-700">Allocation decision needed</span> : <TimingBadge timing={c.row.original.timing} lateQty={c.row.original.late_qty} /> }),
];

/** One selected line: quantity breakdown, shipments, and the work orders it supports. */
function LineDetail({ l }: { l: POLine }) {
  const breakdown: [string, number][] = [
    ["Unshipped", l.unshipped], ["In transit", l.in_transit], ["Awaiting QA", l.awaiting_qa],
    ["Received, to assign", l.received_unassigned], ["Allocated", l.allocated], ["Unallocated", l.unallocated],
    ["Short", l.deficit], ["Closed shortfall", l.closed_shortfall],
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm tabular">
        {breakdown.filter(([, v]) => v).map(([k, v]) => <span key={k}><span className="text-zinc-500">{k}</span> <b>{v}</b></span>)}
        {l.unshipped > 0 && <span className="text-zinc-500">Unshipped expected {fmtDate(l.expected_arrival)} ({l.arrival_basis ? BASIS[l.arrival_basis] : "—"})</span>}
        <ShortfallAction l={l} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="overflow-hidden rounded-md border bg-white">
          <DataTable bare data={l.shipments} columns={shipmentColumns} getRowId={(r) => r.shipment_line_id} empty="Not shipped yet." />
        </div>
        <div className="overflow-hidden rounded-md border bg-white">
          <DataTable bare data={l.allocations} columns={allocColumns} getRowId={(r) => r.allocation_id} empty={`No allocations — ${l.unallocated} unallocated (general stock).`} />
        </div>
      </div>
    </div>
  );
}

function ShortfallAction({ l }: { l: POLine }) {
  const shortfall = useAction<{ qty: number; note: string }>(`/po-lines/${l.id}/close-shortfall`, { success: "Short delivery recorded" });
  const [qty, setQty] = useState(l.outstanding);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (l.outstanding <= 0) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQty(l.outstanding); setNote(""); } }}>
      <DialogTrigger asChild><button className="text-xs text-blue-700 hover:underline">Record short delivery…</button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Short delivery · ${l.part_number}`} description="The supplier will not deliver these units. Allocations that lose supply need an allocation decision." />
        <div className="space-y-3">
          <Field label={`Quantity not coming (max ${l.outstanding})`}><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="Reason"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={qty < 1 || qty > l.outstanding || !note.trim() || shortfall.isPending}
            onClick={() => shortfall.mutate({ qty, note }, { onSuccess: () => setOpen(false) })}>Record short delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
