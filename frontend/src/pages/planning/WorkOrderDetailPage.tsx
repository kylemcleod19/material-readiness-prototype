import { createColumnHelper } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { useAction, useWorkOrder } from "@/api/hooks";
import type { Fixture, ItemReadiness, MaterialException, SourceLine, WorkOrderDetail } from "@/api/types";
import { ExceptionActions, PromptDialog } from "@/components/actions";
import { DataTable, Num, right, SubTable } from "@/components/DataTable";
import { CategoryBadge, FactList, OutlookBadge, PageHeader, QueryView, SituationText, StartDate, TimingBadge } from "@/components/domain";
import { NextActionButton } from "@/components/NextAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Badge, Field, Select, Textarea } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/utils";

export function WorkOrderDetailPage() {
  const { id = "" } = useParams();
  const q = useWorkOrder(id);
  return <QueryView q={q}>{(wo) => <Detail wo={wo} />}</QueryView>;
}

/** Secondary actions kept out of the main action area (PRD 4.19). */
function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-zinc-300 bg-white p-1.5 hover:bg-zinc-100" aria-label="More actions">
        <MoreHorizontal className="size-4" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col rounded-md border bg-white p-1 shadow-lg">{children}</div>
    </details>
  );
}

function Detail({ wo }: { wo: WorkOrderDetail }) {
  const cancel = useAction<{ reason: string }>(`/work-orders/${wo.id}/cancel`, { success: "Canceled — unused allocations released" });
  const attention = wo.items.filter((i) => i.needs_attention);
  const [filter, setFilter] = useState(attention.length ? "attention" : "all");
  const [fixtureOpen, setFixtureOpen] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { hash } = useLocation();
  useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }, [hash]);
  const openExc = wo.exceptions.filter((e) => e.state !== "closed");
  const finalizeAction = wo.next_actions.find((a) => a.kind === "finalize");

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{wo.number}<OutlookBadge outlook={wo.outlook} /></span>}
        subtitle={wo.headline}
        actions={
          <div className="flex items-center gap-2">
            {finalizeAction && <NextActionButton action={finalizeAction} woId={wo.id} />}
            {wo.state !== "canceled" && (
              <MoreMenu>
                <PromptDialog title={`Cancel ${wo.number}`} label="Reason" multiline confirm="Cancel work order" tone="destructive"
                  description="Releases unused allocations and flags POs for review. Staged material stays put."
                  trigger={<button className="rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100">Cancel work order…</button>}
                  onSubmit={(reason, close) => cancel.mutate({ reason }, { onSuccess: close })} />
              </MoreMenu>
            )}
          </div>
        }
      />

      <FactList facts={[
        ["Title", wo.title],
        ["Program", wo.program],
        ["Site", wo.warehouse.name],
        ["Created", fmtDate(wo.created_at)],
        ["Production start", <StartDate key="s" date={wo.production_start_date} days={wo.days_to_start} />],
        ["Build quantity", wo.build_qty],
        ["Parts staged", `${wo.kit.staged} of ${wo.kit.lines}`],
      ]} />

      <SubTable title="Requirements" actions={
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="attention">Attention needed <span className="text-xs text-zinc-400">{attention.length}</span></TabsTrigger>
            <TabsTrigger value="all">All requirements <span className="text-xs text-zinc-400">{wo.items.length}</span></TabsTrigger>
          </TabsList>
        </Tabs>
      }>
        <Requirements wo={wo} items={filter === "attention" ? attention : wo.items} />
      </SubTable>

      {wo.fixture_requirements.length > 0 && (
        <div id="fixtures" className="scroll-mt-16">
          <SubTable title="Fixtures">
            <DataTable bare data={wo.fixture_requirements} columns={fixtureColumns(setFixtureOpen)} getRowId={(r) => r.id} />
          </SubTable>
        </div>
      )}
      {openExc.length > 0 && (
        <SubTable title={<>Issues <Badge tone="amber">{openExc.length}</Badge></>}>
          <DataTable bare data={openExc} columns={issueColumns} getRowId={(r) => r.id} />
        </SubTable>
      )}

      <SubTable title="History" actions={<Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide" : "Show"}</Button>}>
        {showHistory && (
          <div className="divide-y text-sm">
            {wo.history.map((h) => (
              <div key={h.id} className="flex gap-3 px-3 py-1.5">
                <span className="w-32 shrink-0 text-xs text-zinc-500">{fmtDateTime(h.at)}</span>
                <span className="flex-1">{h.summary}</span>
                <span className="text-xs text-zinc-400">{h.actor}</span>
              </div>
            ))}
          </div>
        )}
      </SubTable>
      {wo.cancel_reason && <p className="text-sm text-zinc-500">Canceled: {wo.cancel_reason}</p>}
      {fixtureOpen && <FixtureReview f={wo.fixture_requirements.find((f) => f.id === fixtureOpen)!} onClose={() => setFixtureOpen(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ requirements: one action-bearing row each

const SHORT_NAMES: Record<string, string> = {
  awaiting_qa: "awaiting QA", awaiting_receipt: "awaiting receipt", on_order: "on order", transfer_in_transit: "transfer in transit",
  arrives_late: "arriving late", arrival_unknown: "date unknown", short: "short", stock_at_other_site: "stock at another site",
  allocation_decision: "allocation decision", ready_to_stage: "available", staged: "staged",
};

function Requirements({ wo, items }: { wo: WorkOrderDetail; items: ItemReadiness[] }) {
  const col = createColumnHelper<ItemReadiness>();
  const columns = [
    col.accessor("part_number", {
      header: "Part",
      cell: (c) => <div><div className="font-medium whitespace-nowrap">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
    }),
    col.accessor("required", { header: "Needed", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    col.accessor("state", {
      header: "Current situation",
      cell: (c) => {
        const [primary, ...rest] = c.row.original.situations;
        return (
          <div className="space-y-0.5">
            <SituationText s={primary} strong />
            {rest.length > 0 && <div className="text-xs text-zinc-500">also {rest.map((s) => `${s.qty} ${SHORT_NAMES[s.kind] ?? s.kind}`).join(", ")}</div>}
          </div>
        );
      },
    }),
    col.display({
      id: "act", header: "Next action",
      cell: (c) => {
        const it = c.row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {it.action && <NextActionButton action={{ ...it.action, item_id: it.item_id, part_id: it.part_id, part_number: it.part_number }} woId={wo.id} />}
            {wo.state !== "canceled" && it.required > 0 && <ReduceMenu it={it} />}
          </div>
        );
      },
    }),
  ];
  return (
    <DataTable bare data={items} columns={columns} getRowId={(r) => r.item_id}
      empty="Nothing needs attention. Switch to All requirements to see every part."
      renderSubRow={(it) => <RequirementDetail it={it} wo={wo} />} />
  );
}

function ReduceMenu({ it }: { it: ItemReadiness }) {
  const reduce = useAction<{ new_required_qty: number }>(`/work-order-items/${it.item_id}/reduce`, { success: "Requirement reduced" });
  return (
    <MoreMenu>
      <PromptDialog title={`Reduce ${it.part_number}`} label="New required quantity" inputType="number" initial={String(it.required)} confirm="Reduce"
        description="Unused allocations above the new quantity are released; picked or staged units never are."
        trigger={<button className="rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100">Reduce requirement…</button>}
        onSubmit={(v, close) => reduce.mutate({ new_required_qty: Number(v) }, { onSuccess: close })} />
    </MoreMenu>
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

/** Expanded row: secondary situations with their own actions, then the allocations behind them. */
function RequirementDetail({ it, wo }: { it: ItemReadiness; wo: WorkOrderDetail }) {
  const secondary = it.situations.slice(1);
  return (
    <div className="space-y-3">
      {secondary.length > 0 && (
        <div className="divide-y rounded-md border bg-white">
          {secondary.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <SituationText s={s} />
              {s.action && <NextActionButton action={{ ...s.action, item_id: it.item_id, part_id: it.part_id, part_number: it.part_number }} woId={wo.id} />}
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-md border bg-white">
        <DataTable bare data={it.sources} columns={sourceColumns} getRowId={(r) => r.allocation_id}
          empty={it.available_to_allocate !== undefined ? `Nothing allocated (draft). ${it.available_to_allocate} available to allocate at this site.` : "Nothing allocated."} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fixtures and issues

function fixtureColumns(onReview: (id: string) => void) {
  const fcol = createColumnHelper<Fixture>();
  return [
    fcol.accessor("operation", { header: "Operation" }),
    fcol.accessor("fixture_type", { header: "Fixture", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    fcol.accessor("quantity", { header: "Qty", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    fcol.accessor("coverage_state", {
      header: "Coverage",
      cell: (c) => <span className={c.getValue() === "covered" ? "text-green-700" : c.getValue() === "action_needed" ? "text-red-700" : "text-amber-700"}>
        {c.getValue() === "pending" ? "Not confirmed" : titleCase(c.getValue())}</span>,
    }),
    fcol.accessor("note", { header: "Note", cell: (c) => <span className="text-xs text-zinc-600">{c.getValue()}</span> }),
    fcol.display({
      id: "act", header: "",
      cell: (c) => <div className="flex justify-end"><Button size="sm" variant={c.row.original.coverage_state === "covered" ? "ghost" : "outline"}
        onClick={() => onReview(c.row.original.id)}>{c.row.original.coverage_state === "covered" ? "Edit" : "Confirm fixture coverage"}</Button></div>,
    }),
  ];
}

function FixtureReview({ f, onClose }: { f: Fixture; onClose: () => void }) {
  const [state, setState] = useState<string>(f.coverage_state === "pending" ? "covered" : f.coverage_state);
  const [note, setNote] = useState(f.note ?? "");
  const review = useAction<{ coverage_state: string; note: string }>(`/fixture-requirements/${f.id}/review`,
    { success: "Fixture coverage recorded", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={`Fixture coverage · ${f.fixture_type} × ${f.quantity}`} description="Coverage at the facility does not confirm the fixtures are free when needed." />
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={review.isPending} onClick={() => review.mutate({ coverage_state: state, note })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ecol = createColumnHelper<MaterialException>();
const issueColumns = [
  ecol.accessor("label", { header: "Issue", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  ecol.accessor("title", { header: "Summary", cell: (c) => <span className="text-xs" title={c.row.original.detail ?? undefined}>{c.getValue()}</span> }),
  ecol.display({ id: "act", header: "", cell: (c) => <div className="flex justify-end"><ExceptionActions exc={c.row.original} /></div> }),
];
