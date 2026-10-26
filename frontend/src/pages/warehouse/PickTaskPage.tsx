import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAction, useWarehouseQueue } from "@/api/hooks";
import type { PickTask } from "@/api/types";
import { QueryView, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Callout, Card, Field, Input } from "@/components/ui/primitives";
import { useWarehouseChoice } from "@/lib/warehouse";
import { DiscrepancyDialog } from "./ReceiveTaskPage";

/** One picking task at a time, with large controls for use on the floor. */
export function PickTaskPage() {
  const { allocationId = "" } = useParams();
  const [wh] = useWarehouseChoice();
  const q = useWarehouseQueue(wh);
  return (
    <div className="mx-auto max-w-xl">
      <Link to="/warehouse/pick" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-600"><ArrowLeft className="size-4" />Pick list</Link>
      <QueryView q={q}>
        {(d) => {
          const t = d.picks.find((p) => p.allocation_id === allocationId);
          return t ? <PickForm t={t} /> : <Callout tone="neutral">Task complete or no longer available. <Link className="underline" to="/warehouse/pick">Back to pick list</Link></Callout>;
        }}
      </QueryView>
    </div>
  );
}

function PickForm({ t }: { t: PickTask }) {
  const navigate = useNavigate();
  const [qty, setQty] = useState(t.qty);
  const [loc, setLoc] = useState(`KIT-${t.work_order_number.replace("WO-", "")}`);
  const [scan, setScan] = useState("");
  const pick = useAction<{ qty: number; location: string; stage_direct: boolean }>(`/allocations/${t.allocation_id}/pick`, {
    success: "Picked", onSuccess: () => navigate("/warehouse/pick"),
  });
  const scanOk = !scan || scan.trim().toUpperCase() === t.part_number;
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5">
        <div className="text-sm text-zinc-500">Pick for <b>{t.work_order_number}</b> · start <StartDate date={t.production_start_date} days={t.days_to_start} /></div>
        <div className="text-3xl font-semibold">{t.part_number}</div>
        <div className="text-sm text-zinc-600">{t.description}</div>
        <div className="pt-2 text-lg">From <b className="font-mono">{t.location}</b>{t.lot && <> · lot {t.lot}</>}</div>
        <div className="text-lg">Quantity <b className="tabular">{t.qty} {t.uom}</b></div>
      </Card>
      {t.blocked && <Callout tone="amber">{t.blocked_reason}. This material cannot be picked yet.</Callout>}
      <Card className="space-y-3 p-4">
        <Field label="Scan or type part number to confirm (optional)" error={scanOk ? undefined : `Does not match ${t.part_number}`}>
          <Input className="h-12 text-lg" value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t.part_number} />
        </Field>
        <Field label="Quantity picked">
          <Input type="number" inputMode="numeric" className="h-14 text-2xl font-semibold tabular" value={qty} min={1} max={t.qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        <Field label="Kit / staging location"><Input className="h-12 text-lg" value={loc} onChange={(e) => setLoc(e.target.value)} /></Field>
      </Card>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="xl" variant="outline" disabled={t.blocked || !scanOk || qty < 1 || qty > t.qty || pick.isPending}
          onClick={() => pick.mutate({ qty, location: loc, stage_direct: false })}>Picked</Button>
        <Button size="xl" disabled={t.blocked || !scanOk || qty < 1 || qty > t.qty || pick.isPending}
          onClick={() => pick.mutate({ qty, location: loc, stage_direct: true })}><CheckCircle2 />Pick & stage</Button>
      </div>
      <DiscrepancyDialog sourceType="allocation" sourceId={t.allocation_id} label={`${t.part_number} for ${t.work_order_number}`} defaultType="picking_discrepancy" />
    </div>
  );
}
