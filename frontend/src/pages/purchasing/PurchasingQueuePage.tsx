import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { PurchasingQueue } from "@/api/types";
import { AssignSupplyDialog, PurchaseDialog } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate, WoChips } from "@/components/domain";
import { Button } from "@/components/ui/button";

type Row = PurchasingQueue["uncovered"][number];
const col = createColumnHelper<Row>();

const columns = [
  col.accessor("work_order_number", {
    header: "Work order",
    cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor((r) => r.warehouse.name, { id: "site", header: "Site" }),
  col.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Supplier", cell: (c) => c.getValue() || <span className="text-zinc-400">none set</span> }),
  col.accessor("uncovered", { header: "Short", ...right, cell: (c) => <Num v={c.getValue()} tone="red" /> }),
  col.accessor("unassigned_here", {
    header: () => <span title="Stock or open PO quantity at this site that no other work order is using. Assign it before buying more.">Unassigned at site</span>,
    ...right, cell: (c) => <Num v={c.getValue()} tone="green" />,
  }),
  col.display({
    id: "other", header: "Also short",
    cell: (c) => <WoChips items={c.row.original.other_demand.filter((d) => d.state === "finalized")
      .map((d) => ({ id: d.work_order_id, number: d.work_order_number, extra: `${d.uncovered} @ ${d.warehouse.code}` }))} />,
  }),
  col.display({
    id: "act", header: "",
    cell: (c) => {
      const u = c.row.original;
      const sameSite = u.other_demand.filter((x) => x.warehouse.id === u.warehouse.id && x.state === "finalized");
      return (
        <div className="flex justify-end gap-2">
          {u.unassigned_here > 0 && (
            <AssignSupplyDialog itemId={u.work_order_item_id} partNumber={u.part_number} uncovered={u.uncovered} options={u.options}
              trigger={<Button size="sm" variant="outline">Assign</Button>} />
          )}
          <PurchaseDialog partId={u.part_id} partNumber={u.part_number} destination={u.warehouse} defaultSupplierId={u.supplier?.id}
            demand={[{ work_order_item_id: u.work_order_item_id, work_order_id: u.work_order_id, work_order_number: u.work_order_number,
              state: "finalized", warehouse: u.warehouse, production_start_date: u.production_start_date, required: u.required,
              uncovered: u.uncovered }, ...sameSite]}
            trigger={<Button size="sm">{sameSite.length ? `Buy (combine ${sameSite.length + 1})` : `Buy ${u.uncovered}`}</Button>} />
        </div>
      );
    },
  }),
];

export function PurchasingQueuePage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Purchasing queue" subtitle="Work-order requirements with no supply. Assign what's already here, or buy."
        info="Assigning open PO quantity makes the requirement on order, not ready. Buying for several orders at the same site can be combined into one PO line; each order keeps its own quantity and date." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.uncovered} columns={columns} getRowId={(r) => r.work_order_item_id}
          filterPlaceholder="Filter by work order, part, or supplier" empty="Nothing to buy — every finalized requirement has supply." />}
      </QueryView>
    </div>
  );
}
