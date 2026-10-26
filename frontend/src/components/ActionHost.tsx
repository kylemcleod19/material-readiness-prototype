import { MessageSquareReply, PackageSearch } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { SourcingDialog } from "@/components/SourcingDialog";
import { SupplierUpdateDialog } from "@/components/SupplierUpdateDialog";
import { Button, type ButtonProps } from "@/components/ui/button";

type Sourcing = { partId: string; warehouseId: string; itemIds?: string[] };
type SupplierUpdate = { poId: string; target?: { type: string; id: string } };

const Ctx = createContext<{ source: (s: Sourcing) => void; supplierUpdate: (s: SupplierUpdate) => void }>({
  source: () => {}, supplierUpdate: () => {},
});

/**
 * Hosts the Source material and Record supplier update dialogs above the page, so a dialog keeps
 * showing its confirmation even when the queue row that opened it disappears after the refresh.
 */
export function ActionHost({ children }: { children: ReactNode }) {
  const [sourcing, setSourcing] = useState<Sourcing | null>(null);
  const [update, setUpdate] = useState<SupplierUpdate | null>(null);
  return (
    <Ctx.Provider value={{ source: setSourcing, supplierUpdate: setUpdate }}>
      {children}
      {sourcing && <SourcingDialog {...sourcing} onClose={() => setSourcing(null)} />}
      {update && <SupplierUpdateDialog {...update} onClose={() => setUpdate(null)} />}
    </Ctx.Provider>
  );
}

export function SourceMaterialButton({ size = "sm", ...s }: Sourcing & { size?: ButtonProps["size"] }) {
  const { source } = useContext(Ctx);
  return <Button size={size} onClick={() => source(s)}><PackageSearch />Source material</Button>;
}

export function SupplierUpdateButton({ variant = "default", size = "sm", ...s }: SupplierUpdate & { variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  const { supplierUpdate } = useContext(Ctx);
  return <Button size={size} variant={variant} onClick={() => supplierUpdate(s)}><MessageSquareReply />Record supplier update</Button>;
}
