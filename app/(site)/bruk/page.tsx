// app/(site)/bruk/page.tsx — 5th pillar landing page.
//
// Single-page vertical scroll (deliberate departure from the other pillars'
// time-range Scroller pattern — bruk data is cross-sectional, not time-series).
// Layout: PillarHero with current KPIs → survey form → aggregate stats → FAQ
// → methodology link.

import type { Metadata } from "next";

import { sb } from "@/lib/supabase";

import { PillarHero } from "../_components/pillar-hero";
import { BransjeHeatmap } from "./_components/bransje-heatmap";
import { FrequencyDonut } from "./_components/frequency-donut";
import { type TaxonomyOption } from "./_components/survey-form";
import { ToolBars } from "./_components/tool-bars";
import { TrendLine } from "./_components/trend-line";
import { UseCaseBars } from "./_components/use-case-bars";
import { WorkplaceDonut } from "./_components/workplace-donut";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Bruk",
  description:
    "Hvordan bruker nordmenn AI? Selvrapportert kartlegging av verktøy, bruksområder og frekvens.",
  alternates: { canonical: "/bruk" },
  openGraph: { url: "/bruk", title: "Bruk · Kibarometer" },
};

export const revalidate = 60;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/bruk#webpage`,
  url: `${SITE_URL}/bruk`,
  name: "Bruk",
  inLanguage: "nb-NO",
};

type AggregateRow = {
  cut: string;
  bucket: string;
  confirmed_count: number;
  share_pct: number | null;
};

type TaxonomyRow = { slug: string; title: string };

function formatNumber(n: number): string {
  return new Intl.NumberFormat("nb-NO").format(n);
}

