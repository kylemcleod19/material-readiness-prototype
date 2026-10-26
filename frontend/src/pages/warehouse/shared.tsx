import type { ReactNode } from "react";

import { useWarehouseQueue } from "@/api/hooks";
import type { WarehouseQueue } from "@/api/types";
import { PageHeader, QueryView } from "@/components/domain";
import { Select } from "@/components/ui/primitives";
import { useWarehouseChoice } from "@/lib/warehouse";

export function WarehousePicker({ value, onChange, warehouses }: { value: string; onChange: (v: string) => void; warehouses: WarehouseQueue["warehouses"] }) {
  return (
    <Select className="h-8 w-44" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Warehouse">
      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </Select>
  );
}

/** Page frame for one warehouse work list: title, warehouse filter, and the queue data. */
export function WarehouseScreen({ title, subtitle, info, children }: {
  title: string; subtitle: string; info?: string; children: (d: WarehouseQueue, wh: string) => ReactNode;
}) {
  const [wh, setWh] = useWarehouseChoice();
  const q = useWarehouseQueue(wh);
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} info={info}
        actions={q.data && <WarehousePicker value={wh} onChange={setWh} warehouses={q.data.warehouses} />} />
      <QueryView q={q}>{(d) => children(d, wh)}</QueryView>
    </div>
  );
}

/** Compact two-line card used for table rows on phones. */
export function MobileRow({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {meta && <div className="text-xs text-zinc-500">{meta}</div>}
      </div>
      {action}
    </div>
  );
}
