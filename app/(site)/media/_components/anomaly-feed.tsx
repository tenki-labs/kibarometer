"use client";

import type {
  MediaAnomalyDaily,
  MediaCategory,
} from "@/lib/supabase";

type Props = {
  rows: MediaAnomalyDaily[];
  categories: MediaCategory[];
};

const NB = new Intl.NumberFormat("nb-NO");
const NO_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function intensityLabel(z: number): string {
  if (z >= 4) return "Voldsom";
  if (z >= 3) return "Sterk";
  if (z >= 2) return "Markant";
  return "Liten";
}

export function AnomalyFeed({ rows, categories }: Props) {
  const labelBySlug = new Map(categories.map((c) => [c.slug, c.label_no]));

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground">
        Ingen kategori-spiker siste 30 dager. Mediedekningen ligger innenfor
        forventet variasjon mot 28-dagers rullerende baseline.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const date = new Date(r.date + "T00:00:00Z");
        return (
          <li
            key={`${r.date}-${r.category_slug}`}
            className="flex items-start gap-4 rounded-md border bg-card px-4 py-3"
          >
            <div className="flex flex-col items-center">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                z
              </span>
              <span className="text-2xl font-medium tabular-nums leading-none">
                {r.z_score.toFixed(1).replace(".", ",")}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {labelBySlug.get(r.category_slug) ?? r.category_slug}
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {NO_DATE.format(date)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {intensityLabel(r.z_score)} spike — {NB.format(r.count)} AI-artikler
                mot baseline {r.baseline_mean.toFixed(1).replace(".", ",")}.
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