function formatPercent(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(p)} %`;
}

const TOOL_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  perplexity: "Perplexity",
  lokal: "Lokal modell",
  andre: "Andre",
  "vil-ikke-svare": "Vil ikke svare",
};

const FREQUENCY_LABELS: Record<string, string> = {
  daglig: "Hver dag",
  ukentlig: "Flere ganger i uken",
  "av-og-til": "Av og til",
  "proevd-ikke-regelmessig": "Har prøvd, ikke regelmessig",
  aldri: "Aldri",
};

const USE_CASE_LABELS: Record<string, string> = {
  skriving: "Skriving",
  soek: "Søk og research",
  oppsummering: "Oppsummering",
  koding: "Programmering",
  oversettelse: "Oversettelse",
  laering: "Læring",
  idemyldring: "Idémyldring",
  bildegen: "Bildegenerering",
  dataanalyse: "Dataanalyse",
  underholdning: "Underholdning",
  annet: "Annet",
};

export default async function BrukPage() {
  // Fetch the taxonomy for the form's bransje dropdown + the aggregate
  // snapshot for the stats section. Both are public-readable.
  const [taxonomyRows, aggregateRows] = await Promise.all([
    sb<TaxonomyRow[]>(
      "/taxonomy_categories?retired_at=is.null&select=slug,title&order=sort_order.asc,title.asc",
    ).catch(() => [] as TaxonomyRow[]),
    sb<AggregateRow[]>(
      "/bruk_aggregate_snapshot?select=cut,bucket,confirmed_count,share_pct&order=cut.asc,confirmed_count.desc",
    ).catch(() => [] as AggregateRow[]),
  ]);

  const taxonomyOptions: TaxonomyOption[] = taxonomyRows.map((r) => ({
    slug: r.slug,
    title: r.title,
  }));

  // Bucket the aggregate rows by cut so the stats blocks below can look up
  // what they need.
  const byCut = new Map<string, AggregateRow[]>();
  for (const r of aggregateRows) {
    const list = byCut.get(r.cut) ?? [];
    list.push(r);
    byCut.set(r.cut, list);
  }

  const overall = byCut.get("overall")?.[0];
  const totalConfirmed = overall?.confirmed_count ?? 0;

  const frequencyRows = byCut.get("by_q2_frequency") ?? [];
  const weeklyPlusCount = frequencyRows
    .filter((r) => r.bucket === "daglig" || r.bucket === "ukentlig")
    .reduce((acc, r) => acc + r.confirmed_count, 0);
  const weeklyPlusPct =
    totalConfirmed > 0 ? (weeklyPlusCount / totalConfirmed) * 100 : null;

  const toolRows = byCut.get("by_q3_tool") ?? [];
  const topTool = toolRows[0];
  const topToolLabel = topTool ? TOOL_LABELS[topTool.bucket] ?? topTool.bucket : null;

  const bransjeRows = byCut.get("by_q1_bransje") ?? [];
  const bransjeCount = bransjeRows.length;

  const useCaseRows = byCut.get("by_q4_use_case") ?? [];
  const workplaceRows = byCut.get("by_q5_policy") ?? [];
  const heatmapRows = byCut.get("by_q1_q2_heatmap") ?? [];
  const trendRows = byCut.get("by_week_confirmed") ?? [];

  const taxonomyLabel = (slug: string): string => {
    if (slug === "privatperson") return "Privatperson";
    return taxonomyOptions.find((t) => t.slug === slug)?.title ?? slug;
  };

  const hasData = totalConfirmed > 0;

  return (
    <main>
      <section className="mx-auto w-full max-w-4xl px-6 pt-12 sm:pt-16">
        <PillarHero
          breadcrumb="Pillar"
          title="Bruk"
          description="Hvordan bruker nordmenn AI? Selvrapportert kartlegging av hvilke verktøy folk faktisk bruker, hva de bruker dem til, og hvor ofte. Aggregerte, anonymiserte tall — vi viser aldri individuelle svar."
          big={{
            value: hasData ? formatNumber(totalConfirmed) : "—",
            caption: hasData ? "bekreftede svar" : "Ingen svar registrert ennå",
          }}
          stats={[
            {
              label: "Ukentlig+",
              value: hasData ? formatPercent(weeklyPlusPct) : "—",
              hint: "bruker AI minst ukentlig",
            },
            {
              label: "Mest brukte verktøy",
              value: topToolLabel ?? "—",
              hint: hasData && topTool
                ? `${formatPercent(topTool.share_pct)} av brukerne`
                : "kommer når svar er inne",
            },
            {
              label: "Bransjer representert",
              value: hasData ? formatNumber(bransjeCount) : "—",
              hint: "ulike sektorer har svart",
            },
          ]}
        />
      </section>

      {/* Survey form intentionally hidden while the /bruk pillar is paused.
          Stops new pending bruk_responses from accumulating past the
          30-day GDPR retention window (the sweep lives inside the paused
          refresh_bruk_aggregate_snapshot() RPC — see
          supabase/migrations/0073_bruk_responses.sql:317-319 and
          scripts/fetcher-crontab). Existing magic-link confirmation
          (/bruk/bekreft) and self-serve delete (/bruk/slett) flows are
          unaffected. Restore by reverting this hunk. */}
      <section className="mx-auto mt-16 w-full max-w-3xl px-6">
        <div className="rounded-lg border border-dashed border-border bg-muted/40 px-5 py-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            Kartleggingen tar imot ikke nye svar akkurat nå.
          </p>
          <p className="mt-2">
            Vi har midlertidig pauset innsamlingen mens vi gjør endringer
            i opplegget. Allerede sendte bekreftelseslenker virker
            fortsatt, og du kan slette svarene dine når som helst.
          </p>
        </div>
      </section>

      {hasData ? (
        <section className="mx-auto mt-16 w-full max-w-5xl px-6">
          <header className="mb-6">
            <h2 className="text-2xl font-medium tracking-tight">
              Aggregerte tall
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Snapshot fra mens innsamlingen var åpen. Tallene baserer
              seg på {formatNumber(totalConfirmed)} bekreftede svar og
              oppdateres ikke før kartleggingen tas opp igjen.
            </p>
          </header>

          <div className="grid gap-6 sm:grid-cols-2">
            <ChartCard
              title="Brukshyppighet"
              note="Hvor ofte respondentene bruker AI-verktøy."
            >
              <FrequencyDonut rows={frequencyRows} />
            </ChartCard>
            <ChartCard
              title="Arbeidsplassens AI-policy"
              note={
                workplaceRows.length > 0
                  ? "Bransje-respondenter. Privatpersoner ikke inkludert."
                  : "Krever bransje-respondenter. Ingen ennå."
              }
            >
              <WorkplaceDonut rows={workplaceRows} />
            </ChartCard>
            <ChartCard
              title="Verktøy"
              note="Flervalg — summen overstiger 100 %."
            >
              <ToolBars rows={toolRows} />
            </ChartCard>
            <ChartCard
              title="Bruksområder"
              note="Flervalg — summen overstiger 100 %."
            >
              <UseCaseBars rows={useCaseRows} />
            </ChartCard>
          </div>

          {trendRows.length >= 2 ? (
            <ChartCard
              title="Ukentlig vekst"
              note="Antall nye bekreftede svar per uke."
              className="mt-6"
            >
              <TrendLine rows={trendRows} />
            </ChartCard>
          ) : null}

          {heatmapRows.length > 0 ? (
            <ChartCard
              title="Bransje × hyppighet"
              note="Andelen i hver bransje på hver frekvens. Mørkere celle = høyere andel innen bransjen."
              className="mt-6"
            >
              <BransjeHeatmap
                rows={heatmapRows}
                taxonomyLabel={taxonomyLabel}
              />
            </ChartCard>
          ) : null}

          {bransjeRows.length > 0 ? (
            <div className="mt-6">
              <StatBlock
                title="Bransje (alle respondenter)"
                rows={bransjeRows.map((r) => ({
                  label: taxonomyLabel(r.bucket),
                  count: r.confirmed_count,
                  share: r.share_pct,
                }))}
                note="Privatperson + alle yrkesbransjer."
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mx-auto mt-16 mb-20 w-full max-w-3xl px-6">
        <header className="mb-4">
          <h2 className="text-2xl font-medium tracking-tight">
            Om kartleggingen
          </h2>
        </header>
        <dl className="grid gap-5 text-sm">
          <div>
            <dt className="font-medium">Hvem kan svare?</dt>
            <dd className="mt-1 text-muted-foreground">
              Alle. Vi krever bare en gyldig e-postadresse (én registrering
              per e-post). Du behøver ikke være i jobb for å svare.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Hva gjør dere med svarene?</dt>
            <dd className="mt-1 text-muted-foreground">
              Vi publiserer kun aggregerte tall — aldri individuelle
              svar eller e-postadresser. Du kan slette svarene dine når som
              helst via lenken i bekreftelsesmailen.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Er dette et representativt utvalg?</dt>
            <dd className="mt-1 text-muted-foreground">
              Nei. Respondentene har selv valgt å delta, og kommer
              disproporsjonalt fra grupper som er interessert i AI. Tall
              fra denne siden bør siteres som kohortstudie, ikke
              populasjonsstudie.
            </dd>
          </div>
        </dl>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}

function ChartCard({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-5 ${className ?? ""}`}
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex-1">{children}</div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

type StatRow = { label: string; count: number; share: number | null };

function StatBlock({
  title,
  rows,
  note,
}: {
  title: string;
  rows: StatRow[];
  note?: string;
}) {
  const max = Math.max(...rows.map((r) => r.share ?? 0), 1);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(r.count)} · {formatPercent(r.share)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground"
                style={{
                  width: `${Math.min(100, ((r.share ?? 0) / max) * 100)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
