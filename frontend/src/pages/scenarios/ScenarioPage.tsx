import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAction, useScenario } from "@/api/hooks";
import type { ScenarioBrief, ScenarioPreview } from "@/api/types";
import { SubTable } from "@/components/DataTable";
import { CoverageText, FactList, PageHeader, QueryView, ReqStatus, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Callout, Input, Table, TD, TH, TR } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function ScenarioPage() {
  const { id = "" } = useParams();
  const q = useScenario(id);
  return <QueryView q={q}>{(s) => <Workspace s={s} />}</QueryView>;
}

type Draft = Record<string, { available: number; incoming: number }>;

function fromServer(s: ScenarioPreview): Draft {
  return Object.fromEntries(s.rows.map((r) => [r.work_order_item_id, { available: r.proposed_available_qty, incoming: r.proposed_incoming_qty }]));
}

function Workspace({ s }: { s: ScenarioPreview }) {
  const navigate = useNavigate();
  // Local draft inputs; live data is only what the server last previewed.
  const serverDraft = useMemo(() => fromServer(s), [s]);
  const [draft, setDraft] = useState<Draft>(serverDraft);
  const rowKey = Object.keys(serverDraft).join();
  useEffect(() => setDraft(serverDraft), [s.scenario_id, s.state, rowKey]); // re-sync only when the draft's shape changes
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverDraft);

  const preview = useAction<{ proposals: unknown[] }>(`/scenarios/${s.scenario_id}`, { method: "PUT" });
  const apply = useAction(`/scenarios/${s.scenario_id}/apply`, { success: "Plan applied" });
  const discard = useAction(`/scenarios/${s.scenario_id}/discard`, { success: "Discarded; nothing changed", onSuccess: () => navigate("/purchasing/shortages") });
  const refresh = useAction(`/scenarios/${s.scenario_id}/refresh`, { success: "Updated to current supply — review before applying" });

  const isDraft = s.state === "draft";
  const planAvailable = Object.values(draft).reduce((a, d) => a + d.available, 0);
  const planIncoming = Object.values(draft).reduce((a, d) => a + d.incoming, 0);

  function runPreview() {
    preview.mutate({ proposals: Object.entries(draft).map(([work_order_item_id, d]) => ({ work_order_item_id, available_qty: d.available, incoming_qty: d.incoming })) });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2"><FlaskConical className="size-5" />Resolve material shortage</span>}
        subtitle="Split the remaining supply between the affected work orders. Nothing changes until you apply."
        info="Program management and purchasing decide together. No earliest-start rule is applied automatically. Scrapped units never count as supply."
        actions={isDraft && (
          <>
            <Button size="sm" variant="outline" disabled={discard.isPending} onClick={() => discard.mutate({})}><Trash2 />Discard</Button>
            <Button size="sm" disabled={!s.feasible || s.stale || dirty || apply.isPending} onClick={() => apply.mutate({})}
              title={dirty ? "Preview your changes before applying" : undefined}>
              <CheckCircle2 />Apply plan
            </Button>
          </>
        )}
      />

      <FactList facts={[
        ["Part", <span key="p">{s.part_number}<span className="block text-xs font-normal text-zinc-500">{s.description}</span></span>],
        ["PO line", <Link key="l" className="text-blue-700 hover:underline" to={`/purchasing/pos/${s.po_id}`}>{s.label}</Link>],
        ["Supplier", s.supplier],
        ["Site", s.warehouse],
        ["Allocated to orders", s.supply.allocated],
        ["Short", <span key="sh" className="text-red-700">{s.supply.short}</span>],
        ["Available now", <span key="a" className="text-green-700">{s.supply.available}</span>],
        ["Still on order", <span key="o" className="text-blue-700">{s.supply.incoming}</span>],
        ["Your plan: from available", <span key="pa" className={planAvailable > s.supply.available ? "text-red-700" : ""}>{planAvailable} of {s.supply.available}</span>],
        ["Your plan: from on order", <span key="po" className={planIncoming > s.supply.incoming ? "text-red-700" : ""}>{planIncoming} of {s.supply.incoming}</span>],
      ]} className="lg:grid-cols-5" />

      {!isDraft && (
        <Callout tone={s.state === "applied" ? "green" : "neutral"} icon={<CheckCircle2 />}>
          Plan {s.state}. {s.state === "applied" && <>Any work order still short is now in the <Link className="underline" to="/purchasing/queue">purchasing queue</Link>.</>}
        </Callout>
      )}
      {isDraft && s.stale && (
        <Callout tone="red" icon={<AlertTriangle />}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Supply or allocations changed since this plan was started. Refresh and review before applying.</span>
            <Button size="sm" variant="outline" onClick={() => refresh.mutate({})}><RefreshCw />Refresh</Button>
          </div>
        </Callout>
      )}

      <SubTable title={isDraft ? "Plan (draft)" : "Plan"}>
        <Table>
          <thead className="bg-zinc-50">
            <tr>
              <TH>Work order</TH><TH>Production start</TH><TH className="text-right">Needs</TH><TH className="text-right">Allocated now</TH>
              <TH className="bg-blue-50/60">Give from available</TH><TH className="bg-blue-50/60">Give from on order</TH>
              <TH>Status now</TH><TH>Status with this plan</TH>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => {
              const d = draft[r.work_order_item_id] ?? { available: 0, incoming: 0 };
              const set = (k: "available" | "incoming", v: number) => setDraft({ ...draft, [r.work_order_item_id]: { ...d, [k]: Math.max(0, v || 0) } });
              return (
                <TR key={r.work_order_item_id}>
                  <TD><Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${r.work_order_id}`}>{r.work_order_number}</Link>
                    <div className="text-xs text-zinc-500">{r.work_order_title}</div></TD>
                  <TD><StartDate date={r.production_start_date} /></TD>
                  <TD className="text-right tabular">{r.required_qty}</TD>
                  <TD className="text-right tabular">{r.allocated_qty}</TD>
                  <TD className="bg-blue-50/30">
                    <Input type="number" className="w-20" min={0} disabled={!isDraft} value={d.available} onChange={(e) => set("available", Number(e.target.value))} />
                  </TD>
                  <TD className="bg-blue-50/30">
                    <Input type="number" className="w-20" min={0} disabled={!isDraft || s.supply.incoming === 0} value={d.incoming} onChange={(e) => set("incoming", Number(e.target.value))} />
                  </TD>
                  <TD><Brief b={r.live} /></TD>
                  <TD><Brief b={r.preview} faded={dirty} /></TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {isDraft && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <div className="space-y-1 text-sm">
              {dirty && <span className="text-amber-700">Changes not previewed yet.</span>}
              {!dirty && s.errors.map((e) => <div key={e} className="flex items-center gap-1 text-red-700"><AlertTriangle className="size-4" />{e}</div>)}
              {!dirty && s.feasible && <span className="text-green-700">This plan fits the remaining supply.</span>}
            </div>
            <div className="flex gap-2">
              {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(serverDraft)}>Undo changes</Button>}
              <Button size="sm" variant="outline" disabled={!dirty || preview.isPending} onClick={runPreview}>Preview</Button>
            </div>
          </div>
        )}
      </SubTable>
    </div>
  );
}

function Brief({ b, faded }: { b: ScenarioBrief; faded?: boolean }) {
  return (
    <div className={cn("space-y-0.5", faded && "opacity-40")}>
      <ReqStatus state={b.state} short={b.uncovered} />
      <div><CoverageText staged={b.staged} available={b.available} onOrder={b.incoming} decision={b.review} short={b.uncovered} /></div>
    </div>
  );
}
