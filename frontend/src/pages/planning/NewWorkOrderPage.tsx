import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { useAction, useMaster } from "@/api/hooks";
import { PageHeader, QueryView } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Field, Input, Select } from "@/components/ui/primitives";

const schema = z.object({
  number: z.string().min(1, "Required"),
  title: z.string().min(1, "Required"),
  program_id: z.string().min(1, "Required"),
  warehouse_id: z.string().min(1, "Required"),
  production_start_date: z.string().min(1, "Required"),
  build_qty: z.coerce.number().int().positive(),
  items: z.array(z.object({ part_id: z.string().min(1, "Choose a part"), required_qty: z.coerce.number().int().positive("Must be > 0") }))
    .min(1, "Add at least one part"),
  fixtures: z.array(z.object({ operation: z.string().min(1), fixture_type: z.string().min(1), quantity: z.coerce.number().int().positive() })),
});
type Form = z.infer<typeof schema>;

export function NewWorkOrderPage() {
  const master = useMaster();
  const navigate = useNavigate();
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { number: "", title: "", program_id: "", warehouse_id: "", production_start_date: "", build_qty: 1,
      items: [{ part_id: "", required_qty: 1 }], fixtures: [] },
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const fixtures = useFieldArray({ control: form.control, name: "fixtures" });
  const create = useAction<Form, { work_order_id: string }>("/work-orders", {
    success: "Draft created", onSuccess: (r) => navigate(`/work-orders/${r.work_order_id}`),
  });
  const err = form.formState.errors;

  return (
    <div className="max-w-3xl">
      <PageHeader title="New draft work order"
        subtitle="Required parts and quantities come from upstream planning (no BOM explosion). Drafts reserve nothing until finalized." />
      <QueryView q={master}>
        {(m) => (
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <Card><CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Work order number" error={err.number?.message}><Input {...form.register("number")} placeholder="WO-1010" /></Field>
              <Field label="Title" error={err.title?.message}><Input {...form.register("title")} /></Field>
              <Field label="Program" error={err.program_id?.message}>
                <Select {...form.register("program_id")}><option value="">Select…</option>{m.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              </Field>
              <Field label="Manufacturing site / warehouse" error={err.warehouse_id?.message}>
                <Select {...form.register("warehouse_id")}><option value="">Select…</option>{m.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.city})</option>)}</Select>
              </Field>
              <Field label="Production start" error={err.production_start_date?.message}><Input type="date" {...form.register("production_start_date")} /></Field>
              <Field label="Build quantity" error={err.build_qty?.message}><Input type="number" {...form.register("build_qty")} /></Field>
            </CardContent></Card>

            <Card><CardContent className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Required parts</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => items.append({ part_id: "", required_qty: 1 })}><Plus />Add part</Button></div>
              {items.fields.map((f, i) => (
                <div key={f.id} className="flex items-end gap-2">
                  <Field label={i === 0 ? "Part" : ""} className="flex-1" error={err.items?.[i]?.part_id?.message}>
                    <Select {...form.register(`items.${i}.part_id`)}><option value="">Select…</option>{m.parts.map((p) => <option key={p.id} value={p.id}>{p.part_number} — {p.description}</option>)}</Select>
                  </Field>
                  <Field label={i === 0 ? "Qty" : ""} className="w-24" error={err.items?.[i]?.required_qty?.message}><Input type="number" {...form.register(`items.${i}.required_qty`)} /></Field>
                  <Button type="button" size="icon" variant="ghost" onClick={() => items.remove(i)} disabled={items.fields.length === 1}><Trash2 /></Button>
                </div>
              ))}
            </CardContent></Card>

            <Card><CardContent className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Fixture requirements <span className="font-normal text-zinc-500">(optional, from the routing)</span></h3>
                <Button type="button" size="sm" variant="outline" onClick={() => fixtures.append({ operation: "", fixture_type: "", quantity: 1 })}><Plus />Add fixture</Button></div>
              {fixtures.fields.map((f, i) => (
                <div key={f.id} className="flex items-end gap-2">
                  <Field label="Operation" className="w-32"><Input {...form.register(`fixtures.${i}.operation`)} placeholder="OP20 Mill" /></Field>
                  <Field label="Fixture type" className="flex-1"><Input {...form.register(`fixtures.${i}.fixture_type`)} /></Field>
                  <Field label="Qty" className="w-20"><Input type="number" {...form.register(`fixtures.${i}.quantity`)} /></Field>
                  <Button type="button" size="icon" variant="ghost" onClick={() => fixtures.remove(i)}><Trash2 /></Button>
                </div>
              ))}
            </CardContent></Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create draft</Button>
            </div>
          </form>
        )}
      </QueryView>
    </div>
  );
}
