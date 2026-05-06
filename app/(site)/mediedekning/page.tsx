// app/(site)/mediedekning/page.tsx — public AI-medietemperatur dashboard.
//
// Server component, ISR 60s. Reads from the public-RLS snapshot tables
// populated nightly by refresh_all_media_snapshots(). Charts are
// hand-rolled SVG (same convention as app/_components/charts.tsx) — no
// client JS, embeddable as iframe.
//
// Data is intentionally read-only here; admin operates via /admin/media.

import type { Metadata } from "next";

import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Medietemperatur",
  description:
    "Hvor varmt eller kaldt norske medier snakker om AI — basert på et utvalg outletter, oppdatert daglig.",
  alternates: { canonical: "/mediedekning" },
  openGraph: { url: "/mediedekning" },
};

type SnapshotIndex = {
  date: string;
  index_value: number;
  article_count_7d: number;
  ai_article_count_7d: number;
  categories_above_water: number;
  categories_below_water: number;
};

type AnomalyRow = {
  date: string;
  category_slug: string;
  count: number;
  baseline_mean: number;
  z_score: number;
  is_spike: boolean;
};

type CategoryDailyRow = {
  published_on: string;
  category_slug: string;
  ai_count: number;
  distinct_story_count: number;
  temperature: number | null;
};

type SourceCategoryRow = {
  published_on: string;
  source_id: string;
  category_slug: string;
  ai_count: number;
  temperature: number | null;
};

type Source = { id: string; name: string; domain: string };

type CategoryRow = { slug: string; label_no: string; label_en: string | null };

type SiteContent = { slug: string; title: string; body_md: string };

const FALLBACK_TITLE = "Medietemperaturen";
const FALLBACK_BODY = `Hvor varmt — eller kaldt — snakker norske medier om kunstig intelligens akkurat nå?

50 betyr balansert. Lavere er bekymret tilt; høyere er entusiastisk tilt.`;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function fmtIndex(n: number): string {
  return n.toLocaleString("nb-NO");
}

function indexLabel(v: number): string {
  if (v < 35) return "alarmert tilt";
  if (v < 48) return "lett bekymret";
  if (v <= 52) return "balansert";
  if (v <= 65) return "moderat optimisme";
  return "sterk optimisme";
}

function tempColor(t: number | null): string {
  // -1 → red, 0 → grey, +1 → green. Use OKLCH for perceptual uniformity.
  if (t == null) return "oklch(0.92 0 0)";
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped >= 0) {
    // 0 grey → +1 green
    const l = 0.92 - 0.18 * clamped;
    const c = 0.16 * clamped;
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 145)`;
  }
  const a = -clamped;
  const l = 0.92 - 0.18 * a;
  const c = 0.16 * a;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 25)`;
}

