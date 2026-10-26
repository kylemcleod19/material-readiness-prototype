import {
  AlertOctagon, Boxes, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList,
  GitCompareArrows, Menu, PackageOpen, PackagePlus, ShoppingCart, Truck, Warehouse, X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useMaster, usePurchasingQueue, useQAQueue, useWarehouseQueue } from "@/api/hooks";
import type { Role } from "@/api/types";
import { ActionHost } from "@/components/ActionHost";
import { DemoPanel } from "@/components/DemoPanel";
import { ROLE_HOME, ROLE_LABELS, useRole } from "@/lib/role";
import { cn, fmtDate } from "@/lib/utils";
import { useWarehouseChoice } from "@/lib/warehouse";

type Counts = Record<string, number | undefined>;
interface NavItem { to: string; label: string; icon: LucideIcon; count?: string; end?: boolean; tone?: "red" | "amber" | "neutral" }
interface NavGroup { label?: string; items: NavItem[] }

const NAV: Record<Role, NavGroup[]> = {
  planning: [
    { items: [
      { to: "/work-orders", label: "Work orders", icon: ClipboardList },
      { to: "/allocate", label: "Allocate material", icon: GitCompareArrows, count: "allocate_material", tone: "amber" },
    ] },
    { label: "Reference", items: [
      { to: "/exceptions", label: "Issues", icon: AlertOctagon, count: "issues", tone: "neutral" },
    ] },
  ],
  purchasing: [
    { label: "Work queues", items: [
      { to: "/purchasing/source", label: "Source material", icon: PackagePlus, count: "source_material", tone: "red" },
      { to: "/purchasing/follow-up", label: "Supplier follow-up", icon: CalendarClock, count: "supplier_follow_up", tone: "amber" },
      { to: "/allocate", label: "Allocate material", icon: GitCompareArrows, count: "allocate_material", tone: "amber" },
    ] },
    { label: "Reference", items: [
      { to: "/purchasing/pos", label: "Purchase orders", icon: ShoppingCart },
      { to: "/work-orders", label: "Work orders", icon: ClipboardList },
      { to: "/warehouse/inventory", label: "Inventory", icon: Warehouse },
      { to: "/exceptions", label: "Issues", icon: AlertOctagon, count: "issues", tone: "neutral" },
    ] },
  ],
  warehouse: [
    { items: [
      { to: "/warehouse", label: "Arrivals", icon: Truck, end: true, count: "arrivals", tone: "neutral" },
      { to: "/warehouse/putaway", label: "Put away", icon: PackageOpen, count: "putaway", tone: "neutral" },
      { to: "/warehouse/pick", label: "Pick", icon: ClipboardCheck, count: "picks", tone: "neutral" },
      { to: "/warehouse/stage", label: "Stage", icon: Boxes, count: "stage", tone: "neutral" },
      { to: "/warehouse/inventory", label: "Inventory", icon: Warehouse },
    ] },
  ],
  qa: [
    { items: [
      { to: "/qa", label: "QA queue", icon: ClipboardCheck, end: true, count: "qa", tone: "amber" },
      { to: "/warehouse/inventory", label: "Inventory", icon: Warehouse },
    ] },
  ],
};

function useNavCounts(role: Role): Counts {
  const [wh] = useWarehouseChoice();
  const office = role === "purchasing" || role === "planning";
  const pq = usePurchasingQueue({ enabled: office });
  const wq = useWarehouseQueue(wh, { enabled: role === "warehouse" });
  const qa = useQAQueue({ enabled: role === "qa" });
  const c: Counts = { ...(pq.data?.counts ?? {}) } as Counts;
  if (wq.data) {
    c.arrivals = wq.data.arrivals.length + wq.data.transfers.length;
    c.putaway = wq.data.putaway.length;
    c.picks = wq.data.picks.length;
    c.stage = wq.data.stage.length;
  }
  if (qa.data) c.qa = qa.data.length;
  return c;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, setRole } = useRole();
  const navigate = useNavigate();
  const counts = useNavCounts(role);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4 font-semibold">
        <Boxes className="size-5" /> Material Readiness
      </div>
      <div className="px-3 pb-3">
        <select aria-label="Demo role" value={role}
          className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm"
          onChange={(e) => { const r = e.target.value as Role; setRole(r); navigate(ROLE_HOME[r]); onNavigate?.(); }}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {NAV[role].map((g, gi) => (
          <div key={gi}>
            {g.label && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map((n) => {
                const count = n.count ? counts[n.count] : undefined;
                return (
                  <NavLink key={n.to} to={n.to} end={n.end ?? true} onClick={onNavigate}
                    className={({ isActive }) => cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100")}>
                    {({ isActive }) => (
                      <>
                        <n.icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{n.label}</span>
                        {count ? (
                          <span className={cn("min-w-5 rounded px-1.5 text-center text-xs font-semibold tabular",
                            isActive ? "bg-white/20 text-white"
                              : n.tone === "red" ? "bg-red-100 text-red-800"
                              : n.tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-zinc-200 text-zinc-700")}>
                            {count}
                          </span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

export function Layout() {
  const master = useMaster();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:pl-56">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 border-r bg-white lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button className="absolute right-2 top-3 rounded p-1 text-zinc-500" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-white/95 px-4 backdrop-blur">
        <button className="rounded p-1 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
        <span className="font-semibold lg:hidden">Material Readiness</span>
        <div className="ml-auto flex items-center gap-2">
          {master.data && (
            <span className="hidden items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200 sm:inline-flex"
              title="Fixed demo clock so due/overdue states don't drift">
              <CalendarDays className="size-3.5" /> Demo date {fmtDate(master.data.today, true)}
            </span>
          )}
          <DemoPanel />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <ActionHost><Outlet /></ActionHost>
      </main>
    </div>
  );
}

