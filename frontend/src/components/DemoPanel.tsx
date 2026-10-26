import { FlaskConical, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { useDemoActions } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { ROLE_LABELS } from "@/lib/role";
import { SupplierFeedSimulator } from "./SupplierFeedSimulator";

/** Named demo actions that call the normal services, plus a reset of the disposable demo DB. */
export function DemoPanel() {
  const actions = useDemoActions();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, path: string) {
    setBusy(name);
    try {
      await api(path, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["readiness"] });
      toast.success(name === "reset" ? "Demo data restored" : "Done");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><FlaskConical />Demo</Button>
      </DialogTrigger>
      <DialogContent wide>
        <DialogHeader title="Demo scenario controls"
          description="Each step runs through the same services as the UI. Run them in order for the connected walkthrough, or do the same steps by hand in each role's screens." />
        <ol className="space-y-2">
          {actions.data?.map((a, i) => (
            <li key={a.name} className="flex items-center gap-3 rounded-md border p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold">{i + 1}</span>
              <div className="flex-1 text-sm">
                {a.title}
                <div className="mt-0.5"><Badge>{ROLE_LABELS[a.role]}</Badge></div>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(a.name, `/demo/actions/${a.name}`)}>
                <Play />Run
              </Button>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-zinc-600">
          After step 3, open <b>Allocate material</b> and decide how to split the remaining ACT-100.
        </p>
        <div className="mt-4"><SupplierFeedSimulator /></div>
        <div className="mt-5 flex justify-end border-t pt-4">
          <Button variant="destructive" disabled={busy !== null} onClick={() => {
            if (confirm("Restore the seeded demo state? All demo changes will be lost.")) run("reset", "/demo/reset");
          }}>
            <RotateCcw />Reset demo data
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
