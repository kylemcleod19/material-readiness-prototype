import { createColumnHelper } from "@tanstack/react-table";
import { Radio } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAction, usePurchaseOrder } from "@/api/hooks";
import type { POLine, POShipment, PurchaseOrder } from "@/api/types";
import { AddCheckInDialog, CompleteCheckInDialog, PromptDialog, UpdateArrivalDialog } from "@/components/actions";
import { DataTable, Num, right, SubTable } from "@/components/DataTable";
import { ArrivalInfo, PageHeader, QueryView, StartDate, TimingBadge } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Callout, Field, Input, Select } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export function PurchaseOrderPage() {
  const { id = "" } = useParams();
  const q = usePurchaseOrder(id);
  return <QueryView q={q}>{(po) => <PODetail po={po} />}</QueryView>;
}

const BASIS: Record<string, string> = { supplier_promise: "supplier", carrier_estimate: "carrier", buyer_estimate: "buyer" };

const lcol = createColumnHelper<POLine>();
const lineColumns = [
  lcol.accessor("line_no", { header: "Line", cell: (c) => <span className="tabular">{c.getValue()}</span> }),
  lcol.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  lcol.accessor("ordered", { header: "Ordered", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  lcol.accessor("received", { header: "Received", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  lcol.accessor("in_transit", { header: "In transit", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  lcol.accessor("unshipped", { header: "Unshipped", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  lcol.accessor("pending_qa", { header: "In QA", ...right, cell: (c) => <Num v={c.getValue()} tone="amber" /> }),
  lcol.accessor("awaiting_handoff", { header: "Awaiting handoff", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  lcol.accessor("claims", { header: "Allocated", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  lcol.accessor("unallocated", { header: "Unallocated", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
  lcol.accessor("deficit", { header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  lcol.accessor("expected_arrival", {
    header: "Unshipped ETA",
    cell: (c) => {
      const l = c.row.original;
      if (!l.unshipped) return <span className="text-zinc-300">·</span>;
      return (
        <span className="whitespace-nowrap" title={`Updated ${fmtDateTime(l.arrival_updated_at)} via ${l.arrival_channel}`}>
          {fmtDate(l.expected_arrival)} <span className="text-xs text-zinc-500">{l.arrival_basis ? BASIS[l.arrival_basis] : ""}</span>
        </span>
      );
    },
  }),
  lcol.display({ id: "act", header: "", cell: (c) => <ShortfallAction l={c.row.original} /> }),
];

const shcol = createColumnHelper<POShipment>();
const shipmentColumns = [
  shcol.accessor("number", { header: "Shipment", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  shcol.accessor("status", { header: "Status", cell: (c) => <Badge>{c.getValue()}</Badge> }),
  shcol.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  shcol.accessor("open_qty", { header: "Open", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
  shcol.accessor("expected_arrival", {
    header: "Expected",
    cell: (c) => <ArrivalInfo compact date={c.getValue()} />,
  }),
  shcol.accessor("arrival_basis", { header: "Source", cell: (c) => <span className="text-xs">{c.getValue() ? BASIS[c.getValue()!] : "·"} · {c.row.original.arrival_channel}</span> }),
  shcol.accessor("arrival_updated_at", { header: "Updated", cell: (c) => <span className="text-xs">{fmtDateTime(c.getValue())}</span> }),
  shcol.accessor("tracking_number", { header: "Tracking", cell: (c) => <span className="text-xs">{c.row.original.carrier} {c.getValue()}</span> }),
];

type Alloc = POLine["allocations"][number];
const acol = createColumnHelper<Alloc>();
const allocColumns = [
  acol.accessor("work_order_number", { header: "Work order", cell: (c) => <Link className="text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link> }),
  acol.accessor("production_start_date", { header: "Start", cell: (c) => <StartDate date={c.getValue()} /> }),
  acol.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  acol.display({ id: "timing", header: "Timing", cell: (c) => c.row.original.review ? <Badge tone="amber">allocation review</Badge> : <TimingBadge timing={c.row.original.timing} lateQty={c.row.original.late_qty} /> }),
];

type CheckIn = NonNullable<PurchaseOrder["checkins"]>[number];

function PODetail({ po }: { po: PurchaseOrder }) {
  const review = useAction<{ note: string }>(`/purchase-orders/${po.id}/review-done`, { success: "PO review recorded" });
  const ccol = createColumnHelper<CheckIn>();
  const checkinColumns = [
    ccol.accessor("due_date", { header: "Due", cell: (c) => <span className="tabular">{fmtDate(c.getValue())}</span> }),
    ccol.accessor("status", { header: "Status", cell: (c) => { const s = c.getValue(); return <Badge tone={s === "overdue" ? "red" : s === "due" ? "amber" : s === "completed" ? "green" : "neutral"}>{s}</Badge>; } }),
    ccol.accessor("owner", { header: "Owner", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
    ccol.accessor("note", { header: "Note", cell: (c) => <span className="text-xs">{c.getValue()}</span> }),
    ccol.accessor("outcome", { header: "Outcome", cell: (c) => <span className="text-xs text-zinc-600">{c.getValue()}</span> }),
    ccol.display({ id: "act", header: "", cell: (c) => c.row.original.state === "open" ? <CompleteCheckInDialog taskId={c.row.original.id} poId={po.id} poNumber={po.number} /> : null }),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">{po.number}<Badge>{po.status}</Badge>{po.needs_review && <Badge tone="amber">needs review</Badge>}</span>}
        subtitle={`${po.supplier.name} → ${po.destination.code} · buyer ${po.buyer}`}
        actions={<><UpdateArrivalDialog poId={po.id} /><SupplierEventDialog po={po} /><AddCheckInDialog poId={po.id} /></>}
      />
      {po.needs_review && (
        <Callout tone="amber">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{po.review_note}</span>
            <PromptDialog title="Record PO review" label="Outcome" multiline confirm="Mark reviewed"
              trigger={<Button size="sm" variant="outline">Mark reviewed</Button>}
              onSubmit={(note, close) => review.mutate({ note }, { onSuccess: close })} />
          </div>
        </Callout>
      )}
      <SubTable title="Lines">
        <DataTable bare data={po.lines} columns={lineColumns} getRowId={(r) => r.id} defaultExpanded={() => true}
          renderSubRow={(l) => (
            <div className="grid gap-3 xl:grid-cols-2">
              <SubTable title="Shipments">
                <DataTable bare data={l.shipments} columns={shipmentColumns} getRowId={(r) => r.shipment_line_id} empty="Not shipped yet." />
              </SubTable>
              <SubTable title="Work orders supported">
                <DataTable bare data={l.allocations} columns={allocColumns} getRowId={(r) => r.allocation_id}
                  empty={`No allocations — ${l.unallocated} unallocated (general stock).`} />
              </SubTable>
            </div>
          )} />
      </SubTable>
      <SubTable title="Check-ins">
        <DataTable bare data={po.checkins ?? []} columns={checkinColumns} getRowId={(r) => r.id} empty="No check-ins scheduled." />
      </SubTable>
    </div>
  );
}

function ShortfallAction({ l }: { l: POLine }) {
  const shortfall = useAction<{ qty: number; note: string }>(`/po-lines/${l.id}/close-shortfall`, { success: "Shortfall recorded" });
  const [qty, setQty] = useState(l.outstanding);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (l.outstanding <= 0) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQty(l.outstanding); setNote(""); } }}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Close shortfall</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Close undelivered ${l.part_number}`} description="Recorded, not deleted. Commitments that lose supply go to allocation review." />
        <div className="space-y-3">
          <Field label={`Quantity (max ${l.outstanding})`}><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="Reason"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={qty < 1 || qty > l.outstanding || !note.trim() || shortfall.isPending}
            onClick={() => shortfall.mutate({ qty, note }, { onSuccess: () => setOpen(false) })}>Close shortfall</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Stand-in for a supplier/carrier integration: same records and rules as manual entry, tagged "simulated". */
function SupplierEventDialog({ po }: { po: PurchaseOrder }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("revised_date");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [qty, setQty] = useState(0);
  const event = useAction("/integrations/supplier-events", { success: "Simulated event applied", onSuccess: () => setOpen(false) });
  const shipments = po.lines.flatMap((l) => l.shipments.filter((s) => s.open_qty > 0).map((s) => ({ ...s, part: l.part_number })));
  const needsShipment = type === "tracking_update";
  const allowsShipment = type === "revised_date" || needsShipment;

  function submit() {
    const [kind, id] = target.split(":");
    event.mutate({
      type, date: date || null, qty: qty || null,
      po_line_id: kind === "po_line" ? id : null, shipment_id: kind === "shipment" ? id : null,
      carrier: type === "ship_notice" ? "Simulated Freight" : null,
      tracking_number: type === "ship_notice" ? `SIM-${Math.floor(Math.random() * 90000 + 10000)}` : null,
      status: type === "tracking_update" ? "in_transit" : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setTarget(""); setDate(""); setQty(0); } }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Radio />Simulate feed</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title="Simulated supplier / carrier update" description="Updates the same records as manual entry, tagged 'simulated'. Never implies receipt." />
        <div className="space-y-3">
          <Field label="Event">
            <Select value={type} onChange={(e) => { setType(e.target.value); setTarget(""); }}>
              <option value="acknowledgment">Supplier acknowledgment (promised date)</option>
              <option value="revised_date">Revised delivery date</option>
              <option value="ship_notice">Partial / full ship notice</option>
              <option value="tracking_update">Carrier tracking ETA</option>
            </Select>
          </Field>
          <Field label="Applies to">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Select…</option>
              {!needsShipment && po.lines.map((l) => <option key={l.id} value={`po_line:${l.id}`}>{l.label} {l.part_number} (unshipped {l.unshipped})</option>)}
              {allowsShipment && shipments.map((s) => <option key={s.shipment_id} value={`shipment:${s.shipment_id}`}>{s.number} {s.part} ({s.open_qty})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={type === "acknowledgment" ? "Promised date" : "Expected arrival"} hint="Blank = unknown"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {type === "ship_notice" && <Field label="Quantity shipped"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!target || event.isPending || (type === "ship_notice" && qty < 1)} onClick={submit}>Send event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
