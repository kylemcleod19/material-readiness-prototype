import { useState, type ReactNode } from "react";

import { useAction } from "@/api/hooks";
import type { MaterialException } from "@/api/types";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/primitives";

function useDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, close: () => setOpen(false) };
}

/** Record the follow-up for an issue and close its review. Shortages stay visible independently. */
export function ExceptionActions({ exc }: { exc: MaterialException }) {
  const d = useDialog();
  const [note, setNote] = useState("");
  const close = useAction<{ note: string }>(`/exceptions/${exc.id}/close`, { success: "Issue review closed", onSuccess: d.close });
  if (exc.state === "closed") return null;
  return (
    <Dialog open={d.open} onOpenChange={d.setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Record follow-up</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader title={`Close review · ${exc.label}`}
          description="Closing records that review happened. It does not create stock, reverse scrap, or remove a shortage." />
        <Field label="Follow-up recorded">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replacement of 20 ordered on PO-6002; supplier RMA opened" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button disabled={!note.trim() || close.isPending} onClick={() => close.mutate({ note })}>Close review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PromptDialog({ title, description, label, placeholder, confirm, onSubmit, trigger, multiline, inputType = "text", required = true, initial = "", tone }: {
  title: string; description?: ReactNode; label: string; placeholder?: string; confirm: string;
  onSubmit: (value: string, close: () => void) => void; trigger: ReactNode; multiline?: boolean; inputType?: string;
  required?: boolean; initial?: string; tone?: ButtonProps["variant"];
}) {
  const d = useDialog();
  const [v, setV] = useState(initial);
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) setV(initial); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader title={title} description={description} />
        <Field label={label}>
          {multiline
            ? <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
            : <Input type={inputType} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={d.close}>Cancel</Button>
          <Button variant={tone} disabled={required && !v.trim()} onClick={() => onSubmit(v, d.close)}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
