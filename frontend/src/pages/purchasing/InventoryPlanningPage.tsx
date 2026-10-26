import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { usePurchasingQueue } from "@/api/hooks";
import type { PurchasingQueue } from "@/api/types";
import { RemoteHoldActions } from "@/components/actions";
import { DataTable, Num, right } from "@/components/DataTable";
import { PageHeader, QueryView, StartDate, WoChips } from "@/components/domain";

type Row = PurchasingQueue["remote_holds"][number];
const col = createColumnHelper<Row>();

const columns = [
  col.accessor("work_order_number", {
    header: "Work order",
    cell: (c) => <Link className="font-medium text-blue-700 hover:underline" to={`/work-orders/${c.row.original.work_order_id}`}>{c.getValue()}</Link>,
  }),
  col.accessor((r) => r.warehouse.name, { id: "for", header: "Needed at" }),
  col.accessor("production_start_date", { header: "Production start", cell: (c) => <StartDate date={c.getValue()} /> }),
  col.accessor("part_number", { header: "Part", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  col.accessor("qty", { header: "Held for this order", ...right, cell: (c) => <Num v={c.getValue()} tone="violet" /> }),
  col.accessor((r) => r.source_warehouse.name, { id: "from", header: "Stock is at" }),
  col.display({
    id: "competing", header: "Other demand at that site",
    cell: (c) => <WoChips items={c.row.original.competing_demand.map((x) => ({ id: x.work_order_id, number: x.work_order_number, extra: x.required }))} />,
  }),
  col.accessor((r) => r.supplier?.name ?? "", { id: "supplier", header: "Supplier if buying", cell: (c) => c.getValue() || <span className="text-zinc-400">none set</span> }),
  col.display({
    id: "act", header: "",
    cell: (c) => <RemoteHoldActions allocationId={c.row.original.allocation_id} qty={c.row.original.qty} source={c.row.original.source_warehouse} />,
  }),
];

export function InventoryPlanningPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Inventory planning queue" subtitle="Stock exists at another site. Transfer it here, or buy instead."
        info="When a work order is finalized and its site has no stock, matching stock at other sites is held for it. A hold does not make the order ready. 'Buy instead' releases the hold and moves the requirement to the purchasing queue." />
      <QueryView q={q}>
        {(d) => <DataTable data={d.remote_holds} columns={columns} getRowId={(r) => r.allocation_id} empty="No decisions waiting." />}
      </QueryView>
    </div>
  );
}
