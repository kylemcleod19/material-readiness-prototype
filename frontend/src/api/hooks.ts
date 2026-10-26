import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { newOpId } from "@/lib/utils";
import { api } from "./client";
import type {
  DemoAction, InventoryView, Master, MaterialException, PartView, PurchaseOrder, PurchasingQueue,
  QAPending, ScenarioPreview, WarehouseQueue, WorkOrderDetail, WorkOrderSummary,
} from "./types";

export const keys = {
  master: ["master"] as const,
  workOrders: ["readiness", "work-orders"] as const,
  workOrder: (id: string) => ["readiness", "work-order", id] as const,
  purchasing: ["readiness", "purchasing-queue"] as const,
  parts: ["readiness", "parts"] as const,
  pos: ["readiness", "pos"] as const,
  po: (id: string) => ["readiness", "po", id] as const,
  warehouse: (wh: string) => ["readiness", "warehouse", wh] as const,
  qa: ["readiness", "qa"] as const,
  inventory: ["readiness", "inventory"] as const,
  exceptions: (closed: boolean) => ["readiness", "exceptions", closed] as const,
  scenario: (id: string) => ["readiness", "scenario", id] as const,
  demoActions: ["demo-actions"] as const,
};

export const useMaster = () => useQuery({ queryKey: keys.master, queryFn: () => api<Master>("/views/master"), staleTime: 60_000 });
export const useWorkOrders = () => useQuery({ queryKey: keys.workOrders, queryFn: () => api<WorkOrderSummary[]>("/work-orders") });
export const useWorkOrder = (id: string) =>
  useQuery({ queryKey: keys.workOrder(id), queryFn: () => api<WorkOrderDetail>(`/work-orders/${id}`) });
export const usePurchasingQueue = (opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: keys.purchasing, queryFn: () => api<PurchasingQueue>("/views/purchasing-queue"), enabled: opts.enabled ?? true });
export const useParts = () => useQuery({ queryKey: keys.parts, queryFn: () => api<PartView[]>("/views/parts") });
export const usePurchaseOrders = () => useQuery({ queryKey: keys.pos, queryFn: () => api<PurchaseOrder[]>("/purchase-orders") });
export const usePurchaseOrder = (id: string) =>
  useQuery({ queryKey: keys.po(id), queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`) });
export const useWarehouseQueue = (wh: string, opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: keys.warehouse(wh), queryFn: () => api<WarehouseQueue>(`/views/warehouse-queue?warehouse_id=${wh}`), enabled: opts.enabled ?? true });
export const useQAQueue = (opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: keys.qa, queryFn: () => api<QAPending[]>("/qa-batches"), enabled: opts.enabled ?? true });
export const useInventory = () => useQuery({ queryKey: keys.inventory, queryFn: () => api<InventoryView>("/inventory") });
export const useExceptions = (includeClosed: boolean) =>
  useQuery({ queryKey: keys.exceptions(includeClosed), queryFn: () => api<MaterialException[]>(`/exceptions?include_closed=${includeClosed}`) });
export const useScenario = (id: string) =>
  useQuery({ queryKey: keys.scenario(id), queryFn: () => api<ScenarioPreview>(`/scenarios/${id}`) });
export const useDemoActions = () => useQuery({ queryKey: keys.demoActions, queryFn: () => api<DemoAction[]>("/demo/actions") });

/**
 * A business action. Each call carries a fresh op_id (duplicate-submit guard) and, on
 * success, invalidates every readiness-derived view so all roles agree. Nothing is
 * shown as committed until the server confirms.
 */
export function useAction<TVars = Record<string, unknown>, TResult = unknown>(
  path: string | ((vars: TVars) => string),
  opts: { method?: string; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      const url = typeof path === "function" ? path(vars) : path;
      const body = { op_id: newOpId(), ...(vars as object) };
      return api<TResult>(url, { method: opts.method ?? "POST", body });
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["readiness"] });
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
