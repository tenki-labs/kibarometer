// app/(site)/oppstart/page.tsx — public /oppstart dashboard.
//
// Server component. Reads from public-RLS brreg_snapshot_* tables via the
// anon key (no service-role calls from the marketing surface). ISR 60 s.
//
// Five sections (per the approved plan §"Public surface — /oppstart"):
//   1. Hero — counts + AI-relevant share + organisasjonsform mix among
//      AI-relevant + median aksjekapital comparison + acceleration
//   2. Nye foretak per kategori (last 90 days)
//   3. Goldrush-diagnose: AI-relevant share trend + cohort survival
//   4. Grunderalder i utvalgte kategorier (focus_daily aggregated by
//      quarter + age bucket)
//   5. Geografi — Norway cartogram (reuses /jobbmarked's NorwayMap with
//      brreg-shaped data adapted to its SnapshotGeography prop)
//
// Aggregates only — no person_navn / fodselsdato ever leaves the admin
// surface. NLOD 2.0 attribution rendered in the footer of the page.

import type { Metadata } from "next";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { sb, type SnapshotGeography } from "@/lib/supabase";

import { NorwayMap } from "../jobbmarked/_components/norway-map";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Oppstart",
  description:
    "Nye norske foretak fra Brønnøysundregistrene — daglig oppdaterte tall over registrering, AI-andel, grunderalder og geografi.",
  alternates: { canonical: "/oppstart" },
  openGraph: { url: "/oppstart" },
};

export const revalidate = 60;

// ---- Row types (mirroring the brreg_snapshot_* tables) -----------------

type BrregHeadline = {
  computed_for: string;
  computed_at: string;
  total_7d: number;
  total_30d: number;
  total_30d_yoy: number;
  ai_relevant_count_30d: number;
  ai_relevant_share_30d: number; // 0..1
  it_share_30d: number;
  kreativ_media_share_30d: number;
  tjenester_share_30d: number;
  enriched_combined_share_30d: number;
  as_share_of_ai_relevant_30d: number;
  enk_share_of_ai_relevant_30d: number;
  aksjekapital_median_ai_relevant_as_30d: number | null;
  aksjekapital_median_non_ai_as_30d: number | null;
  ai_relevant_mom_growth: number | null;
  ai_relevant_qoq_growth: number | null;
};

type BrregDaily = {
  registrert_dato: string;
  nace_category_slug: string;
  count: number;
  ai_relevant_count: number;
  young_founder_count: number;
};

type BrregFocusDaily = {
  registrert_dato: string;
  nace_category_slug: string;
  total: number;
  ai_relevant: number;
  age_under_23: number;
  age_23_29: number;
  age_30_39: number;
  age_40_49: number;
  age_50_plus: number;
  age_unknown: number;
};

type BrregGeography = {
  fylke: string;
  count_30d: number;
  ai_relevant_count_30d: number;
  count_per_100k_30d: number | null;
};

type BrregCohort = {
  cohort_quarter: string;
  is_ai_relevant: boolean;
  total_at_registration: number;
  still_active_count: number;
  slettet_count: number;
  konkurs_count: number;
  survival_rate_pct: number;
};

// ---- Helpers ------------------------------------------------------------

