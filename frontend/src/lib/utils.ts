import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date (yyyy-mm-dd) → "Dec 3". Dates are business dates; never shifted by timezone. */
export function fmtDate(iso?: string | null, withYear = false): string {
  if (!iso) return "unknown";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relDays(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}

export function newOpId(): string {
  return crypto.randomUUID();
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\bqa\b/gi, "QA").replace(/^\w/, (c) => c.toUpperCase());
}
