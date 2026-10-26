import { CheckCircle2, ClipboardCheck, GitCompareArrows, PackageCheck, PackageOpen } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { useAction } from "@/api/hooks";
import type { NextAction } from "@/api/types";
import { SourceMaterialButton, SupplierUpdateButton } from "@/components/ActionHost";
import { Button } from "@/components/ui/button";

/** Operator name for an action (PRD 1a). */
export function actionLabel(a: NextAction): string {
  const part = a.part_number ? ` ${a.part_number}` : "";
  switch (a.kind) {
    case "source_material": return `Source${part}`;
    case "allocate_material": return `Allocate${part}`;
    case "record_supplier_update": return `Record supplier update${a.po_number ? ` (${a.po_number})` : ""}`;
    case "receive": return `Receive${a.shipment_number ? ` ${a.shipment_number}` : ""}`;
    case "inspect": return `Inspect${part}`;
    case "pick_and_stage": return `Pick and stage${part}`;
    case "confirm_fixture": return `Confirm fixture coverage: ${a.label}`;
    case "finalize": return "Finalize to allocate stock";
    case "resolve_issue": return a.label ?? "Resolve issue";
  }
}

function AllocateButton({ poLineId }: { poLineId: string }) {
  const navigate = useNavigate();
  // Reuses the open draft for this decision if one exists (PRD 4.10).
  const open = useAction<{ po_line_id: string }, { scenario_id: string }>("/scenarios", {
    onSuccess: (r) => navigate(`/scenarios/${r.scenario_id}`),
  });
  return (
    <Button size="sm" disabled={open.isPending} onClick={() => open.mutate({ po_line_id: poLineId })}>
      <GitCompareArrows />Allocate material
    </Button>
  );
}

function FinalizeButton({ woId }: { woId: string }) {
  const finalize = useAction(`/work-orders/${woId}/finalize`, { success: "Finalized — eligible local stock allocated" });
  return <Button size="sm" disabled={finalize.isPending} onClick={() => finalize.mutate({})}><CheckCircle2 />Finalize</Button>;
}

/** The single button for a next action, opening the specific record or task with context preselected. */
export function NextActionButton({ action: a, woId, onConfirmFixture }: {
  action: NextAction; woId?: string; onConfirmFixture?: (fixtureId: string) => void;
}) {
  switch (a.kind) {
    case "source_material":
      return a.part_id && a.warehouse_id ? (
        <SourceMaterialButton partId={a.part_id} warehouseId={a.warehouse_id} itemIds={a.item_id ? [a.item_id] : undefined} />
      ) : null;
    case "allocate_material":
      return a.po_line_id ? <AllocateButton poLineId={a.po_line_id} /> : null;
    case "record_supplier_update":
      return a.po_id ? (
        <SupplierUpdateButton variant="outline" poId={a.po_id} target={a.target_type && a.target_id ? { type: a.target_type, id: a.target_id } : undefined} />
      ) : null;
    case "receive":
      return a.shipment_id ? (
        <Button asChild size="sm" variant="outline">
          <Link to={`/warehouse/receive?shipment=${a.shipment_id}&wh=${a.warehouse_id ?? ""}`}><PackageOpen />Receive</Link>
        </Button>
      ) : null;
    case "inspect":
      return a.qa_batch_id ? (
        <Button asChild size="sm" variant="outline"><Link to={`/qa/${a.qa_batch_id}`}><ClipboardCheck />Inspect</Link></Button>
      ) : null;
    case "pick_and_stage":
      return (
        <Button asChild size="sm" variant="outline">
          <Link to={`/warehouse/pick?wo=${a.work_order_id ?? woId ?? ""}`}><PackageCheck />Pick and stage</Link>
        </Button>
      );
    case "confirm_fixture":
      return onConfirmFixture && a.fixture_id ? (
        <Button size="sm" variant="outline" onClick={() => onConfirmFixture(a.fixture_id!)}>Confirm fixture coverage</Button>
      ) : (
        <Button asChild size="sm" variant="outline"><Link to={`/work-orders/${woId}#fixtures`}>Confirm fixture coverage</Link></Button>
      );
    case "finalize":
      return <FinalizeButton woId={a.work_order_id ?? woId ?? ""} />;
    case "resolve_issue":
      return <Button asChild size="sm" variant="outline"><Link to={`/exceptions?id=${a.exception_id}`}>Review issue</Link></Button>;
  }
}
