// app/(site)/jobb-barometer/page.tsx — Kibarometer dashboard.
// Server component. Reads URL params, fetches snapshots in parallel, renders
// four sections (headline, trend, top-keywords, yrkeskategori + geografi).
//
// URL params:
//   ?as_of=YYYY-MM-DD    Pin the headline to a historical snapshot. Falls
//                        back to most-recent if the date has no row.
//   ?trend=share         Toggle the trend chart to share-of-all (default: absolute)
//   ?sort=yoy            Sort top-keywords by yoy_growth_pct desc (default: rank)
//   ?embed=headline      Reserved — see app/embed/* for stable embed routes.
//
// Snapshots are pre-computed by 0008's refresh_all_snapshots() job at 04:00
// daily; this page is just six PostgREST reads behind a 60s ISR.

import type { Metadata } from "next";
import Link from "next/link";

import {
  HBarList,
  LOW_SAMPLE_THRESHOLD,
  SkillCategoriesList,
  Sparkline,
  TrendChart,
} from "@/app/_components/charts";
import {
  sb,
  type SnapshotCategory,
  type SnapshotDaily,
  type SnapshotGeography,
  type SnapshotHeadline,
  type SnapshotKeyword,
  type SnapshotMonthly,
  type SnapshotSkillCategory,
  type TaxonomyCategory,
} from "@/lib/supabase";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Jobb-barometer",
  description:
    "AI-relaterte stillinger i norsk arbeidsmarked — daglig oppdaterte tall fra NAVs stillingsfeed.",
  alternates: { canonical: "/jobb-barometer" },
  openGraph: { url: "/jobb-barometer" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NO_DATE_FORMATTER = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const NO_DATE_ONLY = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function fmtDateTime(iso: string): string {
  return NO_DATE_FORMATTER.format(new Date(iso));
}
function fmtDate(iso: string): string {
  return NO_DATE_ONLY.format(new Date(iso));
}

// One-line auto-headline above the big number. Reads delta vs prior 30d.
function headlineSentence(h: SnapshotHeadline): string {
  if (h.ai_count_prev_30d === 0) {
    return h.ai_count_30d > 0
      ? "AI-relaterte stillinger har vokst fra ingenting siste 30 dager."
      : "Ingen AI-relaterte stillinger i feeden ennå.";
  }
  const delta = ((h.ai_count_30d - h.ai_count_prev_30d) / h.ai_count_prev_30d) * 100;
  const abs = Math.abs(delta);
  if (abs < 5) {
    return "AI-relaterte stillinger er omtrent uendret sammenlignet med forrige 30 dager.";
  }
  const verb = delta > 0 ? "økte" : "falt";
  return `AI-relaterte stillinger ${verb} ${abs.toFixed(1)} % sammenlignet med forrige 30 dager.`;
}

// Merge URL search params with overrides — used by tab links so `?trend=share`
// preserves any existing `as_of`.
function mergeQs(
  current: Record<string, string | string[] | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v[0] ?? "" : v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) qs.delete(k);
    else qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Tenki Labs",
      url: "https://tenki.no",
      logo: `${SITE_URL}/icon`,
      founder: {
        "@type": "Person",
        name: "Oscar Gangstad Westbye",
        url: "https://tenki.no",
      },
    },
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/jobb-barometer#webpage`,
      url: `${SITE_URL}/jobb-barometer`,
      name: "Jobb-barometer",
      inLanguage: "nb-NO",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function JobbBarometerPage({
  searchParams,
}: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const asOf = firstParam(sp.as_of);
  const trendMode = firstParam(sp.trend) === "share" ? "share" : "absolute";
  const kwSort = firstParam(sp.sort) === "yoy" ? "yoy" : "count";
  const today = new Date().toISOString().slice(0, 10);
  const headlineCutoff = asOf ?? today;

  const [
    headlineRows,
    monthly,
    daily,
    keywords,
    geography,
    category,
    skillLatest,
    taxonomy,
  ] = await Promise.all([
    // Pinned date or fall back to most recent ≤ cutoff.
    sb<SnapshotHeadline[]>(
      `/snapshot_headline?computed_for=lte.${headlineCutoff}&order=computed_for.desc&limit=1`,
    ),
    sb<SnapshotMonthly[]>("/snapshot_monthly?order=posted_month.asc"),
    sb<SnapshotDaily[]>("/snapshot_daily?order=posted_on.desc&limit=30"),
    sb<SnapshotKeyword[]>(
      kwSort === "yoy"
        ? "/snapshot_keywords?order=yoy_growth_pct.desc.nullslast&limit=20"
        : "/snapshot_keywords?order=rank.asc&limit=20",
    ),
    sb<SnapshotGeography[]>("/snapshot_geography?order=ai_count_30d.desc"),
    sb<SnapshotCategory[]>("/snapshot_category?order=ai_count_30d.desc&limit=10"),
    // Pick the latest computed_for in one query, then fetch its rows. Two
    // round-trips, but each is cheap (PK index lookup). The first query
    // returns at most one row regardless of slug count.
    sb<{ computed_for: string }[]>(
      "/snapshot_skill_categories?select=computed_for&order=computed_for.desc&limit=1",
    ),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc",
    ),
  ]);

  const skillLatestDate = skillLatest[0]?.computed_for;
  const skillCategories = skillLatestDate
    ? await sb<SnapshotSkillCategory[]>(
        `/snapshot_skill_categories?computed_for=eq.${skillLatestDate}`,
      )
    : [];

  const headline = headlineRows[0];

  if (!headline) {
    return (
      <main className="dash">
        <div className="chart-empty" style={{ padding: "4rem 1rem" }}>
          Snapshots ikke regnet ennå. Kjør refresh i admin.
        </div>
      </main>
    );
  }

  // Sparkline: chronological order, AI-only.
  const sparkValues = [...daily].reverse().map((d) => d.ai_count);

  return (
    <main className="dash">
      {/* ---------- HEADLINE STRIP ---------- */}
      <section aria-labelledby="headline-h">
        <h1 id="headline-h" className="eyebrow">· AI-stillinger denne uken</h1>
        <div className="headline">
          <div>
            <p className="headline-sentence">{headlineSentence(headline)}</p>
            <div className="headline-stamp">
              Sist oppdatert: {fmtDateTime(headline.computed_at)}.{" "}
              {asOf && (
                <>
                  Historisk øyeblikksbilde for {fmtDate(headline.computed_for)}.{" "}
                  <Link href="/jobb-barometer">Vis siste</Link>.
                </>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="headline-number">
              {headline.ai_count_7d.toLocaleString("nb-NO")}
            </div>
            <div className="headline-number-label">siste 7 dager</div>
            <div style={{ marginTop: "0.6rem" }}>
              <Sparkline values={sparkValues} label="AI-stillinger per dag, siste 30 dager" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- TREND ---------- */}
      <section className="section" aria-labelledby="trend-h">
        <div className="section-head">
          <h2 id="trend-h">Trend</h2>
          <div className="section-tabs" role="tablist">
            <a
              href={mergeQs(sp, { trend: undefined })}
              aria-current={trendMode === "absolute" ? "true" : undefined}
            >
              Antall
            </a>
            <a
              href={mergeQs(sp, { trend: "share" })}
              aria-current={trendMode === "share" ? "true" : undefined}
            >
              Andel
            </a>
          </div>
        </div>
        <TrendChart monthly={monthly} mode={trendMode} />
      </section>

      {/* ---------- TOP KEYWORDS ---------- */}
      <section className="section" aria-labelledby="kw-h">
        <div className="section-head">
          <h2 id="kw-h">Top nøkkelord, siste 30 dager</h2>
          <div className="section-tabs">
            <a
              href={mergeQs(sp, { sort: undefined })}
              aria-current={kwSort === "count" ? "true" : undefined}
            >
              Antall ↓
            </a>
            <a
              href={mergeQs(sp, { sort: "yoy" })}
              aria-current={kwSort === "yoy" ? "true" : undefined}
            >
              YoY ↓
            </a>
          </div>
        </div>
        {keywords.length === 0 ? (
          <div className="chart-empty">Ingen nøkkelord-treff i siste 30 dager ennå.</div>
        ) : (
          <table className="kw-table">
            <thead>
              <tr>
                <th>Nøkkelord</th>
                <th>Kategori</th>
                <th className="num">Antall</th>
                <th className="num">YoY</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => {
                const lowSample = k.ai_count_30d < LOW_SAMPLE_THRESHOLD;
                const yoy = k.yoy_growth_pct === null
                  ? "ny"
                  : `${k.yoy_growth_pct > 0 ? "+" : ""}${k.yoy_growth_pct.toFixed(1)} %`;
                return (
                  <tr key={k.keyword} className={lowSample ? "low-sample" : undefined}>
                    <td>
                      <a href={`/metode#kw-${encodeURIComponent(k.keyword)}`}>{k.keyword}</a>
                    </td>
                    <td>{k.category && <span className="kw-cat">{k.category}</span>}</td>
                    <td className="num">{k.ai_count_30d.toLocaleString("nb-NO")}</td>
                    <td className="num">{yoy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------- AI-FERDIGHETSKATEGORIER ---------- */}
      <section className="section" aria-labelledby="skill-cat-h">
        <div className="section-head">
          <h2 id="skill-cat-h">AI-ferdighetskategorier, siste 30 dager</h2>
        </div>
        <SkillCategoriesList rows={skillCategories} taxonomy={taxonomy} />
        <p className="meta" style={{ marginTop: "0.75rem" }}>
          Klassifisert av en språkmodell — én stilling kan tilhøre flere
          kategorier. <a href="/metode#taksonomi">Se taksonomien og metoden</a>.
        </p>
      </section>

      {/* ---------- YRKESKATEGORI + GEOGRAFI ---------- */}
      <section className="section">
        <div className="two-col">
          <div>
            <div className="section-head"><h2>Yrkeskategori</h2></div>
            <HBarList
              rows={category.map((c) => ({
                label: c.category,
                value: c.ai_count_30d,
                total: c.total_count_30d,
              }))}
            />
          </div>
          <div>
            <div className="section-head"><h2>Geografi</h2></div>
            <HBarList
              rows={geography.map((g) => ({
                label: g.county,
                value: g.ai_count_30d,
                total: g.total_count_30d,
              }))}
            />
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
