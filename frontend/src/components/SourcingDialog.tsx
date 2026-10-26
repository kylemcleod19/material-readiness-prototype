import { CheckCircle2, PackageSearch } from "lucide-react";
import { useMemo, useState } from "react";

import { useAction, useMaster, useSourcingOptions } from "@/api/hooks";
import type { SourceRequirement, SourcingOptions, SourcingResult } from "@/api/types";
import { FactList, Loading, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, Field, Input, Select, Table, TD, TH, TR } from "@/components/ui/primitives";
import { cn, fmtDate } from "@/lib/utils";

/**
 * Source material (PRD 4.2): available-to-allocate stock, unallocated on-order supply, stock at another
 * site, and a purchase, for one part at one destination. Nothing changes until Confirm, which applies
 * every choice in one transaction.
 */
export function SourcingDialog({ partId, warehouseId, itemIds, onClose }: {
  partId: string; warehouseId: string; itemIds?: string[]; onClose: () => void;
}) {
  const [result, setResult] = useState<SourcingResult | null>(null);
  const q = useSourcingOptions(partId, warehouseId, !result);
  const setOpen = (o: boolean) => { if (!o) onClose(); };
  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent wide className="max-w-5xl">
        <DialogHeader title="Source material" />
        {result ? <Done result={result} onClose={onClose} />
          : q.data ? <SourcingForm o={q.data} itemIds={itemIds} onDone={setResult} onCancel={() => setOpen(false)} />
          : <Loading />}
      </DialogContent>
    </Dialog>
  );
}

type RemoteChoice = "keep" | "transfer" | "buy";
interface Row { take: Record<string, number>; buy: number; remote: RemoteChoice; transferEta: string }

const AVAILABLE = "available";

