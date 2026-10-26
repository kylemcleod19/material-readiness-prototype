import {
  type ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, type SortingState, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { Empty } from "@/components/domain";
import { Card, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface DataTableProps<T> {
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  empty?: ReactNode;
  /** Shows a quick-filter box over all accessor columns. */
  filterPlaceholder?: string;
  initialSort?: SortingState;
  onRowClick?: (row: T) => void;
  /** Expandable detail under a row. */
  renderSubRow?: (row: T) => ReactNode;
  defaultExpanded?: (row: T) => boolean;
  /** Below the sm breakpoint, render each row as a card instead of a table row. */
  mobileCard?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  className?: string;
  bare?: boolean;
}

export function DataTable<T>({
  data, columns, getRowId, empty = "Nothing here.", filterPlaceholder, initialSort = [], onRowClick, renderSubRow,
  defaultExpanded, mobileCard, toolbar, className, bare,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    defaultExpanded ? Object.fromEntries(data.filter(defaultExpanded).map((r) => [getRowId(r), true])) : {});
  const table = useReactTable({
    data, columns, getRowId: (r) => getRowId(r),
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const colCount = columns.length + (renderSubRow ? 1 : 0);
  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper className={cn("overflow-hidden", className)}>
      {(filterPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2">
          {filterPlaceholder && (
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 size-4 text-zinc-400" />
              <Input className="h-9 pl-8" placeholder={filterPlaceholder} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}
      {rows.length === 0 ? <Empty>{empty}</Empty> : (
        <>
          {mobileCard && (
            <div className="divide-y sm:hidden">
              {rows.map((r) => <div key={r.id} className="p-3">{mobileCard(r.original)}</div>)}
            </div>
          )}
          <div className={cn("w-full overflow-x-auto", mobileCard && "hidden sm:block")}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {renderSubRow && <th className="w-8 border-b border-zinc-200" />}
                    {hg.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      const align = (h.column.columnDef.meta as { align?: string } | undefined)?.align;
                      return (
                        <th key={h.id} className={cn("border-b border-zinc-200 px-3 py-2 text-left text-xs font-medium text-zinc-500 whitespace-nowrap", align === "right" && "text-right")}>
                          {h.isPlaceholder ? null : h.column.getCanSort() ? (
                            <button className={cn("inline-flex items-center gap-1 hover:text-zinc-900", align === "right" && "flex-row-reverse")}
                              onClick={h.column.getToggleSortingHandler()}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                            </button>
                          ) : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = !!expanded[r.id];
                  return (
                    <Fragment key={r.id}>
                      <tr className={cn("hover:bg-zinc-50/80", onRowClick && "cursor-pointer", open && "bg-zinc-50/60")}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
                          if (onRowClick) onRowClick(r.original);
                          else if (renderSubRow) setExpanded({ ...expanded, [r.id]: !open });
                        }}>
                        {renderSubRow && (
                          <td className="border-b border-zinc-100 pl-2 align-middle">
                            <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100" aria-label={open ? "Collapse" : "Expand"}
                              onClick={() => setExpanded({ ...expanded, [r.id]: !open })}>
                              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          </td>
                        )}
                        {r.getVisibleCells().map((c) => {
                          const align = (c.column.columnDef.meta as { align?: string } | undefined)?.align;
                          return (
                            <td key={c.id} className={cn("border-b border-zinc-100 px-3 py-2 align-middle", align === "right" && "text-right tabular")}>
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </td>
                          );
                        })}
                      </tr>
                      {renderSubRow && open && (
                        <tr>
                          <td colSpan={colCount} className="border-b border-zinc-200 bg-zinc-50/60 px-4 py-3 pl-11">{renderSubRow(r.original)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Wrapper>
  );
}

/** Right-aligned quantity; zero renders as a muted dot so non-zero values stand out. */
export function Num({ v, tone }: { v: number | null | undefined; tone?: "green" | "dark" | "blue" | "violet" | "amber" | "red" }) {
  if (!v) return <span className="text-zinc-300">·</span>;
  const color = {
    green: "text-green-700", dark: "text-green-900", blue: "text-blue-700", violet: "text-violet-700",
    amber: "text-amber-700", red: "text-red-700",
  }[tone ?? "green"];
  return <span className={cn("font-medium tabular", tone ? color : "text-zinc-900")}>{v}</span>;
}

export const right = { meta: { align: "right" } } as const;

/** A titled, bordered frame for a secondary table inside a detail page or expanded row. */
export function SubTable({ title, children, actions, className }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm", className)}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600">
        <span className="flex items-center gap-2">{title}</span>{actions}
      </div>
      {children}
    </div>
  );
}
