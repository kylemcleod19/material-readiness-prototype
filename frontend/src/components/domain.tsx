import { AlertTriangle, CircleHelp, Clock, Info, Loader2, PackageCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Outlook, Situation, SituationKind, Timing } from "@/api/types";
import { Badge, Callout, type Tone } from "@/components/ui/primitives";
import { cn, fmtDate, fmtDateTime, relDays } from "@/lib/utils";

// ------------------------------------------------------------------ schedule outlook & situations (PRD 5.4)

const OUTLOOK: Record<Outlook, { tone: Tone; label: string }> = {
  kit_ready: { tone: "green", label: "Kit ready" },
  on_track: { tone: "blue", label: "On track" },
  unknown: { tone: "neutral", label: "Unknown" },
  at_risk: { tone: "red", label: "At risk" },
  draft: { tone: "neutral", label: "Draft" },
  canceled: { tone: "neutral", label: "Canceled" },
};

/** Can this work order meet its production start? Separate from who has a task. */
export function OutlookBadge({ outlook }: { outlook: Outlook }) {
  const o = OUTLOOK[outlook];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

const SITUATION_TONE: Record<SituationKind, string> = {
  allocation_decision: "text-amber-700", short: "text-red-700", stock_at_other_site: "text-violet-700",
  arrives_late: "text-red-700", arrival_unknown: "text-zinc-600", awaiting_receipt: "text-blue-700",
  awaiting_qa: "text-amber-700", on_order: "text-blue-700", transfer_in_transit: "text-blue-700",
  ready_to_stage: "text-green-700", staged: "text-zinc-700", not_reserved: "text-zinc-500", canceled: "text-zinc-500",
};

/** Operator wording for one situation (PRD 1a, 5.4). */
export function situationText(s: Pick<Situation, "kind" | "qty" | "date" | "detail">): string {
  const on = s.date ? fmtDate(s.date) : null;
  switch (s.kind) {
    case "allocation_decision":
      return s.detail === "received" ? `${s.qty} received — allocation decision needed` : "Allocation decision needed";
    case "short": return `Short ${s.qty}`;
    case "stock_at_other_site": return `Stock at another site${s.detail ? ` (${s.detail})` : ""}`;
    case "arrives_late": return `${s.qty} arrive ${on ?? "after start"} — after production start`;
    case "arrival_unknown": return "Arrival date unknown";
    case "awaiting_receipt": return "Arrived — awaiting receipt";
    case "awaiting_qa": return `${s.qty} awaiting QA`;
    case "on_order": return `${s.qty} on order${on ? ` — arriving ${on}` : s.detail === "multiple arrivals" ? " — multiple arrivals" : ""}`;
    case "transfer_in_transit": return `Transfer in transit${on ? ` — arriving ${on}` : ""}`;
    case "ready_to_stage": return "Available — not staged";
    case "staged": return "Staged";
    case "not_reserved": return "Not allocated (draft)";
    case "canceled": return "Canceled";
  }
}

/** A situation as plain colored text; badges are reserved for the outlook. */
export function SituationText({ s, strong }: { s: Pick<Situation, "kind" | "qty" | "date" | "detail">; strong?: boolean }) {
  return <span className={cn("text-sm", SITUATION_TONE[s.kind], strong && "font-medium")}>{situationText(s)}</span>;
}

/** Key facts as labeled fields instead of a run-on subheading. */
export function FactList({ facts, className }: { facts: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-7", className)}>
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-zinc-500">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium text-zinc-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const TIMING: Record<Timing, { tone: Tone; label: string; icon: ReactNode } | null> = {
  none: null,
  on_time: { tone: "green", label: "Before start", icon: <Clock /> },
  unknown: { tone: "neutral", label: "Date unknown", icon: <CircleHelp /> },
  timing_review: { tone: "amber", label: "Partly after start", icon: <AlertTriangle /> },
  late: { tone: "red", label: "After start", icon: <AlertTriangle /> },
};

export function TimingBadge({ timing, lateQty }: { timing: Timing; lateQty?: number }) {
  const t = TIMING[timing];
  if (!t) return null;
  return (
    <Badge tone={t.tone} title="Expected arrival compared with production start. Arriving before start is not a staging guarantee.">
      {t.icon}
      {t.label}
      {lateQty ? ` · ${lateQty}` : ""}
    </Badge>
  );
}

const CATEGORY: Record<string, { tone: Tone; label: string }> = {
  incoming: { tone: "blue", label: "On order" },
  available: { tone: "green", label: "Available" },
  picked: { tone: "green", label: "Picked" },
  staged: { tone: "dark", label: "Staged" },
  remote_hold: { tone: "violet", label: "At another site" },
  review: { tone: "amber", label: "Decision needed" },
  blocked: { tone: "red", label: "Not available" },
};

export function CategoryBadge({ category }: { category: string }) {
  const c = CATEGORY[category] ?? { tone: "neutral" as Tone, label: category };
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

export function StartDate({ date, days }: { date: string; days?: number }) {
  return (
    <span className="whitespace-nowrap tabular">
      <span className="font-medium">{fmtDate(date)}</span>
      {days !== undefined && <span className={cn("ml-1 text-xs", days < 7 ? "text-amber-700" : "text-zinc-500")}>{relDays(days)}</span>}
    </span>
  );
}

const BASIS: Record<string, string> = {
  supplier_promise: "supplier promise",
  carrier_estimate: "carrier estimate",
  buyer_estimate: "buyer estimate",
};

/** Expected arrival with where it came from and when it was last updated. */
export function ArrivalInfo({ date, basis, channel, updatedAt, compact }: {
  date: string | null; basis?: string | null; channel?: string; updatedAt?: string | null; compact?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 tabular">
      <Truck className="size-3.5 text-zinc-400" />
      <span className={cn("font-medium", !date && "text-zinc-500 italic")}>{fmtDate(date)}</span>
      {!compact && (basis || channel) && (
        <span className="text-xs text-zinc-500">
          {basis ? BASIS[basis] ?? basis : ""}
          {channel && channel !== "seed" ? ` · ${channel}` : ""}
          {updatedAt ? ` · ${fmtDateTime(updatedAt)}` : ""}
        </span>
      )}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <Callout tone="red" icon={<AlertTriangle />} className="m-4">
      {error instanceof Error ? error.message : "Something went wrong"}
    </Callout>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-zinc-500">
      {icon ?? <PackageCheck className="size-4" />}
      {children}
    </div>
  );
}

/** Render children once a query has data; otherwise its loading or error state. */
export function QueryView<T>({ q, children }: { q: { data?: T; isLoading: boolean; error: unknown }; children: (d: T) => ReactNode }) {
  if (q.error) return <ErrorState error={q.error} />;
  if (q.isLoading || q.data === undefined) return <Loading />;
  return <>{children(q.data)}</>;
}

/** Title, one short subtitle line, and longer rule explanations behind an info tooltip. */
export function PageHeader({ title, subtitle, info, actions }: {
  title: ReactNode; subtitle?: ReactNode; info?: string; actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          {info && (
            <span title={info} className="cursor-help text-zinc-400 hover:text-zinc-600" aria-label={info}>
              <Info className="size-4" />
            </span>
          )}
        </h1>
        {subtitle && <div className="mt-0.5 text-sm text-zinc-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Small linked chips for work orders, used in table cells. */
export function WoChips({ items }: { items: { id: string; number: string; extra?: ReactNode }[] }) {
  if (items.length === 0) return <span className="text-zinc-300">·</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((w, i) => (
        <Link key={`${w.id}-${i}`} to={`/work-orders/${w.id}`} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs whitespace-nowrap hover:bg-zinc-200">
          {w.number}{w.extra ? <span className="text-zinc-500"> · {w.extra}</span> : null}
        </Link>
      ))}
    </div>
  );
}

