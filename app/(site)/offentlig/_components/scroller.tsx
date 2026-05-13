"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  TimeRangeToggle,
  type Range,
} from "@/app/(site)/_components/time-range-toggle";
import {
  coverageHorizonMs,
  parseRange,
  rangeCutoffMs,
  unavailableRanges,
} from "@/app/(site)/_lib/range";
import { OFFENTLIG_DATA_CUTOFF_MS } from "@/app/(site)/_lib/offentlig-cutoff";
import {
  PillarHero,
  PillarHeroEmpty,
  type PillarHeroStat,
} from "@/app/(site)/_components/pillar-hero";
import { fmtNumber } from "@/app/(site)/_lib/format-headline";

import type {
  OffentligHeadline,
  StortingCategory,
  StortingMonthly,
} from "../page";

import { ComingSoon } from "./coming-soon";
import { DebateCategories } from "./debate-categories";
import { DebateVolume } from "./debate-volume";

const NB = new Intl.NumberFormat("nb-NO");
const NO_LONG_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

type Props = {
  headline: OffentligHeadline | null;
  monthly: StortingMonthly[];
  categories: StortingCategory[];
};

// Adapter: range.ts's coverageHorizonMs reads {published_on|date}, but the
// offentlig snapshot row uses `computed_for`. Map to satisfy the shape.
function monthlyToHorizon(rows: StortingMonthly[]) {
  return rows.map((r) => ({ published_on: r.computed_for }));
}

function formatYoY(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "—";
  const v = Number(pct);
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function Scroller({ headline, monthly, categories }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  // Sync the URL via router.replace with { scroll: false } so the snap-scroll
  // container's scroll position is never perturbed. Mirrors /media's scroller.
  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    const url = qs ? `/offentlig?${qs}` : "/offentlig";
    router.replace(url, { scroll: false });
  }

  // Reference "now" — the latest computed_for across the monthly snapshot.
  // Avoids Date.now() during render so cutoffs are stable across midnight
  // and snapshot reruns. Falls back to 0 when no data; downstream cutoff
  // math handles that (nowMs=0 → all rangeCutoffMs windows = negative, so
  // every row passes the cutoff filter and the empty-state branch renders).
  const nowMs = useMemo(() => {
    let latestMs = 0;
    for (const row of monthly) {
      const t = new Date(row.computed_for + "T00:00:00Z").getTime();
      if (t > latestMs) latestMs = t;
    }
    return latestMs;
  }, [monthly]);

  const coverageMs = useMemo(() => {
    const horizon = coverageHorizonMs(monthlyToHorizon(monthly));
    return Math.max(horizon, OFFENTLIG_DATA_CUTOFF_MS);
  }, [monthly]);

  const disabledRanges = useMemo(
    () => unavailableRanges(coverageMs, nowMs),
    [coverageMs, nowMs],
  );

  const coverageStart = useMemo(() => {
    if (!Number.isFinite(coverageMs)) return null;
    return new Date(coverageMs).toISOString().slice(0, 10);
  }, [coverageMs]);

  const cutoffMs = useMemo(() => rangeCutoffMs(range, nowMs), [range, nowMs]);
  const cutoffPassed = cutoffMs === -Infinity ? null : cutoffMs;

  // Headline stats — pull from the snapshot row when present. Falls back to
  // computing AI-saker total from the monthly snapshot when the headline
  // row hasn't been written yet (first deploy, between snapshot refresh
  // runs, etc.) so the page isn't blank.
  const fallbackTotal = useMemo(() => {
    let n = 0;
    for (const r of monthly) n += r.ai_count;
    return n;
  }, [monthly]);

  const totalAi =
    headline?.total_saker_ai != null
      ? Number(headline.total_saker_ai)
      : fallbackTotal;
  const aiLast12m =
    headline?.total_saker_ai_12m != null
      ? Number(headline.total_saker_ai_12m)
      : null;
  const debateYoy = headline?.debate_yoy_pct ?? null;

  return (
    <div
      className="
        flex flex-col
        sm:h-[calc(100svh-3.5rem)] sm:overflow-y-scroll
        sm:snap-y sm:snap-mandatory
      "
    >
      <section className="snap-segment sm:snap-start sm:snap-always">
        {totalAi > 0 ? (
          (() => {
            const stats: PillarHeroStat[] = [
              {
                label: "AI-saker siste 12 mnd",
                value: aiLast12m != null ? fmtNumber(aiLast12m) : "—",
                hint: aiLast12m == null ? "Snapshot ikke kjørt ennå" : undefined,
              },
              {
                label: "Debatt YoY",
                value: formatYoY(debateYoy),
                hint:
                  debateYoy != null
                    ? "vs forrige 12 mnd"
                    : "Snapshot ikke kjørt ennå",
              },
              {
                label: "Topp komité",
                value: headline?.top_komite_navn ?? "—",
                hint:
                  headline?.top_komite_count != null
                    ? `${NB.format(headline.top_komite_count)} AI-saker siste 24 mnd`
                    : "Snapshot ikke kjørt ennå",
              },
            ];
            const coverageFooter = coverageStart
              ? `Data fra ${NO_LONG_DATE.format(new Date(coverageStart + "T00:00:00Z"))} — kun Stortinget foreløpig`
              : "Stortinget-data ikke ingestert ennå";
            return (
              <PillarHero
                breadcrumb="Offentlig sektor"
                title="Hvordan offentlig sektor møter AI"
                description="Norsk offentlig AI-debatt og -innkjøp. Stortinget-saker er live nå; Doffin-anskaffelser kommer når DFØ aktiverer API-tilgangen vår."
                big={{
                  value: NB.format(totalAi),
                  caption: "AI-flaggede Stortinget-saker totalt",
                }}
                stats={stats}
                footer={coverageFooter}
              />
            );
          })()
        ) : (
          <PillarHeroEmpty
            breadcrumb="Offentlig sektor"
            message="Ingen AI-flaggede saker ingestert ennå. Cron-jobben kjører kl 07:00 UTC daglig — eller trigg backfill fra /admin/offentlig."
          />
        )}
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              AI-debatt i Stortinget over tid
            </h2>
            <TimeRangeToggle
              value={range}
              onChange={onRangeChange}
              disabledValues={disabledRanges}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Månedlig volum av AI-flaggede saker i Stortinget. Inkluderer både
            saker som har gått gjennom Tier 2-kategorisering og de som ennå
            ikke er kategorisert.
          </p>
          <div className="min-h-0 flex-1">
            <DebateVolume rows={monthly} cutoffMs={cutoffPassed} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Hva debatteres? — kategorier
            </h2>
            <TimeRangeToggle
              value={range}
              onChange={onRangeChange}
              disabledValues={disabledRanges}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Fordeling av AI-flaggede saker etter politikkområde. Kategoriene
            tildeles av en lokal språkmodell (Tier 2). Saker som ennå ikke er
            kategorisert vises under listen.
          </p>
          <div className="min-h-0 flex-1">
            <DebateCategories
              rows={monthly}
              categories={categories}
              cutoffMs={cutoffPassed}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <ComingSoon />
      </section>
    </div>
  );
}
