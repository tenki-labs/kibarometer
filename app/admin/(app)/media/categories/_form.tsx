import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Initial = {
  slug?: string;
  label_no?: string;
  label_en?: string | null;
  parent_slug?: string | null;
  description?: string | null;
  is_active?: boolean;
};

export function CategoryFields({
  initial,
  parents,
  lockSlug,
}: {
  initial?: Initial;
  parents: { slug: string; label_no: string }[];
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
          placeholder="policy-regulation"
          required={!lockSlug}
          readOnly={lockSlug}
          pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Små bokstaver, tall og bindestrek. Brukes som primærnøkkel og kan
          ikke endres senere.
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
          placeholder="Policy &amp; regulation"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="parent_slug">Foreldre-kategori (valgfritt)</Label>
        <select
          id="parent_slug"
          name="parent_slug"
          defaultValue={initial?.parent_slug ?? ""}
          className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm"
        >
          <option value="">— ingen —</option>
          {parents
            .filter((p) => p.slug !== initial?.slug)
            .map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label_no} ({p.slug})
              </option>
            ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Beskrivelse</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description ?? ""}
          rows={3}
          placeholder="EU AI Act, norsk KI-strategi, Datatilsynet, lovverk og forskrifter"
        />
        <p className="text-xs text-muted-foreground">
          Vises i Tier 2-prompten som veiledning for klassifisering.
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
