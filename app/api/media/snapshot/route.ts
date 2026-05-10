// app/api/media/snapshot/route.ts — public, cite-able JSON for journalists.
//
// Returns the current Kibarometer-indeks, per-category temperatures from
// the most recent day with data, and any active anomaly spikes. Cached at
// the edge for 60s; CORS-open via the shared json() helper.
//
// Schema is versioned ("schema_version": "1") so we can evolve it without
// breaking existing embeds.

import { sb } from "@/lib/supabase";
import { json } from "@/app/api/v1/_response";

export const dynamic = "force-dynamic";

type SnapshotIndex = {
  date: string;
  index_value: number;
  article_count_7d: number;
  ai_article_count_7d: number;
  categories_above_water: number;
  categories_below_water: number;
};

type CategoryDaily = {
  published_on: string;
  category_slug: string;
  ai_count: number;
  temperature: number | null;
};

type AnomalyRow = {
  date: string;
  category_slug: string;
  count: number;
  baseline_mean: number;
  z_score: number;
};

export async function GET() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [indexRows, latestCategoryRows, anomalies] = await Promise.all([
    sb<SnapshotIndex[]>(`/media_snapshot_index?order=date.desc&limit=1`).catch(
      () => [] as SnapshotIndex[],
    ),
    // Pull a wider window then bucket to the latest published_on per category
    // — last category-daily row by date is what the dashboard heatmap shows.
    sb<CategoryDaily[]>(
      `/media_snapshot_category_daily?published_on=gte.${sevenDaysAgo}` +
        `&order=published_on.desc`,
    ).catch(() => [] as CategoryDaily[]),
    sb<AnomalyRow[]>(
      `/media_anomaly_daily?date=gte.${sevenDaysAgo}&is_spike=is.true` +
        `&order=z_score.desc&limit=10`,
    ).catch(() => [] as AnomalyRow[]),
  ]);

  // Latest temperature per category over the 7-day window.
  const latestPerCategory = new Map<string, CategoryDaily>();
  for (const r of latestCategoryRows) {
    if (!latestPerCategory.has(r.category_slug)) {
      latestPerCategory.set(r.category_slug, r);
    }
  }

  const latest = indexRows[0] ?? null;

  return json({
    schema_version: "1",
    generated_at: new Date().toISOString(),
    index: latest
      ? {
          date: latest.date,
          value: latest.index_value,
          window: "7d",
          ai_article_count: latest.ai_article_count_7d,
          categories_above_water: latest.categories_above_water,
          categories_below_water: latest.categories_below_water,
        }
      : null,
    categories: [...latestPerCategory.values()].map((c) => ({
      slug: c.category_slug,
      latest_date: c.published_on,
      ai_count: c.ai_count,
      temperature: c.temperature,
    })),
    anomalies: anomalies.map((a) => ({
      date: a.date,
      category_slug: a.category_slug,
      count: a.count,
      baseline_mean: a.baseline_mean,
      z_score: a.z_score,
    })),
    docs: "https://kibarometer.no/mediedekning",
  });
}
