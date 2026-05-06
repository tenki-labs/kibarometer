import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Initial = {
  slug?: string;
  label_no?: string;
  label_en?: string | null;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export function BrregCategoryFields({
  initial,
  lockSlug,
}: {
  initial?: Initial;
  lockSlug: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-2">
        <Label htmlFor="slug">Slug *</Label>
        <Input
          id="slug"
          name="slug"
          defaultValue={initial?.slug ?? ""}
          placeholder="developer-tools"
          required={!lockSlug}
          readOnly={lockSlug}
          pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Små bokstaver, tall og bindestrek. Brukes som primærnøkkel og kan
          ikke endres senere. Tier 2-prompten substituerer slugen i{" "}
          <code className="font-mono">{`{{categories_block}}`}</code>.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="label_no">Etikett (norsk) *</Label>
        <Input
          id="label_no"
          name="label_no"
          defaultValue={initial?.label_no ?? ""}
          required
          maxLength={200}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="label_en">Etikett (engelsk)</Label>
        <Input
          id="label_en"
          name="label_en"
          defaultValue={initial?.label_en ?? ""}
          maxLength={200}
          placeholder="Developer tools"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Beskrivelse</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description ?? ""}
          rows={3}
          placeholder="Selskaper som lager AI-verktøy for utviklere: kodegenerering, IDE-integrasjoner, agent-rammeverk, evals."
        />
        <p className="text-xs text-muted-foreground">
          Vises i Tier 2-prompten som veiledning for klassifisering.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sort_order">Sortering</Label>
        <Input
          id="sort_order"
          name="sort_order"
          type="number"
          step={10}
          min={0}
          max={9999}
          defaultValue={initial?.sort_order ?? 100}
        />
        <p className="text-xs text-muted-foreground">
          Lavere tall = vises først i Tier 2-prompten og i listen.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="is_active"
          name="is_active"
          defaultChecked={initial?.is_active ?? true}
        />
        <Label htmlFor="is_active" className="text-sm font-normal">
          Aktiv (tilgjengelig for Tier 2-klassifisering)
        </Label>
      </div>
    </div>
  );
}