const NB = new Intl.NumberFormat("nb-NO");

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)} %`;
}

function pp(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "↑" : n < 0 ? "↓" : "—";
  return `${sign} ${(Math.abs(n) * 100).toFixed(digits)} %`;
}

const CATEGORY_LABELS: Record<string, string> = {
  it: "Informasjonsteknologi",
  "kreativ-media": "Media og kreativ næring",
  tjenester: "Faglige og tekniske tjenester",
  industri: "Industri og produksjon",
  bygg: "Bygg og anlegg",
  handel: "Handel og varehandel",
  transport: "Transport og lager",
  overnatting: "Overnatting og servering",
  finans: "Finans og forsikring",
  eiendom: "Eiendom",
  helse: "Helse og omsorg",
  offentlig: "Offentlig sektor og utdanning",
  annet: "Annet / uklassifisert",
};

const FOCUS_CATEGORIES = ["it", "kreativ-media", "tjenester"] as const;

// ---- Page ---------------------------------------------------------------

export default async function OppstartPage() {
  const [headlineRows, daily, focusDaily, geography, cohort] = await Promise.all([
    sb<BrregHeadline[]>(
      "/brreg_snapshot_headline?order=computed_for.desc&limit=1",
    ),
    sb<BrregDaily[]>(
      "/brreg_snapshot_daily?order=registrert_dato.desc&limit=2000",
    ),
    sb<BrregFocusDaily[]>(
      "/brreg_snapshot_focus_daily?order=registrert_dato.desc&limit=2000",
    ),
    sb<BrregGeography[]>(
      "/brreg_snapshot_geography?order=count_30d.desc",
    ),
    sb<BrregCohort[]>(
      "/brreg_snapshot_cohort?order=cohort_quarter.asc",
    ),
  ]);

  const headline = headlineRows[0] ?? null;

  // Per-category 90-day totals for segment 2.
  const since90d = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const categoryTotals = new Map<string, { count: number; ai: number }>();
  for (const row of daily) {
    if (row.registrert_dato < since90d) continue;
    const cur = categoryTotals.get(row.nace_category_slug) ?? { count: 0, ai: 0 };
    cur.count += row.count;
    cur.ai += row.ai_relevant_count;
    categoryTotals.set(row.nace_category_slug, cur);
  }
  const categoriesSorted = Array.from(categoryTotals.entries())
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count);
  const grand90 = categoriesSorted.reduce((s, c) => s + c.count, 0);

  // Per-quarter age distribution for FOCUS_CATEGORIES (segment 4).
  type AgeBucket = {
    quarter: string;
    category: string;
    total: number;
    under23: number;
    a23_29: number;
    a30_39: number;
    a40_49: number;
    a50_plus: number;
    unknown: number;
  };
  const ageMap = new Map<string, AgeBucket>();
  for (const row of focusDaily) {
    if (!FOCUS_CATEGORIES.includes(row.nace_category_slug as (typeof FOCUS_CATEGORIES)[number])) continue;
    const d = new Date(row.registrert_dato);
    const q = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const key = `${q}|${row.nace_category_slug}`;
    const cur = ageMap.get(key) ?? {
      quarter: q,
      category: row.nace_category_slug,
      total: 0,
      under23: 0,
      a23_29: 0,
      a30_39: 0,
      a40_49: 0,
      a50_plus: 0,
      unknown: 0,
    };
    cur.total += row.total;
    cur.under23 += row.age_under_23;
    cur.a23_29 += row.age_23_29;
    cur.a30_39 += row.age_30_39;
    cur.a40_49 += row.age_40_49;
    cur.a50_plus += row.age_50_plus;
    cur.unknown += row.age_unknown;
    ageMap.set(key, cur);
  }
  const ageBuckets = Array.from(ageMap.values()).sort((a, b) => {
    if (a.quarter !== b.quarter) return a.quarter.localeCompare(b.quarter);
    return a.category.localeCompare(b.category);
  });

  // Cohort survival summary.
  const cohortByQuarter = new Map<string, { ai?: BrregCohort; nonAi?: BrregCohort }>();
  for (const c of cohort) {
    const q = (() => {
      const d = new Date(c.cohort_quarter);
      return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    })();
    const cur = cohortByQuarter.get(q) ?? {};
    if (c.is_ai_relevant) cur.ai = c;
    else cur.nonAi = c;
    cohortByQuarter.set(q, cur);
  }
  const cohortRows = Array.from(cohortByQuarter.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  // Adapt brreg geography into the NAV NorwayMap's prop shape.
  const geoForMap: SnapshotGeography[] = geography.map((g) => ({
    county: g.fylke,
    ai_count_30d: g.ai_relevant_count_30d,
    total_count_30d: g.count_30d,
  }));

  const computedAt = headline?.computed_at
    ? new Date(headline.computed_at).toLocaleString("nb-NO")
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/oppstart#webpage`,
    url: `${SITE_URL}/oppstart`,
    name: "Oppstart",
    inLanguage: "nb-NO",
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      {/* ---- 1. Hero ---- */}
      <header className="border-b pb-10">
        <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Oppstartsbarometeret
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Norske oppstartsbedrifter
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Daglig oppdatert oversikt over nyregistrerte foretak fra
          Brønnøysundregistrene. Andelen AI-merkede selskaper, fordelingen
          mellom selskapsformer, og grunderaldre i IT, kreative næringer og
          faglige tjenester.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Nye foretak siste 30 dager"
            value={fmt(headline?.total_30d)}
            hint={`${fmt(headline?.total_7d)} siste 7 dager`}
          />
          <Stat
            label="Med AI eller KI i navn / aktivitet"
            value={fmt(headline?.ai_relevant_count_30d)}
            hint={`${pct(headline?.ai_relevant_share_30d)} av totalen`}
          />
          <Stat
            label="Andel i IT, kreativ og tjenester"
            value={pct(headline?.enriched_combined_share_30d)}
            hint={`IT ${pct(headline?.it_share_30d)} · kreativ ${pct(headline?.kreativ_media_share_30d)} · tjenester ${pct(headline?.tjenester_share_30d)}`}
          />
          <Stat
            label="Selskapsform blant AI-relevante"
            value={pct(headline?.as_share_of_ai_relevant_30d)}
            hint={`AS · ENK ${pct(headline?.enk_share_of_ai_relevant_30d)} · annet ${pct(
              headline
                ? 1 -
                    headline.as_share_of_ai_relevant_30d -
                    headline.enk_share_of_ai_relevant_30d
                : null,
            )}`}
          />
          <Stat
            label="Median aksjekapital, AI-relevante AS"
            value={
              headline?.aksjekapital_median_ai_relevant_as_30d !== null &&
              headline?.aksjekapital_median_ai_relevant_as_30d !== undefined
                ? `${fmt(headline.aksjekapital_median_ai_relevant_as_30d)} kr`
                : "—"
            }
            hint={
              headline?.aksjekapital_median_non_ai_as_30d !== null &&
              headline?.aksjekapital_median_non_ai_as_30d !== undefined
                ? `vs. ${fmt(headline.aksjekapital_median_non_ai_as_30d)} kr (ikke-AI)`
                : "Sammenlign med ikke-AI mangler"
            }
          />
          <Stat
            label="Veksttakt for AI-relevante"
            value={pp(headline?.ai_relevant_mom_growth)}
            hint={`måned-over-måned (kvartal: ${pp(headline?.ai_relevant_qoq_growth)})`}
          />
        </div>

        {computedAt && (
          <p className="mt-6 text-xs text-muted-foreground">
            Sist oppdatert: {computedAt}.
          </p>
        )}
      </header>

      {/* ---- 2. Volume by category (last 90 days) ---- */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Nye foretak per næringskategori
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Siste 90 dager, gruppert etter kibarometer-kategorier (kollapset
          fra ~700 SN2007/SN2025-09-koder til 13 grupper). AI-relevante
          foretak telles separat.
        </p>
        <Card className="mt-6">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right tabular-nums">Foretak</TableHead>
                  <TableHead className="text-right tabular-nums">Andel</TableHead>
                  <TableHead className="text-right tabular-nums">AI-relevante</TableHead>
                  <TableHead>Visualisering</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoriesSorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Ingen data ennå — bootstrap eller daglig henting kjøres etter første deploy.
                    </TableCell>
                  </TableRow>
                ) : (
                  categoriesSorted.map((c) => (
                    <TableRow key={c.slug}>
                      <TableCell className="text-sm">
                        {CATEGORY_LABELS[c.slug] ?? c.slug}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(c.count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {grand90 > 0 ? `${((c.count / grand90) * 100).toFixed(1)} %` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(c.ai)}
                      </TableCell>
                      <TableCell className="w-[40%]">
                        <Bar share={grand90 > 0 ? c.count / grand90 : 0} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* ---- 3. Goldrush-diagnose: cohort survival ---- */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Goldrush-diagnose: overlevelse i kohortene
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Andel foretak som fortsatt er aktive (ikke konkurs, ikke slettet),
          gruppert per registreringskvartal. AI-relevante foretak vs. ikke-AI
          som kontroll.
        </p>
        <Card className="mt-6">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kvartal</TableHead>
                  <TableHead className="text-right tabular-nums">AI-rel. foretak</TableHead>
                  <TableHead className="text-right tabular-nums">Overlever (AI)</TableHead>
                  <TableHead className="text-right tabular-nums">Ikke-AI foretak</TableHead>
                  <TableHead className="text-right tabular-nums">Overlever (ikke-AI)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohortRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Ingen kohort-data ennå.
                    </TableCell>
                  </TableRow>
                ) : (
                  cohortRows.map(([q, c]) => (
                    <TableRow key={q}>
                      <TableCell className="font-mono text-xs">{q}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(c.ai?.total_at_registration ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {c.ai ? `${c.ai.survival_rate_pct.toFixed(1)} %` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(c.nonAi?.total_at_registration ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {c.nonAi ? `${c.nonAi.survival_rate_pct.toFixed(1)} %` : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* ---- 4. Founder age in enriched categories ---- */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Grunderalder i utvalgte kategorier
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          For IT, kreativ næring og faglige tjenester:{" "}
          <em>yngste styremedlem eller daglige leder ved registrering</em>{" "}
          (eldre enn ELI-standarden, men eneste tilgjengelige proxy uten
          Foretaksregisterets betalte stiftelsesdokument-oppslag).
        </p>
        <Card className="mt-6">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kvartal</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right tabular-nums">Totalt</TableHead>
                  <TableHead className="text-right tabular-nums">Under 23</TableHead>
                  <TableHead className="text-right tabular-nums">23–29</TableHead>
                  <TableHead className="text-right tabular-nums">30–39</TableHead>
                  <TableHead className="text-right tabular-nums">40–49</TableHead>
                  <TableHead className="text-right tabular-nums">50+</TableHead>
                  <TableHead className="text-right tabular-nums">Ukjent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ageBuckets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      Ingen rolle-data ennå. Krever at brreg-roller-køen drenes for kategoriene over.
                    </TableCell>
                  </TableRow>
                ) : (
                  ageBuckets.slice(-30).map((b) => (
                    <TableRow key={`${b.quarter}-${b.category}`}>
                      <TableCell className="font-mono text-xs">{b.quarter}</TableCell>
                      <TableCell className="text-xs">
                        {CATEGORY_LABELS[b.category] ?? b.category}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {b.under23 > 0 ? <Badge variant="secondary">{b.under23}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.a23_29 || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.a30_39 || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.a40_49 || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{b.a50_plus || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {b.unknown || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* ---- 5. Geography ---- */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Geografi — nye foretak per fylke
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Siste 30 dager. Fargekart skalert til AI-andel per fylke.
        </p>
        <Card className="mt-6">
          <CardContent>
            <Suspense fallback={null}>
              <NorwayMap geography={geoForMap} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      {/* ---- Footer / methodology ---- */}
      <footer className="mt-20 border-t pt-8 text-xs text-muted-foreground">
        <p>
          <strong>Inneholder data under NLOD 2.0 tilgjengeliggjort av
            Brønnøysundregistrene.</strong>{" "}
          Vi henter åpent register-data fra <code>data.brreg.no</code> og
          beregner aggregater. Personopplysninger på rolle-holdere
          (fødselsdato, navn) lagres kun for analyse, vises aldri på
          offentlige sider, og slettes 5 år etter at foretaket er slettet
          fra brreg.
        </p>
        <p className="mt-3">
          Cite-bart JSON-endepunkt:{" "}
          <code className="text-[0.75rem]">
            {`${SITE_URL}/api/v1/oppstart/snapshot`}
          </code>
          .
        </p>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

// ---- Helpers used inside the page --------------------------------------

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="gap-3 p-6">
      <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-semibold leading-none tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

function Bar({ share }: { share: number }) {
  const pctVal = Math.max(0, Math.min(100, share * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground/70"
        style={{ width: `${pctVal}%` }}
        aria-hidden
      />
    </div>
  );
}