export default async function MediedekningPage() {
  const ninetyDaysAgo = isoDaysAgo(90);
  const sevenDaysAgo = isoDaysAgo(7);
  const thirtyDaysAgo = isoDaysAgo(30);

  const [
    indexRows,
    indexPriorRows,
    anomalies,
    categoryDaily,
    sourceCategoryDaily,
    categories,
    sources,
    siteContent,
  ] = await Promise.all([
    sb<SnapshotIndex[]>(
      `/media_snapshot_index?order=date.desc&limit=1`,
    ).catch(() => [] as SnapshotIndex[]),
    sb<SnapshotIndex[]>(
      `/media_snapshot_index?order=date.desc&offset=7&limit=1`,
    ).catch(() => [] as SnapshotIndex[]),
    sb<AnomalyRow[]>(
      `/media_anomaly_daily?date=gte.${sevenDaysAgo}&is_spike=is.true&order=z_score.desc&limit=10`,
    ).catch(() => [] as AnomalyRow[]),
    sb<CategoryDailyRow[]>(
      `/media_snapshot_category_daily?published_on=gte.${ninetyDaysAgo}` +
        `&order=published_on.asc`,
    ).catch(() => [] as CategoryDailyRow[]),
    sb<SourceCategoryRow[]>(
      `/media_snapshot_source_category_daily?published_on=gte.${thirtyDaysAgo}` +
        `&order=published_on.asc`,
    ).catch(() => [] as SourceCategoryRow[]),
    sb<CategoryRow[]>(
      `/media_categories?is_active=is.true&select=slug,label_no,label_en&order=slug.asc`,
    ).catch(() => [] as CategoryRow[]),
    sb<Source[]>(
      `/media_sources?is_active=is.true&select=id,name,domain`,
    ).catch(() => [] as Source[]),
    sb<SiteContent[]>(
      `/site_content?slug=eq.mediedekning&select=slug,title,body_md`,
    ).catch(() => [] as SiteContent[]),
  ]);

  const latestIndex = indexRows[0] ?? null;
  const priorIndex = indexPriorRows[0] ?? null;
  const indexDelta =
    latestIndex && priorIndex
      ? latestIndex.index_value - priorIndex.index_value
      : null;

  const title = siteContent[0]?.title ?? FALLBACK_TITLE;
  const body = siteContent[0]?.body_md ?? FALLBACK_BODY;

  const categoryByCategory = new Map(categories.map((c) => [c.slug, c]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  return (
    <main className="metode">
      <span className="eyebrow">· Medietemperatur</span>
      <h1 className="title">{title}</h1>

      {/* Hero — Kibarometer-indeks */}
      <section
        style={{
          margin: "2rem 0",
          padding: "2rem 1.5rem",
          borderRadius: "1rem",
          background: latestIndex
            ? tempColor((latestIndex.index_value - 50) / 50)
            : "oklch(0.96 0 0)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            opacity: 0.75,
          }}
        >
          Kibarometer-indeks · siste 7 dager
        </div>
        <div
          style={{
            fontSize: "clamp(4rem, 16vw, 10rem)",
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            marginTop: "0.5rem",
          }}
        >
          {latestIndex ? fmtIndex(latestIndex.index_value) : "—"}
          <span
            style={{
              fontSize: "0.4em",
              opacity: 0.55,
              marginLeft: "0.4em",
            }}
          >
            / 100
          </span>
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "1rem", opacity: 0.85 }}>
          {latestIndex ? indexLabel(latestIndex.index_value) : "Ingen data ennå"}
          {indexDelta != null
            ? ` · ${indexDelta >= 0 ? "+" : ""}${indexDelta} poeng siden forrige uke`
            : null}
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.6 }}>
          {latestIndex
            ? `Basert på ${latestIndex.ai_article_count_7d} AI-artikler i ${latestIndex.article_count_7d} totale.`
            : null}
        </div>
      </section>

      {renderMarkdown(body)}

      {/* Anomaly callouts */}
      {anomalies.length > 0 ? (
        <section style={{ margin: "3rem 0" }}>
          <h2>Uvanlig aktivitet siste 7 dager</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {anomalies.map((a) => {
              const cat = categoryByCategory.get(a.category_slug);
              const label = cat?.label_no ?? a.category_slug;
              return (
                <li
                  key={`${a.date}-${a.category_slug}`}
                  style={{
                    padding: "0.75rem 1rem",
                    borderLeft: "3px solid oklch(0.65 0.18 35)",
                    background: "oklch(0.98 0.02 35)",
                    marginBottom: "0.5rem",
                    borderRadius: "0.25rem",
                  }}
                >
                  <strong>{label}</strong>: {a.count} artikler{" "}
                  <span style={{ opacity: 0.7 }}>
                    ({a.z_score.toFixed(1)}σ over snitt på{" "}
                    {a.baseline_mean.toFixed(1)} typisk) — {a.date}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Per-category temperature heatmap */}
      <section style={{ margin: "3rem 0" }}>
        <h2>Temperatur per kategori (siste 12 uker)</h2>
        <p style={{ opacity: 0.7, marginBottom: "1rem" }}>
          Grønt = entusiastisk dekning, rødt = bekymret, grått = balansert eller
          ingen data.
        </p>
        <CategoryHeatmap
          rows={categoryDaily}
          categories={categories}
        />
      </section>

      {/* Volume timeline */}
      <section style={{ margin: "3rem 0" }}>
        <h2>Antall AI-artikler per dag (siste 90 dager)</h2>
        <VolumeTimeline rows={categoryDaily} />
      </section>

      {/* Top outlets */}
      <section style={{ margin: "3rem 0" }}>
        <h2>Største kilder siste 30 dager</h2>
        <TopOutlets
          rows={sourceCategoryDaily}
          sources={sourceById}
          categories={categoryByCategory}
        />
      </section>

      {/* Cite-able JSON */}
      <section style={{ margin: "3rem 0" }}>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            Sitatsperregbar JSON for journalister
          </summary>
          <p style={{ marginTop: "0.75rem", opacity: 0.8 }}>
            En maskinlesbar oppsummering av samme tall:
          </p>
          <pre
            style={{
              background: "oklch(0.96 0 0)",
              padding: "0.75rem",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
              overflow: "auto",
            }}
          >
            <code>GET /api/media/snapshot.json</code>
          </pre>
          <p style={{ opacity: 0.7, fontSize: "0.85rem" }}>
            CORS-åpen, ingen autentisering, 60s edge-cache. Bruk gjerne — vi
            setter pris på en lenke tilbake.
          </p>
        </details>
      </section>
    </main>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function CategoryHeatmap({
  rows,
  categories,
}: {
  rows: CategoryDailyRow[];
  categories: CategoryRow[];
}) {
  const WEEKS = 12;
  // Bucket rows into ISO weeks (YYYY-Www). Compute weekly mean per (category, week).
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.temperature == null) continue;
    const wk = isoWeek(r.published_on);
    const key = `${r.category_slug}|${wk}`;
    const cur = buckets.get(key) ?? { sum: 0, n: 0 };
    cur.sum += r.temperature;
    cur.n += 1;
    buckets.set(key, cur);
  }

  const recentWeeks: string[] = [];
  const today = new Date();
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    recentWeeks.push(isoWeek(d.toISOString().slice(0, 10)));
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: "0.8rem",
          width: "100%",
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>
              Kategori
            </th>
            {recentWeeks.map((w) => (
              <th
                key={w}
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.65rem",
                  fontWeight: 400,
                  opacity: 0.6,
                  padding: "0.25rem 0.15rem",
                  textAlign: "center",
                }}
              >
                {w.split("-W")[1]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.slug}>
              <td
                style={{
                  padding: "0.25rem 0.5rem",
                  whiteSpace: "nowrap",
                }}
              >
                {c.label_no}
              </td>
              {recentWeeks.map((w) => {
                const b = buckets.get(`${c.slug}|${w}`);
                const t = b && b.n > 0 ? b.sum / b.n : null;
                return (
                  <td
                    key={w}
                    style={{
                      width: "1.5rem",
                      height: "1.5rem",
                      background: tempColor(t),
                      border: "1px solid oklch(1 0 0 / 0.4)",
                    }}
                    title={
                      t != null
                        ? `${c.label_no} · ${w} · temp ${t.toFixed(2)}`
                        : `${c.label_no} · ${w} · ingen data`
                    }
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VolumeTimeline({ rows }: { rows: CategoryDailyRow[] }) {
  const WIDTH = 720;
  const HEIGHT = 200;
  const PADDING = 24;

  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.published_on, (byDay.get(r.published_on) ?? 0) + r.ai_count);
  }
  const days: string[] = [];
  for (let i = 89; i >= 0; i -= 1) {
    days.push(isoDaysAgo(i));
  }
  const values = days.map((d) => byDay.get(d) ?? 0);
  const max = Math.max(...values, 1);

  if (values.every((v) => v === 0)) {
    return (
      <p style={{ opacity: 0.6 }}>
        Ingen klassifiserte artikler ennå. Diagrammet fylles etter første
        snapshot-kjøring.
      </p>
    );
  }

  const barW = (WIDTH - 2 * PADDING) / values.length;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label="Antall AI-artikler per dag siste 90 dager"
      style={{ maxWidth: "100%" }}
    >
      <line
        x1={PADDING}
        x2={WIDTH - PADDING}
        y1={HEIGHT - PADDING}
        y2={HEIGHT - PADDING}
        stroke="oklch(0.85 0 0)"
        strokeWidth={1}
      />
      {values.map((v, i) => {
        const h = ((HEIGHT - 2 * PADDING) * v) / max;
        return (
          <rect
            key={days[i]}
            x={PADDING + i * barW}
            y={HEIGHT - PADDING - h}
            width={Math.max(0, barW - 1)}
            height={h}
            fill="oklch(0.62 0.22 250)"
          />
        );
      })}
      <text
        x={PADDING}
        y={PADDING - 6}
        style={{ fontSize: 10, opacity: 0.6 }}
      >
        Maks: {max}
      </text>
    </svg>
  );
}

function TopOutlets({
  rows,
  sources,
  categories,
}: {
  rows: SourceCategoryRow[];
  sources: Map<string, Source>;
  categories: Map<string, CategoryRow>;
}) {
  const agg = new Map<
    string,
    { sum: number; n: number; total: number; topCat: Map<string, number> }
  >();
  for (const r of rows) {
    const cur =
      agg.get(r.source_id) ??
      { sum: 0, n: 0, total: 0, topCat: new Map<string, number>() };
    cur.total += r.ai_count;
    if (r.temperature != null) {
      cur.sum += r.temperature * r.ai_count;
      cur.n += r.ai_count;
    }
    cur.topCat.set(
      r.category_slug,
      (cur.topCat.get(r.category_slug) ?? 0) + r.ai_count,
    );
    agg.set(r.source_id, cur);
  }

  const ranked = [...agg.entries()]
    .map(([sourceId, v]) => ({
      source: sources.get(sourceId),
      total: v.total,
      meanTemp: v.n > 0 ? v.sum / v.n : null,
      topCat: [...v.topCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .filter((r) => r.source && r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  if (ranked.length === 0) {
    return <p style={{ opacity: 0.6 }}>Ingen data ennå.</p>;
  }

  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid oklch(0.85 0 0)" }}>
          <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Kilde</th>
          <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
            Artikler
          </th>
          <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
            Temp.
          </th>
          <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>
            Toppkategori
          </th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((r) => {
          const catLabel = r.topCat
            ? categories.get(r.topCat)?.label_no ?? r.topCat
            : "—";
          return (
            <tr
              key={r.source!.id}
              style={{ borderBottom: "1px solid oklch(0.94 0 0)" }}
            >
              <td style={{ padding: "0.5rem 0.75rem" }}>
                <strong>{r.source!.name}</strong>{" "}
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.75rem",
                    opacity: 0.6,
                  }}
                >
                  {r.source!.domain}
                </span>
              </td>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.total.toLocaleString("nb-NO")}
              </td>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "right",
                  background: tempColor(r.meanTemp),
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.meanTemp != null ? r.meanTemp.toFixed(2) : "—"}
              </td>
              <td style={{ padding: "0.5rem 0.75rem" }}>{catLabel}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Cheap ISO-week (YYYY-Www) — no leap-year edge cases needed for our 12-week
// window.
function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = Math.round(
    1 +
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
