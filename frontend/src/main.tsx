import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { Layout } from "@/components/Layout";
import { ROLE_HOME, RoleProvider, useRole } from "@/lib/role";
import { ExceptionsPage } from "@/pages/ExceptionsPage";
import { NewWorkOrderPage } from "@/pages/planning/NewWorkOrderPage";
import { WorkOrderDetailPage } from "@/pages/planning/WorkOrderDetailPage";
import { WorkOrdersPage } from "@/pages/planning/WorkOrdersPage";
import { PurchaseOrderPage } from "@/pages/purchasing/PurchaseOrderPage";
import { PurchaseOrdersPage } from "@/pages/purchasing/PurchaseOrdersPage";
import { SourceMaterialPage } from "@/pages/purchasing/SourceMaterialPage";
import { SupplierFollowUpPage } from "@/pages/purchasing/SupplierFollowUpPage";
import { AllocateMaterialPage } from "@/pages/scenarios/AllocateMaterialPage";
import { QAQueuePage } from "@/pages/qa/QAQueuePage";
import { QATaskPage } from "@/pages/qa/QATaskPage";
import { ScenarioPage } from "@/pages/scenarios/ScenarioPage";
import { ArrivalsPage } from "@/pages/warehouse/ArrivalsPage";
import { InventoryPage } from "@/pages/warehouse/InventoryPage";
import { PickTaskPage } from "@/pages/warehouse/PickTaskPage";
import { ReceiveTaskPage } from "@/pages/warehouse/ReceiveTaskPage";

import { PickListPage } from "@/pages/warehouse/PickListPage";
import { PutawayPage } from "@/pages/warehouse/PutawayPage";
import { StagePage } from "@/pages/warehouse/StagePage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 5_000 } },
});

function Home() {
  const { role } = useRole();
  return <Navigate to={ROLE_HOME[role]} replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/work-orders", element: <WorkOrdersPage /> },
      { path: "/work-orders/new", element: <NewWorkOrderPage /> },
      { path: "/work-orders/:id", element: <WorkOrderDetailPage /> },
      { path: "/allocate", element: <AllocateMaterialPage /> },
      { path: "/scenarios/:id", element: <ScenarioPage /> },
      { path: "/exceptions", element: <ExceptionsPage /> },
      { path: "/purchasing", element: <Navigate to="/purchasing/source" replace /> },
      { path: "/purchasing/source", element: <SourceMaterialPage /> },
      { path: "/purchasing/follow-up", element: <SupplierFollowUpPage /> },
      { path: "/purchasing/pos", element: <PurchaseOrdersPage /> },
      { path: "/purchasing/pos/:id", element: <PurchaseOrderPage /> },
      { path: "/warehouse", element: <ArrivalsPage /> },
      { path: "/warehouse/receive", element: <ReceiveTaskPage /> },
      { path: "/warehouse/putaway", element: <PutawayPage /> },
      { path: "/warehouse/pick", element: <PickListPage /> },
      { path: "/warehouse/stage", element: <StagePage /> },
      { path: "/warehouse/pick/:allocationId", element: <PickTaskPage /> },
      { path: "/warehouse/inventory", element: <InventoryPage /> },
      { path: "/qa", element: <QAQueuePage /> },
      { path: "/qa/:batchId", element: <QATaskPage /> },
      { path: "*", element: <Home /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RoleProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </RoleProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
