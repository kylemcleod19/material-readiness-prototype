import { createColumnHelper } from "@tanstack/react-table";
import { PackageCheck } from "lucide-react";

import { useAction } from "@/api/hooks";
import type { PickTask } from "@/api/types";
import { PromptDialog } from "@/components/actions";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/utils";
import { taskColumns } from "./PickListPage";
import { MobileRow, WarehouseScreen } from "./shared";

function StageAction({ t, size = "sm" }: { t: PickTask; size?: "sm" | "lg" }) {
  const stage = useAction<{ location: string }>(`/inventory/${t.inventory_record_id}/stage`, { success: `${t.part_number} staged for ${t.work_order_number}` });
  return (
    <PromptDialog title="Stage to kit" label="Staging location" initial={`KIT-${t.work_order_number.replace("WO-", "")}`} confirm="Stage"
      trigger={<Button size={size} variant="outline"><PackageCheck />Stage</Button>}
      onSubmit={(location, close) => stage.mutate({ location }, { onSuccess: close })} />
  );
}

const col = createColumnHelper<PickTask>();

export function StagePage() {
  return (
    <WarehouseScreen title="Stage" subtitle="Picked material waiting to move into its kit."
      info="Staging changes location and stage only. Staged material stays reserved and still counts once.">
      {(d) => (
        <DataTable data={d.stage} getRowId={(r) => r.allocation_id} initialSort={[{ id: "start", desc: false }]} empty="Nothing waiting to stage."
          columns={[...taskColumns.filter((c) => (c as { accessorKey?: string }).accessorKey !== "blocked"),
            col.display({ id: "act", header: "", cell: (c) => <StageAction t={c.row.original} /> })]}
          mobileCard={(t) => <MobileRow title={`${t.qty} ${t.part_number}`} meta={`${t.work_order_number} · start ${fmtDate(t.production_start_date)} · at ${t.location}`} action={<StageAction t={t} size="lg" />} />} />
      )}
    </WarehouseScreen>
  );
}
