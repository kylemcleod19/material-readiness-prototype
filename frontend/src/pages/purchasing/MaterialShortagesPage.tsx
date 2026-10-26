import { createColumnHelper } from "@tanstack/react-table";
import { GitCompareArrows } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { useAction, usePurchasingQueue } from "@/api/hooks";
import type { MaterialShortage } from "@/api/types";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate, WoChips } from "@/components/domain";
import { Button } from "@/components/ui/button";

const col = createColumnHelper<MaterialShortage>();

export function MaterialShortagesTable({ rows }: { rows: MaterialShortage[] }) {
  const navigate = useNavigate();
  const create = useAction<{ po_line_id: string }, { scenario_id: string }>("/scenarios", {
    onSuccess: (r) => navigate(`/scenarios/${r.scenario_id}`),
  });
  const columns = [
    col.accessor("part_number", {
      header: "Part",
      cell: (c) => <div><div className="font-medium">{c.getValue()}</div><div className="text-xs text-zinc-500">{c.row.original.description}</div></div>,
    }),
    col.accessor("supplier", { header: "Supplier" }),
    col.accessor("label", { header: "PO line", cell: (c) => <Link className="whitespace-nowrap text-blue-700 hover:underline" to={`/purchasing/pos/${c.row.original.po_id}`}>{c.getValue()}</Link> }),
    col.accessor("allocated", { header: "Allocated to orders", ...right, cell: (c) => <Num v={c.getValue()} /> }),
    col.accessor("available", { header: "Available", ...right, cell: (c) => <Num v={c.getValue()} tone="green" /> }),
    col.accessor((r) => r.in_qa + r.not_received, { id: "on_order", header: "Still on order", ...right, cell: (c) => <Num v={c.getValue()} tone="blue" /> }),
    col.accessor("scrapped", { header: "Scrapped", ...right, cell: (c) => <Num v={c.getValue()} tone="violet" /> }),
    col.accessor("short", { header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
    col.display({
      id: "affected", header: "Work orders (allocated)",
      cell: (c) => <WoChips items={c.row.original.affected.map((a) => ({ id: a.work_order_id, number: a.work_order_number, extra: a.allocated_qty }))} />,
    }),
    col.accessor("earliest_start", { header: "Earliest start", cell: (c) => (c.getValue() ? <StartDate date={c.getValue()!} /> : null) }),
    col.display({
      id: "act", header: "",
      cell: (c) => {
        const s = c.row.original;
        return s.draft_scenario_id ? (
          <Button asChild size="sm" variant="outline"><Link to={`/scenarios/${s.draft_scenario_id}`}><GitCompareArrows />Continue</Link></Button>
        ) : (
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate({ po_line_id: s.po_line_id })}><GitCompareArrows />Decide split</Button>
        );
      },
    }),
  ];
  return <DataTable data={rows} columns={columns} getRowId={(r) => r.po_line_id} empty="No material shortages." />;
}

export function MaterialShortagesPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Material shortages" subtitle="Supply allocated to more work orders than it can now cover."
        info="Usually caused by a short delivery or QA scrapping part of a receipt. No order is chosen to lose material automatically: decide the split in a scenario, then apply it." />
      <QueryView q={q}>{(d) => <MaterialShortagesTable rows={d.material_shortages} />}</QueryView>
    </div>
  );
}