function SourcingForm({ o, itemIds, onDone, onCancel }: {
  o: SourcingOptions; itemIds?: string[]; onDone: (r: SourcingResult) => void; onCancel: () => void;
}) {
  const master = useMaster();
  const preselected = (r: SourceRequirement) => !itemIds || itemIds.includes(r.work_order_item_id);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(o.requirements.map((r) => [r.work_order_item_id, preselected(r)])));
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(o.requirements.map((r) => [r.work_order_item_id, { take: {}, buy: 0, remote: "keep" as RemoteChoice, transferEta: "" }])));
  const [supplierId, setSupplierId] = useState(o.supplier?.id ?? "");
  const [eta, setEta] = useState("");
  const [generalStock, setGeneralStock] = useState(itemIds ? 0 : o.replenishment);
  const apply = useAction<unknown, SourcingResult>("/sourcing/apply", { success: "Sourcing confirmed", onSuccess: onDone });

  const availableTotal = o.available_to_allocate.reduce((s, x) => s + x.qty, 0);
  const columns = [
    ...(availableTotal ? [{ key: AVAILABLE, label: "Available to allocate", sub: `${availableTotal} at ${o.warehouse.code}`, qty: availableTotal }] : []),
    ...o.on_order.map((s) => ({
      key: `${s.source_type}:${s.source_id}`, qty: s.qty,
      label: s.source_type === "transfer_line" ? "Transfer in transit" : `On order · ${s.label}`,
      sub: `${s.qty} unallocated · ${s.multiple_arrivals ? "multiple arrivals" : fmtDate(s.expected_arrival)}`,
    })),
    ...o.other_sites.map((s) => ({ key: `site:${s.inventory_record_id}`, qty: s.qty, label: `Stock at ${s.warehouse.name}`, sub: `${s.qty} available · needs transfer` })),
  ];
  const reqs = o.requirements.filter((r) => selected[r.work_order_item_id]);
  const hidden = o.requirements.length - reqs.length;

  const set = (id: string, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });
  const need = (r: SourceRequirement) => r.short + (rows[r.work_order_item_id].remote === "buy" ? r.at_other_site : 0);
  const planned = (r: SourceRequirement) => {
    const row = rows[r.work_order_item_id];
    return Object.values(row.take).reduce((s, v) => s + (v || 0), 0) + row.buy;
  };
  const used = (key: string) => reqs.reduce((s, r) => s + (rows[r.work_order_item_id].take[key] || 0), 0);
  const buyTotal = reqs.reduce((s, r) => s + rows[r.work_order_item_id].buy, 0) + generalStock;

  const problems = useMemo(() => {
    const out: string[] = [];
    for (const c of columns) if (used(c.key) > c.qty) out.push(`${c.label}: only ${c.qty} available`);
    for (const r of reqs) if (planned(r) > need(r)) out.push(`${r.work_order_number} needs only ${need(r)}`);
    if (buyTotal > 0 && !supplierId) out.push("Select a supplier to purchase");
    return out;
  }, [rows, reqs, columns, buyTotal, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  const anything = buyTotal > 0 || reqs.some((r) => rows[r.work_order_item_id].remote !== "keep" || Object.values(rows[r.work_order_item_id].take).some((v) => v > 0));

  function submit() {
    const release_holds: unknown[] = [];
    const transfers: unknown[] = [];
    const assignments: unknown[] = [];
    const allocations: { work_order_item_id: string; qty: number }[] = [];
    const localLeft = o.available_to_allocate.map((x) => ({ ...x }));
    for (const r of reqs) {
      const row = rows[r.work_order_item_id];
      if (row.remote === "buy") r.remote_holds.forEach((h) => release_holds.push({ allocation_id: h.allocation_id, qty: h.qty }));
      if (row.remote === "transfer") r.remote_holds.forEach((h) => transfers.push({ allocation_id: h.allocation_id, expected_arrival: row.transferEta || null }));
      for (const [key, qty] of Object.entries(row.take)) {
        if (!qty) continue;
        if (key === AVAILABLE) {
          let left = qty; // spread across the site's stock records in order
          for (const rec of localLeft) {
            const take = Math.min(rec.qty, left);
            if (take > 0) { assignments.push({ work_order_item_id: r.work_order_item_id, source_type: "inventory", source_id: rec.source_id, qty: take }); rec.qty -= take; left -= take; }
          }
        } else if (key.startsWith("site:")) {
          transfers.push({ work_order_item_id: r.work_order_item_id, inventory_record_id: key.slice(5), qty, expected_arrival: null });
        } else {
          const [source_type, source_id] = key.split(":");
          assignments.push({ work_order_item_id: r.work_order_item_id, source_type, source_id, qty });
        }
      }
      if (row.buy > 0) allocations.push({ work_order_item_id: r.work_order_item_id, qty: row.buy });
    }
    apply.mutate({
      part_id: o.part.id, warehouse_id: o.warehouse.id, release_holds, transfers, assignments,
      purchase: buyTotal > 0 ? { supplier_id: supplierId, expected_arrival: eta || null, general_stock: generalStock, allocations } : null,
    });
  }

  return (
    <div className="space-y-4">
      <FactList className="lg:grid-cols-4" facts={[
        ["Part", <span key="p">{o.part.part_number}<span className="block text-xs font-normal text-zinc-500">{o.part.description}</span></span>],
        ["Destination", o.warehouse.name],
        ["Preferred supplier", o.supplier?.name ?? "Not selected"],
        ["Lead time", o.part.lead_time_days ? `${o.part.lead_time_days} days` : "—"],
      ]} />

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <thead className="bg-zinc-50">
            <tr>
              <TH>Work order</TH><TH>Production start</TH><TH className="text-right">Short</TH>
              {columns.map((c) => <TH key={c.key}><div>{c.label}</div><div className="font-normal text-zinc-400">{c.sub}</div></TH>)}
              <TH>Buy</TH><TH className="text-right">Still short</TH>
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => {
              const row = rows[r.work_order_item_id];
              const left = need(r) - planned(r);
              return (
                <TR key={r.work_order_item_id}>
                  <TD>
                    <div className="font-medium">{r.work_order_number}</div>
                    {r.at_other_site > 0 && (
                      <div className="mt-1 space-y-1 text-xs">
                        <div className="text-violet-700">{r.at_other_site} held at {r.remote_holds[0]?.warehouse.name}</div>
                        <Select className="h-7 text-xs" value={row.remote} onChange={(e) => {
                          const remote = e.target.value as RemoteChoice;
                          set(r.work_order_item_id, { remote, buy: remote === "buy" ? row.buy + r.at_other_site : Math.max(0, row.buy - (row.remote === "buy" ? r.at_other_site : 0)) });
                        }}>
                          <option value="keep">Decide later</option>
                          <option value="transfer">Transfer it here</option>
                          <option value="buy">Buy instead</option>
                        </Select>
                        {row.remote === "transfer" && <Input type="date" className="h-7 text-xs" value={row.transferEta} onChange={(e) => set(r.work_order_item_id, { transferEta: e.target.value })} title="Expected arrival here" />}
                      </div>
                    )}
                  </TD>
                  <TD><StartDate date={r.production_start_date} /></TD>
                  <TD className="text-right tabular font-medium text-red-700">{r.short || "·"}</TD>
                  {columns.map((c) => (
                    <TD key={c.key}>
                      <Input type="number" min={0} className="h-8 w-20" value={row.take[c.key] ?? ""} placeholder="0"
                        onChange={(e) => set(r.work_order_item_id, { take: { ...row.take, [c.key]: Math.max(0, Number(e.target.value) || 0) } })} />
                    </TD>
                  ))}
                  <TD>
                    <Input type="number" min={0} className="h-8 w-20" value={row.buy || ""} placeholder="0"
                      onChange={(e) => set(r.work_order_item_id, { buy: Math.max(0, Number(e.target.value) || 0) })} />
                  </TD>
                  <TD className={cn("text-right tabular font-medium", left > 0 ? "text-red-700" : left < 0 ? "text-amber-700" : "text-green-700")}>
                    {left > 0 ? left : left < 0 ? `+${-left}` : "0"}
                  </TD>
                </TR>
              );
            })}
            {reqs.length === 0 && <TR><TD colSpan={columns.length + 5} className="text-zinc-500">No work-order requirements selected.</TD></TR>}
          </tbody>
        </Table>
      </div>
      {hidden > 0 && (
        <button className="text-xs text-blue-700 hover:underline" onClick={() => setSelected(Object.fromEntries(o.requirements.map((r) => [r.work_order_item_id, true])))}>
          Include {hidden} other work order{hidden > 1 ? "s" : ""} short on {o.part.part_number} at {o.warehouse.code}
        </button>
      )}

      <div className="grid gap-3 rounded-md border bg-zinc-50/60 p-3 sm:grid-cols-4">
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not selected</option>
            {master.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Expected arrival (quote)" hint="Blank = unknown"><Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
        <Field label="Plus general stock" hint={o.replenishment ? `Replenishment suggests ${o.replenishment}` : undefined}>
          <Input type="number" min={0} value={generalStock || ""} placeholder="0" onChange={(e) => setGeneralStock(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <div className="self-end text-sm">Purchase total <b className="tabular">{buyTotal}</b></div>
      </div>

      {problems.length > 0 && <Callout tone="amber">{problems.map((p) => <div key={p}>{p}</div>)}</Callout>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={!anything || problems.length > 0 || apply.isPending} onClick={submit}><PackageSearch />Confirm sourcing</Button>
      </DialogFooter>
    </div>
  );
}

function Done({ result, onClose }: { result: SourcingResult; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <Callout tone="green" icon={<CheckCircle2 />}>
        {result.changes.map((c) => <div key={c}>{c}</div>)}
      </Callout>
      <Table>
        <thead><tr><TH>Work order</TH><TH className="text-right">Still short</TH><TH className="text-right">At another site</TH></tr></thead>
        <tbody>
          {result.remaining.map((r) => (
            <TR key={r.work_order_number}>
              <TD className="font-medium">{r.work_order_number}</TD>
              <TD className={cn("text-right tabular", r.short ? "text-red-700" : "text-green-700")}>{r.short}</TD>
              <TD className="text-right tabular">{r.at_other_site || "·"}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
    </div>
  );
}
