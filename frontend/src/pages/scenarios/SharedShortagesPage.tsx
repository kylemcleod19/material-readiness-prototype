import { usePurchasingQueue } from "@/api/hooks";
import { PageHeader, QueryView } from "@/components/domain";
import { MaterialShortagesTable } from "@/pages/purchasing/MaterialShortagesPage";

/** Program-management entry to the same material-shortage decisions purchasing sees. */
export function SharedShortagesPage() {
  const q = usePurchasingQueue();
  return (
    <div>
      <PageHeader title="Material shortages" subtitle="Decide which builds get scarce material."
        info="Program management chooses the split in a scenario and purchasing applies it. No earliest-start rule is applied automatically." />
      <QueryView q={q}>{(d) => <MaterialShortagesTable rows={d.material_shortages} />}</QueryView>
    </div>
  );
}
