import { AlertTriangle, CircleHelp, Clock, Info, Loader2, PackageCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Outlook, ReqState, Timing } from "@/api/types";
import { Badge, Callout, type Tone } from "@/components/ui/primitives";
import { cn, fmtDate, fmtDateTime, relDays } from "@/lib/utils";

// ------------------------------------------------------------------ outlook & requirement status (PRD §5.4)

const OUTLOOK: Record<Outlook, { tone: Tone; label: string }> = {
  ready: { tone: "green", label: "Ready" },
  on_track: { tone: "blue", label: "On track" },
  at_risk: { tone: "amber", label: "At risk" },
  action_needed: { tone: "red", label: "Action needed" },
  not_reserved: { tone: "neutral", label: "Draft" },
  canceled: { tone: "neutral", label: "Canceled" },
};

/** Can this work order meet its production start? */
export function OutlookBadge({ outlook }: { outlook: Outlook }) {
  const o = OUTLOOK[outlook];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export interface StatusInput { state: ReqState; short?: number; expected?: string | null; late_qty?: number }

const REQ_STATE: Record<ReqState, { tone: Tone; label: (s: StatusInput) => string }> = {
  short: { tone: "red", label: (s) => `Short ${s.short ?? ""}`.trim() },
  decision_needed: { tone: "amber", label: () => "Shortage — decision needed" },
  transfer_decision: { tone: "violet", label: () => "Stock at another site" },
  arrives_late: { tone: "red", label: (s) => (s.expected ? `Arrives ${fmtDate(s.expected)} — after start` : "Arrives after start") },
  arrival_unknown: { tone: "neutral", label: () => "Arrival date unknown" },
  on_order: { tone: "blue", label: (s) => (s.expected ? `Arriving ${fmtDate(s.expected)}` : "On order") },
  ready_to_stage: { tone: "green", label: () => "Available — not staged" },
  staged: { tone: "dark", label: () => "Staged" },
  not_reserved: { tone: "neutral", label: () => "Not reserved (draft)" },
  canceled: { tone: "neutral", label: () => "Canceled" },
};

/** The one status a requirement has; replaces a column per quantity bucket. */
export function ReqStatus(s: StatusInput) {
  const r = REQ_STATE[s.state];
  return <Badge tone={r.tone}>{r.label(s)}</Badge>;
}

/** Short plain-language breakdown of how a requirement is covered, e.g. "10 available · 20 short". */
export function CoverageText({ staged = 0, available = 0, onOrder = 0, otherSite = 0, decision = 0, short = 0 }: {
  staged?: number; available?: number; onOrder?: number; otherSite?: number; decision?: number; short?: number;
}) {
  const parts: [number, string, string][] = [
    [staged, "staged", "text-zinc-700"],
    [available - staged, "available", "text-green-700"],
    [onOrder, "on order", "text-blue-700"],
    [otherSite, "at another site", "text-violet-700"],
    [decision, "need a decision", "text-amber-700"],
    [short, "short", "text-red-700"],
  ];
  const shown = parts.filter(([n]) => n > 0);
  if (!shown.length) return <span className="text-zinc-400">nothing allocated</span>;
  return (
    <span className="text-xs tabular">
      {shown.map(([n, label, color], i) => (
        <span key={label}>{i > 0 && <span className="text-zinc-300"> · </span>}<span className={color}><b>{n}</b> {label}</span></span>
      ))}
    </span>
  );
}

/** Key facts as labeled fields instead of a run-on subheading. */
export function FactList({ facts, className }: { facts: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6", className)}>
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

