import { CheckCircle2, MessageSquareReply } from "lucide-react";
import { useState } from "react";

import { useAction, usePurchaseOrder } from "@/api/hooks";
import type { PurchaseOrder } from "@/api/types";
import { FactList, Loading, StartDate, TimingBadge } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Field, Input, Select, Table, TD, TH, Textarea, TR } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";

/**
 * Record supplier update (PRD 4.18): one interaction for the outcome note, revised arrivals for the chosen
 * shipments/PO lines, completing the due check-ins, scheduling the next one, and PO review.
 */
export function SupplierUpdateDialog({ poId, target, onClose }: {
  poId: string; target?: { type: string; id: string }; onClose: () => void;
}) {
  const [done, setDone] = useState(false);
  const po = usePurchaseOrder(poId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader title="Record supplier update" />
        {!po.data ? <Loading /> : done ? <Result po={po.data} onClose={onClose} />
          : <UpdateForm po={po.data} target={target} onDone={() => setDone(true)} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function UpdateForm({ po, target, onDone, onCancel }: {
  po: PurchaseOrder; target?: { type: string; id: string }; onDone: () => void; onCancel: () => void;
}) {
  const targets = po.arrival_targets ?? [];
  const [note, setNote] = useState("");
  const [change, setChange] = useState<Record<string, { on: boolean; date: string }>>(() => Object.fromEntries(targets.map((t) => [
    `${t.target_type}:${t.target_id}`, { on: !!target && target.type === t.target_type && target.id === t.target_id, date: t.expected_arrival ?? "" },
  ])));
  const [basis, setBasis] = useState("supplier_promise");
  const dueCheckins = (po.checkins ?? []).filter((c) => (po.open_checkin_ids ?? []).includes(c.id));
  const [complete, setComplete] = useState<string[]>(dueCheckins.map((c) => c.id));
  const [next, setNext] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const save = useAction(`/purchase-orders/${po.id}/supplier-update`, { success: "Supplier update recorded", onSuccess: onDone });

  function submit() {
    save.mutate({
      note,
      arrivals: targets.filter((t) => change[`${t.target_type}:${t.target_id}`]?.on).map((t) => ({
        target_type: t.target_type, target_id: t.target_id, basis,
        expected_arrival: change[`${t.target_type}:${t.target_id}`].date || null,
      })),
      complete_checkin_ids: complete,
      next_checkin: next ? { due_date: next } : null,
      mark_reviewed: reviewed,
    });
  }

  return (
    <div className="space-y-4">
      <FactList className="lg:grid-cols-3" facts={[["PO", po.number], ["Supplier", po.supplier.name], ["Destination", po.destination.name]]} />
      <Field label="What the supplier said (required)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call with Ridgeline: SH-7002 departs Dec 3, arrives Dec 5" />
      </Field>

      {targets.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <thead className="bg-zinc-50"><tr><TH>Change</TH><TH>Incoming</TH><TH className="text-right">Qty</TH><TH>Current</TH><TH>New expected arrival</TH></tr></thead>
            <tbody>
              {targets.map((t) => {
                const k = `${t.target_type}:${t.target_id}`;
                const c = change[k];
                return (
                  <TR key={k}>
                    <TD><input type="checkbox" checked={c.on} onChange={(e) => setChange({ ...change, [k]: { ...c, on: e.target.checked } })} aria-label={`Change ${t.label}`} /></TD>
                    <TD>{t.label}</TD>
                    <TD className="text-right tabular">{t.qty}</TD>
                    <TD className="tabular">{fmtDate(t.expected_arrival)}</TD>
                    <TD><Input type="date" className="h-8 w-40" disabled={!c.on} value={c.date} onChange={(e) => setChange({ ...change, [k]: { ...c, date: e.target.value } })} /></TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
          <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-zinc-600">
            Source of new dates
            <Select className="h-7 w-44 text-xs" value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="supplier_promise">Supplier promise</option>
              <option value="carrier_estimate">Carrier estimate</option>
              <option value="buyer_estimate">Buyer estimate</option>
            </Select>
            <span className="text-zinc-400">Blank date = unknown. Production starts are not changed.</span>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          {dueCheckins.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input type="checkbox" checked={complete.includes(c.id)}
                onChange={(e) => setComplete(e.target.checked ? [...complete, c.id] : complete.filter((x) => x !== c.id))} />
              Complete check-in due {fmtDate(c.due_date)} <span className="text-xs text-zinc-500">({c.status})</span>
            </label>
          ))}
          {po.needs_review && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              PO review done <span className="text-xs text-zinc-500">{po.review_note}</span>
            </label>
          )}
        </div>
        <Field label="Next check-in (optional)"><Input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={!note.trim() || save.isPending} onClick={submit}><MessageSquareReply />Record update</Button>
      </DialogFooter>
    </div>
  );
}

/** After saving: what the PO's work orders look like now. A later date does not resolve lateness. */
function Result({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const rows = po.lines.flatMap((l) => l.allocations.map((a) => ({ ...a, part: l.part_number })));
  const late = rows.filter((r) => r.timing === "late" || r.timing === "timing_review" || r.timing === "unknown");
  return (
    <div className="space-y-3">
      <Callout tone={late.length ? "amber" : "green"} icon={<CheckCircle2 />}>
        {late.length ? `Recorded. ${late.length} work order${late.length > 1 ? "s" : ""} still have an arrival conflict.` : "Recorded. No remaining arrival conflicts on this PO."}
      </Callout>
      {rows.length > 0 && (
        <Table>
          <thead><tr><TH>Work order</TH><TH>Part</TH><TH>Production start</TH><TH className="text-right">Qty</TH><TH>Arrival vs. start</TH></tr></thead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.allocation_id}>
                <TD className="font-medium">{r.work_order_number}</TD><TD>{r.part}</TD>
                <TD><StartDate date={r.production_start_date} /></TD>
                <TD className="text-right tabular">{r.qty}</TD>
                <TD>{r.review ? <span className="text-amber-700">Allocation decision needed</span> : <TimingBadge timing={r.timing} lateQty={r.late_qty} />}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
    </div>
  );
}
