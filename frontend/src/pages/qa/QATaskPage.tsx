import { ArrowLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAction, useQAQueue } from "@/api/hooks";
import type { QAPending } from "@/api/types";
import { QueryView, StartDate } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Callout, Card, Field, Input, Textarea } from "@/components/ui/primitives";

export function QATaskPage() {
  const { batchId = "" } = useParams();
  const q = useQAQueue();
  const [done, setDone] = useState<null | { deficit: number; rejected: number }>(null);
  return (
    <div className="mx-auto max-w-xl">
      <Link to="/qa" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-600"><ArrowLeft className="size-4" />QA queue</Link>
      {done ? <Result {...done} /> : (
        <QueryView q={q}>
          {(rows) => {
            const b = rows.find((r) => r.qa_batch_id === batchId);
            return b ? <QAForm b={b} onDone={setDone} /> : <Callout tone="neutral">This batch is already complete.</Callout>;
          }}
        </QueryView>
      )}
    </div>
  );
}

function Result({ deficit, rejected }: { deficit: number; rejected: number }) {
  return (
    <Card className="space-y-3 p-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-green-600" />
      <div className="text-lg font-semibold">QA recorded</div>
      {rejected > 0 && <p className="text-sm text-zinc-600">{rejected} units scrapped. Purchasing has an exception to review.</p>}
      {deficit > 0 && (
        <Callout tone="amber" icon={<ShieldAlert />}>
          The PO line is now short {deficit}. It appears under Material shortages for a decision — no work order was chosen to lose units.
        </Callout>
      )}
      <Button asChild><Link to="/qa">Back to queue</Link></Button>
    </Card>
  );
}

function QAForm({ b, onDone }: { b: QAPending; onDone: (r: { deficit: number; rejected: number }) => void }) {
  const [rejected, setRejected] = useState(0);
  const [note, setNote] = useState("");
  const accepted = b.input_qty - rejected;
  const complete = useAction<{ accepted_qty: number; rejected_qty: number; note: string }, { deficit: number }>(
    `/qa-batches/${b.qa_batch_id}/complete`, { success: "QA result recorded", onSuccess: (r) => onDone({ deficit: r.deficit, rejected }) });
  const valid = rejected >= 0 && rejected <= b.input_qty && (rejected === 0 || note.trim());
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5">
        <div className="text-3xl font-semibold">{b.part_number}</div>
        <div className="text-sm text-zinc-600">{b.description} · {b.label}{b.lot ? ` · lot ${b.lot}` : ""}</div>
        <div className="pt-2 text-lg">Inspected quantity <b className="tabular">{b.input_qty} {b.uom}</b></div>
        {b.demand.length > 0 && (
          <div className="text-xs text-zinc-500">For {b.demand.map((x) => x.work_order_number).join(", ")} · earliest start {b.earliest_start && <StartDate date={b.earliest_start} />}</div>
        )}
      </Card>
      <Card className="grid grid-cols-2 gap-3 p-4">
        <Field label="Accepted">
          <Input type="number" inputMode="numeric" className="h-14 text-2xl font-semibold tabular text-green-700" value={accepted}
            onChange={(e) => setRejected(Math.max(0, b.input_qty - Number(e.target.value)))} />
        </Field>
        <Field label="Rejected (scrapped)">
          <Input type="number" inputMode="numeric" className="h-14 text-2xl font-semibold tabular text-red-700" value={rejected} min={0} max={b.input_qty}
            onChange={(e) => setRejected(Math.min(b.input_qty, Math.max(0, Number(e.target.value))))} />
        </Field>
        <p className="col-span-2 text-xs text-zinc-500">Accepted + rejected must equal {b.input_qty}. Rejected units are scrapped and raise a purchasing exception.</p>
        <Field label={rejected ? "Rejection reason (required)" : "Note"} className="col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bore diameter out of tolerance" />
        </Field>
      </Card>
      <Button size="xl" disabled={!valid || complete.isPending} onClick={() => complete.mutate({ accepted_qty: accepted, rejected_qty: rejected, note })}>
        Record {accepted} accepted{rejected ? ` / ${rejected} rejected` : ""}
      </Button>
    </div>
  );
}
