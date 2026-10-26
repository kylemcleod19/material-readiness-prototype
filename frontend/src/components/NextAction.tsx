import { ArrowRight, CheckCircle2, GitCompareArrows, PackageCheck, ShoppingCart } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { useAction } from "@/api/hooks";
import type { NextAction, SupplyOption, WhRef } from "@/api/types";
import { AssignSupplyDialog, PurchaseDialog, RemoteHoldActions, UpdateArrivalDialog } from "@/components/actions";
import { Button } from "@/components/ui/button";

/** Where the requirement lives, so an action can be taken right on the row that shows it. */
export interface ActionContext {
  woId: string;
  woNumber: string;
  warehouse: WhRef;
  start: string;
  required?: number;
  supplyOptions?: SupplyOption[];
}

export function actionLabel(a: NextAction): string {
  const part = a.part_number ?? "";
  switch (a.kind) {
    case "buy": return `Buy ${a.qty} ${part}`;
    case "resolve_shortage": return `Decide how to split ${part}`;
    case "decide_transfer": return `Transfer ${a.qty} ${part} or buy`;
    case "update_arrival": return `Follow up: ${part} arrives after start`;
    case "get_arrival_date": return `Get ${part} arrival date`;
    case "pick_stage": return `Pick & stage ${a.qty} ${part}`;
    case "review_fixture": return `Confirm fixture: ${a.label}`;
    case "finalize": return "Finalize to reserve stock";
    case "resolve_exception": return a.label ?? "Resolve exception";
  }
}

function ResolveShortageButton({ poLineId }: { poLineId: string }) {
  const navigate = useNavigate();
  const open = useAction<{ po_line_id: string }, { scenario_id: string }>("/scenarios", {
    onSuccess: (r) => navigate(`/scenarios/${r.scenario_id}`),
  });
  return (
    <Button size="sm" disabled={open.isPending} onClick={() => open.mutate({ po_line_id: poLineId })}>
      <GitCompareArrows />Decide split
    </Button>
  );
}

function FinalizeButton({ woId }: { woId: string }) {
  const finalize = useAction(`/work-orders/${woId}/finalize`, { success: "Finalized — eligible stock reserved" });
  return <Button size="sm" disabled={finalize.isPending} onClick={() => finalize.mutate({})}><CheckCircle2 />Finalize</Button>;
}

/** The button(s) for one next action. */
export function NextActionButton({ action: a, ctx }: { action: NextAction; ctx: ActionContext }) {
  switch (a.kind) {
    case "buy": {
      const assignable = ctx.supplyOptions?.some((o) => o.compatible);
      return (
        <div className="flex justify-end gap-2">
          {assignable && a.item_id && (
            <AssignSupplyDialog itemId={a.item_id} partNumber={a.part_number ?? ""} uncovered={a.qty ?? 0} options={ctx.supplyOptions!}
              trigger={<Button size="sm" variant="outline">Assign</Button>} />
          )}
          {!ctx.supplyOptions && (a.unassigned_here ?? 0) > 0 && (
            <Button asChild size="sm" variant="outline"><Link to={`/work-orders/${ctx.woId}`}>Assign</Link></Button>
          )}
          {a.part_id && a.item_id && (
            <PurchaseDialog partId={a.part_id} partNumber={a.part_number ?? ""} destination={ctx.warehouse}
              defaultSupplierId={a.supplier?.id}
              demand={[{ work_order_item_id: a.item_id, work_order_id: ctx.woId, work_order_number: ctx.woNumber,
                state: "finalized", warehouse: ctx.warehouse, production_start_date: ctx.start,
                required: ctx.required ?? a.qty ?? 0, uncovered: a.qty ?? 0 }]}
              trigger={<Button size="sm"><ShoppingCart />Buy {a.qty}</Button>} />
          )}
        </div>
      );
    }
    case "resolve_shortage":
      return a.po_line_id ? <ResolveShortageButton poLineId={a.po_line_id} /> : null;
    case "decide_transfer":
      return a.allocation_id ? (
        <RemoteHoldActions allocationId={a.allocation_id} qty={a.qty ?? 0}
          source={typeof a.from_warehouse === "object" ? a.from_warehouse : undefined} />
      ) : null;
    case "update_arrival":
    case "get_arrival_date":
      return a.po_id ? (
        <div className="flex justify-end gap-2">
          <UpdateArrivalDialog poId={a.po_id} trigger={<Button size="sm" variant="outline">Update arrival</Button>} />
          <Button asChild size="sm" variant="ghost"><Link to={`/purchasing/pos/${a.po_id}`}>{a.po_number ?? "PO"}<ArrowRight /></Link></Button>
        </div>
      ) : null;
    case "pick_stage":
      return <Button asChild size="sm" variant="outline"><Link to="/warehouse/pick"><PackageCheck />Pick list</Link></Button>;
    case "review_fixture":
      return <Button asChild size="sm" variant="outline"><Link to={`/work-orders/${ctx.woId}#fixtures`}>Review fixture</Link></Button>;
    case "finalize":
      return <FinalizeButton woId={ctx.woId} />;
    case "resolve_exception":
      return <Button asChild size="sm" variant="outline"><Link to="/exceptions">Open exception</Link></Button>;
  }
}
