import { Radio } from "lucide-react";
import { useState } from "react";

import { useAction, usePurchaseOrder, usePurchaseOrders } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/primitives";

/**
 * Stand-in for a supplier/carrier integration (PRD 4.13). It writes the same PO-line and shipment records
 * as manual entry, tagged "simulated", and never implies receipt. Lives in demo controls, not purchasing.
 */
export function SupplierFeedSimulator() {
  const pos = usePurchaseOrders();
  const [poId, setPoId] = useState("");
  const po = usePurchaseOrder(poId);
  const [type, setType] = useState("revised_date");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [qty, setQty] = useState(0);
  const event = useAction("/integrations/supplier-events", { success: "Simulated supplier event applied", onSuccess: () => setTarget("") });
  const lines = po.data?.lines ?? [];
  const shipments = lines.flatMap((l) => l.shipments.filter((s) => s.open_qty > 0).map((s) => ({ ...s, part: l.part_number })));
  const needsShipment = type === "tracking_update";
  const allowsShipment = type === "revised_date" || needsShipment;

  function send() {
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
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Radio className="size-4" />Simulated supplier feed</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Purchase order">
          <Select value={poId} onChange={(e) => { setPoId(e.target.value); setTarget(""); }}>
            <option value="">Select…</option>
            {pos.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.supplier.name}</option>)}
          </Select>
        </Field>
        <Field label="Event">
          <Select value={type} onChange={(e) => { setType(e.target.value); setTarget(""); }}>
            <option value="acknowledgment">Supplier acknowledgment (promised date)</option>
            <option value="revised_date">Revised delivery date</option>
            <option value="ship_notice">Partial / full ship notice</option>
            <option value="tracking_update">Carrier tracking ETA</option>
          </Select>
        </Field>
        <Field label="Applies to">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!poId}>
            <option value="">Select…</option>
            {!needsShipment && lines.map((l) => <option key={l.id} value={`po_line:${l.id}`}>{l.label} {l.part_number} (unshipped {l.unshipped})</option>)}
            {allowsShipment && shipments.map((s) => <option key={s.shipment_id} value={`shipment:${s.shipment_id}`}>{s.number} {s.part} ({s.open_qty})</option>)}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Field label={type === "acknowledgment" ? "Promised date" : "Expected arrival"} className="flex-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {type === "ship_notice" && <Field label="Qty" className="w-20"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>}
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!target || event.isPending || (type === "ship_notice" && qty < 1)} onClick={send}>Send event</Button>
      </div>
    </div>
  );
}
