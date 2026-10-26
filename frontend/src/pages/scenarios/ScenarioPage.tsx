import { AlertTriangle, CheckCircle2, GitCompareArrows, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAction, useScenario } from "@/api/hooks";
import type { ScenarioBrief, ScenarioPreview } from "@/api/types";
import { SubTable } from "@/components/DataTable";
import { FactList, PageHeader, QueryView, SituationText, StartDate } from "@/components/domain";
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
  // Draft inputs stay local; the preview columns show only what the server last calculated.
  const serverDraft = useMemo(() => fromServer(s), [s]);
  const [draft, setDraft] = useState<Draft>(serverDraft);
  const rowKey = Object.keys(serverDraft).join();
  useEffect(() => setDraft(serverDraft), [s.scenario_id, s.state, rowKey]); // re-sync only when the draft's shape changes
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverDraft);
  const [closeIssues, setCloseIssues] = useState<string[]>(s.issues.map((i) => i.id));

  const preview = useAction<{ proposals: unknown[] }>(`/scenarios/${s.scenario_id}`, { method: "PUT" });
  const apply = useAction<{ close_issue_ids: string[] }>(`/scenarios/${s.scenario_id}/apply`, { success: "Allocation applied" });
  const discard = useAction(`/scenarios/${s.scenario_id}/discard`, { success: "Discarded; nothing changed", onSuccess: () => navigate("/allocate") });
  const refresh = useAction(`/scenarios/${s.scenario_id}/refresh`, { success: "Updated to current supply — review before applying" });

  const isDraft = s.state === "draft";
  const showIncoming = s.supply.incoming > 0;
  const planAvailable = Object.values(draft).reduce((a, d) => a + d.available, 0);
  const planIncoming = Object.values(draft).reduce((a, d) => a + d.incoming, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2"><GitCompareArrows className="size-5" />Allocate material</span>}
        subtitle={s.kind === "shortage" ? "Supply no longer covers every allocation. Decide who gets it." : "Part of a delivery is available. Decide which work orders get it now."}
        info="No earliest-start rule is applied. Nothing changes until Apply, which rechecks supply and commits every change together. Scrapped units never count as supply."
        actions={isDraft && <Button size="sm" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate({})}><Trash2 />Discard</Button>}
      />

      <FactList className="lg:grid-cols-6" facts={[
        ["Part", <span key="p">{s.part_number}<span className="block text-xs font-normal text-zinc-500">{s.description}</span></span>],
        ["PO line", <Link key="l" className="text-blue-700 hover:underline" to={`/purchasing/pos/${s.po_id}`}>{s.label}</Link>],
        ["Supplier", s.supplier],
        ["Site", s.warehouse],
        ["Available now", <span key="a" className="text-green-700">{s.supply.available}</span>],
        ...(showIncoming ? [["Still on order", <span key="o" className="text-blue-700">{s.supply.incoming}</span>] as [string, React.ReactNode]] : []),
        ...(s.supply.short ? [["Short", <span key="sh" className="text-red-700">{s.supply.short} of {s.supply.allocated} allocated</span>] as [string, React.ReactNode]] : []),
      ]} />

      {!isDraft && (
        <Callout tone={s.state === "applied" ? "green" : "neutral"} icon={<CheckCircle2 />}>
          Allocation {s.state}. {s.state === "applied" && <>Work orders still short now appear in <Link className="underline" to="/purchasing/source">Source material</Link>.</>}
        </Callout>
      )}
      {isDraft && s.stale && (
        <Callout tone="red" icon={<AlertTriangle />}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Supply or allocations changed since this draft was started. Refresh and review before applying.</span>
            <Button size="sm" variant="outline" onClick={() => refresh.mutate({})}><RefreshCw />Refresh</Button>
          </div>
        </Callout>
      )}

      <SubTable title="Work orders">
        <Table>
          <thead className="bg-zinc-50">
            <tr>
              <TH>Work order</TH><TH>Production start</TH><TH className="text-right">Needs</TH><TH className="text-right">Allocated now</TH>
              <TH className="bg-blue-50/60">From available</TH>{showIncoming && <TH className="bg-blue-50/60">From on order</TH>}
              <TH>Now</TH><TH>With this plan</TH>
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
                  <TD className="bg-blue-50/30"><Input type="number" className="h-8 w-20" min={0} disabled={!isDraft} value={d.available} onChange={(e) => set("available", Number(e.target.value))} /></TD>
                  {showIncoming && <TD className="bg-blue-50/30"><Input type="number" className="h-8 w-20" min={0} disabled={!isDraft} value={d.incoming} onChange={(e) => set("incoming", Number(e.target.value))} /></TD>}
                  <TD><Brief b={r.live} /></TD>
                  <TD><Brief b={r.preview} faded={dirty} /></TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {isDraft && (
          <div className="space-y-3 border-t px-4 py-3">
            {s.issues.length > 0 && (
              <div className="space-y-1 text-sm">
                {s.issues.map((i) => (
                  <label key={i.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={closeIssues.includes(i.id)}
                      onChange={(e) => setCloseIssues(e.target.checked ? [...closeIssues, i.id] : closeIssues.filter((x) => x !== i.id))} />
                    Close the review of “{i.title}” when applied
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 text-sm">
                <div className="tabular text-zinc-600">Plan: {planAvailable} of {s.supply.available} available{showIncoming && <> · {planIncoming} of {s.supply.incoming} on order</>}</div>
                {dirty && <div className="text-amber-700">Changes not previewed yet.</div>}
                {!dirty && s.errors.map((e) => <div key={e} className="flex items-center gap-1 text-red-700"><AlertTriangle className="size-4" />{e}</div>)}
                {!dirty && s.feasible && <div className="text-green-700">This plan fits the remaining supply.</div>}
              </div>
              <div className="flex gap-2">
                {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(serverDraft)}>Undo changes</Button>}
                <Button size="sm" variant="outline" disabled={!dirty || preview.isPending}
                  onClick={() => preview.mutate({ proposals: Object.entries(draft).map(([work_order_item_id, x]) => ({ work_order_item_id, available_qty: x.available, incoming_qty: x.incoming })) })}>
                  Preview
                </Button>
                <Button size="sm" disabled={!s.feasible || s.stale || dirty || apply.isPending} onClick={() => apply.mutate({ close_issue_ids: closeIssues })}
                  title={dirty ? "Preview your changes before applying" : undefined}>
                  <CheckCircle2 />Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </SubTable>
    </div>
  );
}

function Brief({ b, faded }: { b: ScenarioBrief; faded?: boolean }) {
  const qty = b.state === "short" ? b.uncovered : b.state === "allocation_decision" ? b.review : b.state === "on_order" ? b.incoming : b.available;
  return (
    <div className={cn(faded && "opacity-40")}>
      <SituationText s={{ kind: b.state, qty, date: null, detail: null }} />
      {b.state !== "short" && b.uncovered > 0 && <div className="text-xs text-red-700">short {b.uncovered}</div>}
    </div>
  );
}
