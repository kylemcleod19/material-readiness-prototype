import { createColumnHelper } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { useAction, useWorkOrder } from "@/api/hooks";
import type { Fixture, HistoryRow, ItemReadiness, MaterialException, NextAction, SourceLine, WorkOrderDetail } from "@/api/types";
import { ExceptionActions, OtherDemandDialog, PromptDialog } from "@/components/actions";
import { DataTable, Num, right, SubTable } from "@/components/DataTable";
import {
  CategoryBadge, CoverageText, FactList, OutlookBadge, PageHeader, QueryView, ReqStatus, StartDate, TimingBadge,
} from "@/components/domain";
import { type ActionContext, actionLabel, NextActionButton } from "@/components/NextAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge, Field, Select, Textarea } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/utils";

export function WorkOrderDetailPage() {
  const { id = "" } = useParams();
  const q = useWorkOrder(id);
  return <QueryView q={q}>{(wo) => <Detail wo={wo} />}</QueryView>;
}

function Detail({ wo }: { wo: WorkOrderDetail }) {
  const cancel = useAction<{ reason: string }>(`/work-orders/${wo.id}/cancel`, { success: "Canceled — unused allocations released" });
  const [showHistory, setShowHistory] = useState(false);
  const { hash } = useLocation();
  useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }, [hash]);
  const ctx: ActionContext = { woId: wo.id, woNumber: wo.number, warehouse: wo.warehouse, start: wo.production_start_date };
  const openExc = wo.exceptions.filter((e) => e.state !== "closed");

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{wo.number}<OutlookBadge outlook={wo.outlook} /></span>}
        subtitle={wo.headline}
        actions={wo.state !== "canceled" && (
          <PromptDialog title={`Cancel ${wo.number}`} label="Reason" multiline confirm="Cancel work order" tone="destructive"
            description="Releases unused allocations and flags POs for review. Staged material stays put."
            trigger={<Button size="sm" variant="outline">Cancel order</Button>}
            onSubmit={(reason, close) => cancel.mutate({ reason }, { onSuccess: close })} />
        )}
      />

      <FactList facts={[
        ["Title", wo.title],
        ["Program", wo.program],
        ["Site", wo.warehouse.name],
        ["Production start", <StartDate key="s" date={wo.production_start_date} days={wo.days_to_start} />],
        ["Build quantity", wo.build_qty],
        ["Parts staged", `${wo.kit.staged} of ${wo.kit.lines}`],
      ]} />

      <SubTable title={<>What needs to happen <Badge tone={wo.next_actions.length ? "amber" : "green"}>{wo.next_actions.length}</Badge></>}>
        <DataTable bare data={wo.next_actions} columns={actionColumns(ctx)} getRowId={(r) => `${r.kind}-${r.item_id ?? r.fixture_id ?? r.exception_id ?? ""}`}
          empty={wo.outlook === "ready" ? "Nothing — the kit is staged." : "Nothing right now — waiting on arrivals before production start."} />
      </SubTable>

      <SubTable title="Components">
        <ComponentsTable wo={wo} ctx={ctx} />
      </SubTable>

      <div className="grid gap-4 xl:grid-cols-2">
        <div id="fixtures" className="scroll-mt-16">
          <SubTable title={<>Fixtures <Badge>{wo.fixture_requirements.length}</Badge></>}>
            <DataTable bare data={wo.fixture_requirements} columns={fixtureColumns} getRowId={(r) => r.id} empty="No fixture requirements." />
          </SubTable>
        </div>
        <SubTable title={<>Exceptions <Badge tone={openExc.length ? "amber" : "neutral"}>{openExc.length}</Badge></>}>
          <DataTable bare data={wo.exceptions} columns={exceptionColumns} getRowId={(r) => r.id} empty="No linked exceptions." />
        </SubTable>
      </div>

      <SubTable title={<>History <Badge>{wo.history.length}</Badge></>}
        actions={<Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide" : "Show"}</Button>}>
        {showHistory && <DataTable bare data={wo.history} columns={historyColumns} getRowId={(r) => String(r.id)} />}
      </SubTable>
      {wo.cancel_reason && <p className="text-sm text-zinc-500">Canceled: {wo.cancel_reason}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ next actions

function actionColumns(ctx: ActionContext) {
  const col = createColumnHelper<NextAction>();
  return [
    col.display({ id: "what", header: "Action", cell: (c) => <span className="font-medium">{actionLabel(c.row.original)}</span> }),
    col.accessor((r) => r.state, {
      id: "why", header: "Why",
      cell: (c) => c.getValue() ? <ReqStatus state={c.getValue()!} short={c.row.original.qty} /> : null,
    }),
    col.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Supplier", cell: (c) => c.getValue() || <span className="text-zinc-300">·</span> }),
    col.display({ id: "act", header: "", cell: (c) => <NextActionButton action={c.row.original} ctx={ctx} /> }),
  ];
}

// ------------------------------------------------------------------ components

function ComponentsTable({ wo, ctx }: { wo: WorkOrderDetail; ctx: ActionContext }) {
  const col = createColumnHelper<ItemReadiness>();
  const enriched = (it: ItemReadiness): NextAction | null =>
    wo.next_actions.find((a) => a.item_id === it.item_id)
      ?? (it.action ? { ...it.action, item_id: it.item_id, part_id: it.part_id, part_number: it.part_number } : null);
  const columns = [
    col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium whitespace-nowrap">{c.getValue()}</span> }),
    col.accessor("description", { header: "Description", cell: (c) => <span className="text-zinc-600">{c.getValue()}</span> }),
    col.accessor("required", { header: "Needed", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    col.accessor("state", {
      header: "Status",
      cell: (c) => <ReqStatus state={c.getValue()} short={c.row.original.uncovered} expected={c.row.original.expected} />,
    }),
    col.display({
      id: "coverage", header: "Covered by",
      cell: (c) => {
        const i = c.row.original;
        return <CoverageText staged={i.staged} available={i.available} onOrder={i.incoming} otherSite={i.remote_hold} decision={i.review} short={i.uncovered} />;
      },
    }),
    col.display({ id: "other", header: "Other orders", cell: (c) => <OtherDemandDialog partNumber={c.row.original.part_number} demand={c.row.original.other_demand} /> }),
    col.display({
      id: "act", header: "Next action",
      cell: (c) => {
        const it = c.row.original;
        const a = enriched(it);
        return (
          <div className="flex items-center justify-end gap-1">
            {a && <NextActionButton action={a} ctx={{ ...ctx, required: it.required, supplyOptions: it.supply_options }} />}
            <ReduceButton it={it} wo={wo} />
          </div>
        );
      },
    }),
  ];
  return (
    <DataTable bare data={wo.items} columns={columns} getRowId={(r) => r.item_id}
      renderSubRow={(it) => (
        <DataTable bare data={it.sources} columns={sourceColumns} getRowId={(r) => r.allocation_id}
          empty={it.local_free_stock !== undefined ? `Nothing allocated yet. ${it.local_free_stock} free at this site.` : "Nothing allocated."} />
      )} />
  );
}

function ReduceButton({ it, wo }: { it: ItemReadiness; wo: WorkOrderDetail }) {
  const reduce = useAction<{ new_required_qty: number }>(`/work-order-items/${it.item_id}/reduce`, { success: "Requirement reduced" });
  if (wo.state === "canceled" || it.required === 0) return null;
  return (
    <PromptDialog title={`Reduce ${it.part_number}`} label="New required quantity" inputType="number" initial={String(it.required)} confirm="Reduce"
      description="Unused allocations above the new quantity are released; picked or staged units never are."
      trigger={<Button size="sm" variant="ghost">Reduce</Button>}
      onSubmit={(v, close) => reduce.mutate({ new_required_qty: Number(v) }, { onSuccess: close })} />
  );
}

const scol = createColumnHelper<SourceLine>();
const sourceColumns = [
  scol.accessor("label", {
    header: "Allocated from",
    cell: (c) => (
      <div>
        {c.row.original.po_id ? <Link className="text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.po_id}`}>{c.getValue()}</Link> : c.getValue()}
        {c.row.original.detail && <div className="text-xs text-zinc-500">{c.row.original.detail}</div>}
      </div>
    ),
  }),
  scol.accessor("category", { header: "State", cell: (c) => <CategoryBadge category={c.getValue()} /> }),
  scol.accessor("qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  scol.accessor("expected_arrival", { header: "Expected", cell: (c) => (c.row.original.category === "incoming" ? fmtDate(c.getValue()) : "·") }),
  scol.accessor("timing", { header: "Vs. start", cell: (c) => <TimingBadge timing={c.getValue()} lateQty={c.row.original.late_qty} /> }),
];

// ------------------------------------------------------------------ fixtures, exceptions, history

const fcol = createColumnHelper<Fixture>();
const fixtureColumns = [
  fcol.accessor("operation", { header: "Operation" }),
  fcol.accessor("fixture_type", { header: "Fixture", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  fcol.accessor("quantity", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  fcol.accessor("coverage_state", {
    header: "Coverage",
    cell: (c) => <Badge tone={c.getValue() === "covered" ? "green" : c.getValue() === "action_needed" ? "red" : "neutral"}>{c.getValue() === "pending" ? "Not confirmed" : titleCase(c.getValue())}</Badge>,
  }),
  fcol.accessor("note", { header: "Note", cell: (c) => <span className="text-xs text-zinc-600" title={c.row.original.reviewed_by ?? undefined}>{c.getValue()}</span> }),
  fcol.display({ id: "act", header: "", cell: (c) => <FixtureReview f={c.row.original} /> }),
];

function FixtureReview({ f }: { f: Fixture }) {
  const [state, setState] = useState<string>(f.coverage_state === "pending" ? "covered" : f.coverage_state);
  const [note, setNote] = useState(f.note ?? "");
  const [open, setOpen] = useState(false);
  const review = useAction<{ coverage_state: string; note: string }>(`/fixture-requirements/${f.id}/review`,
    { success: "Fixture coverage recorded", onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Review</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Fixture coverage · ${f.fixture_type}`} description="Coverage at the facility does not confirm the fixtures are free when needed." />
        <div className="space-y-3">
          <Field label="Coverage">
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="covered">Covered at facility</option>
              <option value="action_needed">Action needed (purchase, fabricate, or transfer)</option>
              <option value="pending">Not confirmed</option>
            </Select>
          </Field>
          <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={review.isPending} onClick={() => review.mutate({ coverage_state: state, note })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ecol = createColumnHelper<MaterialException>();
const exceptionColumns = [
  ecol.accessor("type", { header: "Type", cell: (c) => <Badge tone={c.row.original.blocking ? "red" : "amber"}>{titleCase(c.getValue())}</Badge> }),
  ecol.accessor("state", { header: "State", cell: (c) => <Badge>{c.getValue()}</Badge> }),
  ecol.accessor("affected_qty", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
  ecol.accessor("title", { header: "Summary", cell: (c) => <span className="text-xs" title={c.row.original.detail ?? undefined}>{c.getValue()}</span> }),
  ecol.display({ id: "act", header: "", cell: (c) => <ExceptionActions exc={c.row.original} /> }),
];

const hcol = createColumnHelper<HistoryRow>();
const historyColumns = [
  hcol.accessor("at", { header: "When", cell: (c) => <span className="whitespace-nowrap text-xs">{fmtDateTime(c.getValue())}</span> }),
  hcol.accessor("actor", { header: "Who", cell: (c) => <span className="text-xs">{c.getValue()} · {c.row.original.channel}</span> }),
  hcol.accessor("action", { header: "Action", cell: (c) => <span className="text-xs font-medium">{c.getValue()}</span> }),
  hcol.display({
    id: "change", header: "Change",
    cell: (c) => (
      <span className="font-mono text-[11px] text-zinc-600">
        {c.row.original.after ? JSON.stringify(c.row.original.after) : ""}{c.row.original.note ? ` — ${c.row.original.note}` : ""}
      </span>
    ),
  }),
];
