import { ArrowLeft, CheckCircle2, PackageOpen, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAction, useWarehouseQueue } from "@/api/hooks";
import type { Arrival } from "@/api/types";
import { ArrivalInfo, QueryView } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Callout, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";

/** Focused, mobile-friendly receiving task for one delivery. */
export function ReceiveTaskPage() {
  const [params] = useSearchParams();
  const wh = params.get("wh") ?? "wh_west";
  const q = useWarehouseQueue(wh);
  // Held here: a fully received delivery drops out of the refetched queue.
  const [result, setResult] = useState<ReceiptResult | null>(null);
  return (
    <div className="mx-auto max-w-xl">
      <Link to="/warehouse" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-600"><ArrowLeft className="size-4" />Arrivals</Link>
      {result ? <ReceiptDone r={result} /> : (
        <QueryView q={q}>
          {(d) => {
            const shipment = params.get("shipment");
            const line = params.get("po_line");
            const a = d.arrivals.find((x) => (shipment ? x.shipment_id === shipment : x.kind === "unshipped" && x.lines[0].po_line_id === line));
            return a ? <ReceiveForm a={a} wh={wh} onDone={setResult} /> : (
              <Callout tone="neutral">This delivery has nothing left to receive. <Link className="underline" to="/warehouse">Back to arrivals</Link></Callout>
            );
          }}
        </QueryView>
      )}
    </div>
  );
}

type ReceiptResult = { number: string; qa: number; accepted: number };

function ReceiptDone({ r }: { r: ReceiptResult }) {
  return (
    <Card className="space-y-4 p-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-green-600" />
      <div className="text-lg font-semibold">Received {r.number}</div>
      <p className="text-sm text-zinc-600">
        {r.qa > 0 && <>Sent to QA — not available until inspected. </>}
        {r.accepted > 0 && <>No QA required — accepted; put away or move to staging. </>}
      </p>
      <div className="flex justify-center gap-2">
        {r.qa > 0 && <Button asChild variant="outline"><Link to="/qa">Open QA queue</Link></Button>}
        <Button asChild><Link to={r.qa > 0 ? "/warehouse" : "/warehouse/putaway"}>{r.qa > 0 ? "Back to arrivals" : "Put away"}</Link></Button>
      </div>
    </Card>
  );
}

function ReceiveForm({ a, wh, onDone }: { a: Arrival; wh: string; onDone: (r: ReceiptResult) => void }) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(a.lines.map((l) => [l.po_line_id, l.open_qty])));
  const [lot, setLot] = useState<Record<string, string>>({});
  const receive = useAction<unknown, { lines: { qa_batch_id: string | null }[] }>("/receipts", {
    success: "Receipt recorded",
    onSuccess: (r) => onDone({ number: a.number, qa: r.lines.filter((l) => l.qa_batch_id).length, accepted: r.lines.filter((l) => !l.qa_batch_id).length }),
  });

  const valid = a.lines.every((l) => qty[l.po_line_id] >= 1 && qty[l.po_line_id] <= l.open_qty && (!l.lot_tracked || lot[l.po_line_id]));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 text-lg font-semibold"><PackageOpen className="size-5" />{a.number}</div>
        <div className="text-sm text-zinc-600">{a.supplier}</div>
        <div className="mt-1"><ArrivalInfo date={a.expected_arrival} basis={a.arrival_basis} channel={a.arrival_channel} /></div>
        {a.tracking_number && <div className="text-xs text-zinc-500">{a.carrier} · {a.tracking_number}</div>}
      </Card>
      {a.lines.map((l) => (
        <Card key={l.po_line_id} className="space-y-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{l.part_number}</span>
              {l.requires_qa ? <Badge tone="amber">QA required</Badge> : <Badge tone="green">No QA</Badge>}
            </div>
            <div className="text-sm text-zinc-600">{l.description} · {l.label}</div>
            <div className="mt-1 text-xs text-zinc-500">
              Expected {l.open_qty} {l.uom}
              {l.demand.length > 0 && <> · for {l.demand.map((x) => `${x.work_order_number} (${fmtDate(x.production_start_date)})`).join(", ")}</>}
            </div>
          </div>
          <Field label="Counted quantity" hint={qty[l.po_line_id] < l.open_qty ? `${l.open_qty - qty[l.po_line_id]} will remain outstanding on the PO` : undefined}>
            <Input type="number" inputMode="numeric" className="h-14 text-2xl font-semibold tabular" min={1} max={l.open_qty}
              value={qty[l.po_line_id]} onChange={(e) => setQty({ ...qty, [l.po_line_id]: Number(e.target.value) })} />
          </Field>
          {l.lot_tracked && (
            <Field label="Lot / heat number (required)">
              <Input className="h-12 text-lg" value={lot[l.po_line_id] ?? ""} onChange={(e) => setLot({ ...lot, [l.po_line_id]: e.target.value })} placeholder="Scan or type" />
            </Field>
          )}
          {qty[l.po_line_id] > l.open_qty && (
            <Callout tone="red" icon={<TriangleAlert />}>More than expected. Receive the expected quantity and report the over-receipt for manual review.</Callout>
          )}
        </Card>
      ))}
      <Button size="xl" disabled={!valid || receive.isPending} onClick={() => receive.mutate({
        warehouse_id: wh, shipment_id: a.shipment_id,
        lines: a.lines.map((l) => ({ po_line_id: l.po_line_id, shipment_line_id: l.shipment_line_id, qty: qty[l.po_line_id], lot: lot[l.po_line_id] || null })),
      })}>
        Record receipt
      </Button>
      <DiscrepancyDialog sourceType={a.shipment_id ? "shipment" : "po_line"} sourceId={a.shipment_id ?? a.lines[0].po_line_id} label={a.number} />
    </div>
  );
}

export function DiscrepancyDialog({ sourceType, sourceId, label, itemIds = [], defaultType = "over_receipt" }: {
  sourceType: string; sourceId: string; label: string; itemIds?: string[]; defaultType?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(defaultType);
  const [qty, setQty] = useState(0);
  const [detail, setDetail] = useState("");
  const report = useAction("/discrepancies", { success: "Discrepancy reported to purchasing", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="lg" className="w-full"><TriangleAlert />Report a discrepancy</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Report discrepancy · ${label}`} description="Record what you found. Purchasing and program management decide what happens next." />
        <div className="space-y-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="over_receipt">Over-receipt</option>
              <option value="unmatched_receipt">Unmatched / unidentified material</option>
              <option value="picking_discrepancy">Picking discrepancy</option>
            </Select>
          </Field>
          <Field label="Affected quantity"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="What happened"><Textarea value={detail} onChange={(e) => setDetail(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!detail.trim() || report.isPending} onClick={() => report.mutate({
            type, title: `${type.replace(/_/g, " ")} on ${label}`, detail, source_type: sourceType, source_id: sourceId,
            affected_qty: qty, work_order_item_ids: itemIds,
          })}>Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
