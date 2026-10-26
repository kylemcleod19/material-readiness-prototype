import { createColumnHelper } from "@tanstack/react-table";
import { PackageOpen } from "lucide-react";
import { Link } from "react-router-dom";

import { useAction } from "@/api/hooks";
import type { Demand, WarehouseQueue } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/utils";
import { MobileRow, WarehouseScreen } from "./shared";

interface Row {
  key: string; ref: string; kind: "shipment" | "unshipped" | "transfer"; status: string; from: string;
  part: string; qty: number; qa: boolean; lot: boolean; eta: string | null; demand: Demand[]; earliest: string | null;
  receiveHref?: string; transferId?: string;
}

function toRows(d: WarehouseQueue, wh: string): Row[] {
  const rows: Row[] = d.arrivals.flatMap((a) => a.lines.map((l) => ({
    key: `${a.number}-${l.po_line_id}`, ref: a.kind === "unshipped" ? l.label : a.number, kind: a.kind, status: a.status,
    from: a.supplier, part: l.part_number, qty: l.open_qty, qa: l.requires_qa, lot: l.lot_tracked, eta: a.expected_arrival,
    demand: l.demand, earliest: l.demand[0]?.production_start_date ?? null,
    receiveHref: `/warehouse/receive?${a.shipment_id ? `shipment=${a.shipment_id}` : `po_line=${l.po_line_id}`}&wh=${wh}`,
  })));
  for (const t of d.transfers) {
    rows.push({ key: t.id, ref: "Transfer", kind: "transfer", status: t.status, from: t.source.name, part: t.part_number,
      qty: t.qty, qa: false, lot: false, eta: t.expected_arrival, demand: [], earliest: null, transferId: t.id });
  }
  return rows;
}

const STATUS: Record<string, { tone: "amber" | "blue" | "neutral" | "violet"; label: string }> = {
  arrived: { tone: "amber", label: "At dock" },
  in_transit: { tone: "blue", label: "In transit" },
  unshipped: { tone: "neutral", label: "Not shipped" },
  planned: { tone: "violet", label: "Transfer planned" },
};

function ReceiveAction({ r, size = "sm" }: { r: Row; size?: "sm" | "lg" }) {
  const recv = useAction(`/transfers/${r.transferId}/receive`, { success: "Transfer received" });
  if (r.transferId) return <Button size={size} variant="outline" disabled={recv.isPending} onClick={() => recv.mutate({})}>Receive</Button>;
  return <Button asChild size={size}><Link to={r.receiveHref!}><PackageOpen />Receive</Link></Button>;
}

const col = createColumnHelper<Row>();
const columns = [
  col.accessor("eta", { header: "Expected", cell: (c) => <span className={c.getValue() ? "font-medium tabular" : "italic text-zinc-500"}>{fmtDate(c.getValue())}</span> }),
  col.accessor("ref", { header: "Ref", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("status", { header: "Status", cell: (c) => { const s = STATUS[c.getValue()] ?? { tone: "neutral" as const, label: c.getValue() }; return <Badge tone={s.tone}>{s.label}</Badge>; } }),
  col.accessor("from", { header: "From" }),
  col.accessor("part", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  col.display({ id: "flags", header: "Checks", cell: (c) => <span className="flex gap-1">{c.row.original.qa && <Badge tone="amber">QA</Badge>}{c.row.original.lot && <Badge>Lot</Badge>}</span> }),
  col.display({ id: "for", header: "For", cell: (c) => <span className="text-xs">{c.row.original.demand.map((x) => x.work_order_number).join(", ") || <span className="text-zinc-400">general stock</span>}</span> }),
  col.accessor("earliest", { header: "Earliest start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()!} /> : <span className="text-zinc-300">·</span>) }),
  col.display({ id: "act", header: "", cell: (c) => c.row.original.kind === "unshipped" ? null : <ReceiveAction r={c.row.original} /> }),
];

export function ArrivalsPage() {
  return (
    <WarehouseScreen title="Arrivals" subtitle="Inbound shipments, open PO quantity, and transfers."
      info="Production start is shown for context only; it is not a receiving target. Receipt never implies quality release.">
      {(d, wh) => (
        <DataTable data={toRows(d, wh)} columns={columns} getRowId={(r) => r.key} initialSort={[{ id: "eta", desc: false }]}
          empty="Nothing expected."
          mobileCard={(r) => (
            <MobileRow title={<>{r.qty} {r.part} <span className="font-normal text-zinc-500">· {r.ref}</span></>}
              meta={<>{STATUS[r.status]?.label ?? r.status} · {fmtDate(r.eta)}{r.qa ? " · QA" : ""}{r.demand.length ? ` · ${r.demand.map((x) => x.work_order_number).join(", ")}` : ""}</>}
              action={r.kind === "unshipped" ? undefined : <ReceiveAction r={r} size="lg" />} />
          )} />
      )}
    </WarehouseScreen>
  );
}
