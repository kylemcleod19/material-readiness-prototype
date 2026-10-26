import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeft, Check, PackagePlus, ShoppingCart, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { useAction, useMaster, usePurchaseOrder } from "@/api/hooks";
import type { DemandRef, MaterialException, SupplyOption, WhRef } from "@/api/types";
import { StartDate } from "@/components/domain";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Callout, Field, Input, Select, Table, TD, TH, Textarea, TR } from "@/components/ui/primitives";
import { cn, fmtDate } from "@/lib/utils";

function useDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, close: () => setOpen(false) };
}

// ------------------------------------------------------------------ assign existing supply

export function AssignSupplyDialog({ itemId, partNumber, uncovered, options, trigger }: {
  itemId: string; partNumber: string; uncovered: number; options: SupplyOption[]; trigger?: ReactNode;
}) {
  const d = useDialog();
  const [choice, setChoice] = useState<string>("");
  const [qty, setQty] = useState<number>(uncovered);
  const assign = useAction<{ source_type: string; source_id: string; qty: number }>(
    `/work-order-items/${itemId}/allocations`,
    { success: (r) => `Assigned. ${(r as { remaining_unallocated: number }).remaining_unallocated} left unallocated on source.`, onSuccess: d.close },
  );
  const here = options.filter((o) => o.compatible);
  const selected = here.find((o) => `${o.source_type}:${o.source_id}` === choice);
  const max = selected ? Math.min(selected.unallocated, uncovered) : uncovered;
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) { setChoice(""); setQty(uncovered); } }}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline"><PackagePlus />Assign supply</Button>}</DialogTrigger>
      <DialogContent wide>
        <DialogHeader title={`Assign unassigned supply · ${partNumber}`}
          description={`${uncovered} short. Stock or open PO quantity at this site that no other order is using. On-order supply will not make the order ready until it arrives.`} />
        {here.length === 0 ? (
          <Callout tone="neutral">No unallocated supply at this site.</Callout>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <thead className="bg-zinc-50">
                <tr><TH className="w-8" /><TH>Source</TH><TH>Kind</TH><TH className="text-right">Free</TH><TH>Expected</TH><TH /></tr>
              </thead>
              <tbody>
                {here.map((o) => {
                  const k = `${o.source_type}:${o.source_id}`;
                  const pick = () => { setChoice(k); setQty(Math.min(o.unallocated, uncovered)); };
                  return (
                    <TR key={k} className={cn("cursor-pointer", choice === k && "bg-zinc-100")} onClick={pick}>
                      <TD><input type="radio" checked={choice === k} onChange={pick} aria-label={o.label} /></TD>
                      <TD><span className="font-medium">{o.label}</span>{o.supplier && <div className="text-xs text-zinc-500">{o.supplier}</div>}</TD>
                      <TD><Badge tone={o.kind === "in_stock" ? "green" : "blue"}>{o.kind === "in_stock" ? "stock" : "on order"}</Badge></TD>
                      <TD className="text-right font-medium tabular">{o.unallocated}</TD>
                      <TD className="tabular">{o.expected_arrivals.map((e) => fmtDate(e)).join(", ") || "·"}</TD>
                      <TD>{o.arrives_after_start && <Badge tone="red">after start</Badge>}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        {options.some((o) => !o.compatible) && (
          <p className="mt-2 text-xs text-zinc-500">
            Other sites (needs transfer): {options.filter((o) => !o.compatible).map((o) => `${o.label} ${o.unallocated} @ ${o.destination.code}`).join("; ")}
          </p>
        )}
        {selected && (
          <Field label="Quantity to assign" className="mt-4 max-w-40" hint={`Max ${max}`}>
            <Input type="number" min={1} max={max} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button disabled={!selected || qty < 1 || qty > max || assign.isPending}
            onClick={() => selected && assign.mutate({ source_type: selected.source_type, source_id: selected.source_id, qty })}>
            Assign {qty}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ remote holds

/** Inventory planning decision: move the held stock here, or release it and buy instead. */
export function RemoteHoldActions({ allocationId, qty, source }: { allocationId: string; qty: number; source?: WhRef }) {
  const d = useDialog();
  const navigate = useNavigate();
  const [eta, setEta] = useState("");
  const confirm = useAction<{ expected_arrival: string | null }>(`/allocations/${allocationId}/confirm-transfer`,
    { success: "Transfer created; the stock is reserved until it arrives", onSuccess: d.close });
  const release = useAction(`/allocations/${allocationId}/release-hold`, {
    success: "Hold released — the requirement is now in the purchasing queue",
    onSuccess: () => navigate("/purchasing/queue"),
  });
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Dialog open={d.open} onOpenChange={d.setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline"><ArrowRightLeft />Transfer {qty}</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader title={`Transfer ${qty}${source ? ` from ${source.name}` : ""}`}
            description="The stock stays reserved for this order until it is received here." />
          <Field label="Expected arrival here" hint="Leave blank if unknown">
            <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={d.close}>Cancel</Button>
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate({ expected_arrival: eta || null })}>Create transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="ghost" disabled={release.isPending} onClick={() => release.mutate({})}>
        <Undo2 />Buy instead
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ exceptions

export function ExceptionActions({ exc }: { exc: MaterialException }) {
  const d = useDialog();
  const [note, setNote] = useState("");
  const ack = useAction(`/exceptions/${exc.id}/acknowledge`, { success: "Acknowledged" });
  const close = useAction<{ note: string }>(`/exceptions/${exc.id}/close`, { success: "Exception closed", onSuccess: d.close });
  if (exc.state === "closed") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {exc.state === "open" && <Button size="sm" variant="ghost" onClick={() => ack.mutate({})}>Acknowledge</Button>}
      <Dialog open={d.open} onOpenChange={d.setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline">Record follow-up & close</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader title="Close exception"
            description="Closing records that review happened. It does not create stock or remove a shortage." />
          <Field label="Follow-up recorded">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replacement of 20 ordered on PO-6002; supplier RMA opened" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={d.close}>Cancel</Button>
            <Button disabled={!note.trim() || close.isPending} onClick={() => close.mutate({ note })}>Close exception</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------ arrival updates

const arrivalSchema = z.object({
  target: z.string().min(1, "Choose what changed"),
  expected_arrival: z.string(),
  basis: z.enum(["supplier_promise", "carrier_estimate", "buyer_estimate"]),
  note: z.string().optional(),
});

export function UpdateArrivalDialog({ poId, defaultTarget, trigger }: { poId: string; defaultTarget?: string; trigger?: ReactNode }) {
  const d = useDialog();
  const po = usePurchaseOrder(poId);
  const form = useForm<z.infer<typeof arrivalSchema>>({
    resolver: zodResolver(arrivalSchema),
    defaultValues: { target: defaultTarget ?? "", expected_arrival: "", basis: "supplier_promise", note: "" },
  });
  const update = useAction<{ target_type: string; target_id: string; expected_arrival: string | null; basis: string; note?: string }>(
    "/arrivals", { success: "Expected arrival updated; timing recalculated", onSuccess: d.close });
  const targets = arrivalTargets(po.data);
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) form.reset({ target: defaultTarget ?? "", expected_arrival: "", basis: "supplier_promise", note: "" }); }}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline">Update arrival</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader title="Record revised expected arrival"
          description="Information received by email or phone. Production start dates are not changed; conflicts stay visible." />
        <form className="space-y-3" onSubmit={form.handleSubmit((v) => {
          const [target_type, target_id] = v.target.split(":");
          update.mutate({ target_type, target_id, expected_arrival: v.expected_arrival || null, basis: v.basis, note: v.note });
        })}>
          <Field label="Applies to" error={form.formState.errors.target?.message}>
            <Select {...form.register("target")}>
              <option value="">Select…</option>
              {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New expected arrival" hint="Blank = unknown">
              <Input type="date" {...form.register("expected_arrival")} />
            </Field>
            <Field label="Source">
              <Select {...form.register("basis")}>
                <option value="supplier_promise">Supplier promise</option>
                <option value="carrier_estimate">Carrier estimate</option>
                <option value="buyer_estimate">Buyer estimate</option>
              </Select>
            </Field>
          </div>
          <Field label="Note"><Input {...form.register("note")} placeholder="Call with supplier, 11/24" /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={d.close}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function arrivalTargets(po?: ReturnType<typeof usePurchaseOrder>["data"]) {
  if (!po) return [];
  const out: { value: string; label: string }[] = [];
  for (const l of po.lines) {
    if (l.unshipped > 0) out.push({ value: `po_line:${l.id}`, label: `${l.label} unshipped ${l.unshipped} (now ${fmtDate(l.expected_arrival)})` });
    for (const s of l.shipments) {
      if (s.open_qty > 0) out.push({ value: `shipment:${s.shipment_id}`, label: `${s.number} · ${s.open_qty} ${l.part_number} (now ${fmtDate(s.expected_arrival)})` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ check-ins

export function CompleteCheckInDialog({ taskId, poId, poNumber }: { taskId: string; poId: string; poNumber: string }) {
  const d = useDialog();
  const po = usePurchaseOrder(poId);
  const [outcome, setOutcome] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const done = useAction<{ outcome: string; new_arrival: unknown }>(`/checkins/${taskId}/complete`,
    { success: "Check-in completed", onSuccess: d.close });
  const targets = arrivalTargets(po.data);
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) { setOutcome(""); setTarget(""); setDate(""); } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Check />Complete</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Complete check-in · ${poNumber}`}
          description="Record what the supplier said. A later arrival flags linked work orders; production start stays as planned." />
        <div className="space-y-3">
          <Field label="Outcome"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Supplier confirmed departure on schedule" /></Field>
          <Field label="Revised arrival (optional)">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">No change to expected arrival</option>
              {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          {target && <Field label="New expected arrival" hint="Blank = unknown"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button disabled={!outcome.trim() || done.isPending} onClick={() => {
            const [target_type, target_id] = target.split(":");
            done.mutate({ outcome, new_arrival: target ? { target_type, target_id, expected_arrival: date || null, basis: "supplier_promise" } : null });
          }}>Complete check-in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddCheckInDialog({ poId }: { poId: string }) {
  const d = useDialog();
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const add = useAction<{ po_id: string; due_date: string; owner: string; note: string }>("/checkins", { success: "Check-in scheduled", onSuccess: d.close });
  return (
    <Dialog open={d.open} onOpenChange={d.setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Add check-in</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title="Schedule a PO check-in" description="A follow-up reminder. Its date is separate from the expected arrival; overdue means follow up, not late." />
        <div className="space-y-3">
          <Field label="Check-in date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Confirm ship date" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button disabled={!due || add.isPending} onClick={() => add.mutate({ po_id: poId, due_date: due, owner: "demo-purchasing", note })}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ consolidated purchase

const purchaseSchema = z.object({
  supplier_id: z.string().min(1, "Choose a supplier"),
  expected_arrival: z.string(),
  general_stock: z.coerce.number().int().min(0),
  allocations: z.array(z.object({ work_order_item_id: z.string(), include: z.boolean(), qty: z.coerce.number().int().min(0) })),
});
type PurchaseForm = z.infer<typeof purchaseSchema>;

export function PurchaseDialog({ partId, partNumber, destination, demand, defaultSupplierId, defaultGeneralStock = 0, trigger }: {
  partId: string; partNumber: string; destination: WhRef; demand: DemandRef[]; defaultSupplierId?: string;
  defaultGeneralStock?: number; trigger?: ReactNode;
}) {
  const d = useDialog();
  const master = useMaster();
  const defaults: PurchaseForm = {
    supplier_id: defaultSupplierId ?? "",
    expected_arrival: "",
    general_stock: defaultGeneralStock,
    allocations: demand.map((x) => ({ work_order_item_id: x.work_order_item_id, include: true, qty: x.uncovered })),
  };
  const form = useForm<PurchaseForm>({ resolver: zodResolver(purchaseSchema), defaultValues: defaults });
  const create = useAction<unknown, { number: string }>("/purchase-orders", { success: (r) => `${r.number} created`, onSuccess: d.close });
  const values = form.watch();
  const allocated = values.allocations?.reduce((s, a) => s + (a.include ? Number(a.qty) || 0 : 0), 0) ?? 0;
  const total = allocated + (Number(values.general_stock) || 0);
  const starts = demand.filter((_, i) => values.allocations?.[i]?.include).map((x) => x.production_start_date).sort();

  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) form.reset(defaults); }}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm"><ShoppingCart />Buy</Button>}</DialogTrigger>
      <DialogContent wide>
        <DialogHeader title={`Purchase ${partNumber} → ${destination.code}`}
          description="One PO line can support several work orders. Each keeps its own quantity and production start; any remainder is general stock." />
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => {
          const allocations = v.allocations.filter((a) => a.include && a.qty > 0).map(({ work_order_item_id, qty }) => ({ work_order_item_id, qty }));
          const qty = allocations.reduce((s, a) => s + a.qty, 0) + v.general_stock;
          create.mutate({ supplier_id: v.supplier_id, destination_warehouse_id: destination.id,
            lines: [{ part_id: partId, qty, expected_arrival: v.expected_arrival || null, allocations }] });
        })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier" error={form.formState.errors.supplier_id?.message}>
              <Select {...form.register("supplier_id")}>
                <option value="">Select…</option>
                {master.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected arrival (supplier quote)" hint="Blank = unknown">
              <Input type="date" {...form.register("expected_arrival")} />
            </Field>
          </div>
          {demand.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">Allocate to requirements</div>
              {demand.map((x, i) => (
                <div key={x.work_order_item_id} className="flex flex-wrap items-center gap-3 border-b px-3 py-2 last:border-0">
                  <input type="checkbox" {...form.register(`allocations.${i}.include`)} />
                  <div className="min-w-40 flex-1 text-sm">
                    <span className="font-medium">{x.work_order_number}</span>
                    <span className="ml-2 text-zinc-500">start <StartDate date={x.production_start_date} /></span>
                  </div>
                  <span className="text-xs text-zinc-500">{x.uncovered} short</span>
                  <Input type="number" className="w-24" min={0} max={x.uncovered} {...form.register(`allocations.${i}.qty`)} />
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Additional general stock" hint="Unallocated remainder for replenishment">
              <Input type="number" min={0} {...form.register("general_stock")} />
            </Field>
            <div className="rounded-md bg-zinc-50 p-3 text-sm">
              <div className="tabular">Line total <b>{total}</b> ({allocated} allocated · {Number(values.general_stock) || 0} general stock)</div>
              {starts.length > 1 && (
                <div className="mt-1 text-xs text-zinc-500">
                  Production starts span {fmtDate(starts[0])} – {fmtDate(starts[starts.length - 1])}. The arrival must meet the earliest.
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-500">Combining purchases may reduce logistics cost; freight is not calculated here.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={d.close}>Cancel</Button>
            <Button type="submit" disabled={total <= 0 || create.isPending}>Create PO for {total}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ small forms

export function PromptDialog({ title, description, label, placeholder, confirm, onSubmit, trigger, multiline, inputType = "text", required = true, initial = "", tone }: {
  title: string; description?: ReactNode; label: string; placeholder?: string; confirm: string;
  onSubmit: (value: string, close: () => void) => void; trigger: ReactNode; multiline?: boolean; inputType?: string;
  required?: boolean; initial?: string; tone?: ButtonProps["variant"];
}) {
  const d = useDialog();
  const [v, setV] = useState(initial);
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) setV(initial); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader title={title} description={description} />
        <Field label={label}>
          {multiline
            ? <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
            : <Input type={inputType} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button variant={tone} disabled={required && !v.trim()} onClick={() => onSubmit(v, d.close)}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OtherDemandDialog({ partNumber, demand }: { partNumber: string; demand: DemandRef[] }) {
  if (demand.length === 0) return null;
  const open = demand.filter((x) => x.uncovered > 0).length;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="whitespace-nowrap text-xs text-blue-700 hover:underline">
          +{demand.length} other order{demand.length > 1 ? "s" : ""}{open ? ` · ${open} short` : ""}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Other demand for ${partNumber}`} description="Individual quantities and production starts are preserved if purchases are combined." />
        <div className="divide-y rounded-md border text-sm">
          {demand.map((x) => (
            <div key={x.work_order_item_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div>
                <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${x.work_order_id}`}>{x.work_order_number}</Link>
                <span className="ml-2 text-xs text-zinc-500">{x.warehouse.code} · {x.state}</span>
              </div>
              <div className="text-xs tabular">
                <StartDate date={x.production_start_date} /> · req {x.required}
                {x.uncovered > 0 && <span className="ml-1 font-medium text-red-700">· {x.uncovered} short</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter><Link to="/purchasing/parts" className="text-sm text-blue-700 hover:underline">Open consolidated by-part view →</Link></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

