import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { cn } from "@/lib/utils";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import {
  burstStortingTier1Action,
  burstStortingTier2Action,
  reprocessKeywordsAction,
} from "../actions";
import { oracleAcceptAction, oracleMarkNotAiAction } from "./actions";

export const dynamic = "force-dynamic";

type Tab = "ingest" | "oracle";

type CountRow = { count: number };

type OracleRow = {
  sak_id: number;
  tittel: string;
  korttittel: string | null;
  sesjon_id: string | null;
  komite_navn: string | null;
  tier2_completed_at: string;
  llm_categories: {
    categories?: { slug: string; confidence: number }[];
    rationale?: string;
    operator_override?: boolean;
  } | null;
};

type CorrectionLog = {
  id: number;
  source_id: string;
  action: "accept" | "replace" | "mark_not_ai";
  accepted_slug: string | null;
  proposed_slug: string | null;
  notes: string | null;
  corrected_at: string;
};

function strParam(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

function isTab(s: string | null): s is Tab {
  return s === "ingest" || s === "oracle";
}

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QueuePage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab = isTab(strParam(sp.tab)) ? (strParam(sp.tab) as Tab) : "ingest";

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Offentlig sektor"
        title="Kø"
        description={
          <>
            Operative triggere og Tier 2-overstyring. Speiler crontab-ene —
            ingen henteoperasjon her endrer atferden til de planlagte
            cron-tick-ene.
          </>
        }
        action={
          <div className="flex gap-2">
            <TabButton
              href="/admin/offentlig/queue?tab=ingest"
              active={tab === "ingest"}
              label="Ingest"
            />
            <TabButton
              href="/admin/offentlig/queue?tab=oracle"
              active={tab === "oracle"}
              label="Orakel"
            />
          </div>
        }
      />

      {tab === "ingest" ? <IngestTab /> : <OracleTab />}
    </>
  );
}

function TabButton({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Button
      asChild
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(active ? "" : "text-muted-foreground")}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}

async function IngestTab() {
  const [tier1Pending, tier2Pending, aiTotal] = await Promise.all([
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&tier1_completed_at=is.null&llm_retry_count=lt.3&ingest_mode=eq.live&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
  ]);

  const t1 = unwrapCount(tier1Pending);
  const t2 = unwrapCount(tier2Pending);
  const aiTot = unwrapCount(aiTotal);

  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Tier 1-kø (live)"
          value={t1.toLocaleString("nb-NO")}
          hint="AI-flaggede saker som ennå venter på frase-ekstraksjon"
        />
        <StatCard
          label="Tier 2-kø"
          value={t2.toLocaleString("nb-NO")}
          hint="AI-flaggede saker uten kategori-tildeling ennå"
        />
        <StatCard
          label="AI-flaggede totalt"
          value={aiTot.toLocaleString("nb-NO")}
          hint="Nøkkelord-treff på tittel + emner ved ingest"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Burst LLM
          </CardTitle>
          <CardDescription>
            Drenér Tier 1- og Tier 2-køen raskere enn de planlagte 15- og 4-rad-tick-ene.{" "}
            Tier 1 er forward-only på <code className="font-mono">ingest_mode=&apos;live&apos;</code>
            (per CLAUDE.md §2). Tier 2 prosesserer også backfill-rader.
            Skipper stille når <code className="font-mono">MLX_API_KEY</code> ikke er satt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action={burstStortingTier1Action}>
            <Button variant="outline" type="submit">
              Burst Tier 1 (K=100)
            </Button>
          </form>
          <form action={burstStortingTier2Action}>
            <Button variant="outline" type="submit">
              Burst Tier 2 (K=20)
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Re-tag mot nøkkelord-katalog
          </CardTitle>
          <CardDescription>
            Kjør nåværende nøkkelord-matcher mot hver{" "}
            <code className="font-mono">storting_saker</code> og{" "}
            <code className="font-mono">storting_vedtak</code>-rad.{" "}
            Speiler søndags-cron-ticken kl 04:15 UTC. Bruk etter en{" "}
            <Link
              href="/admin/keywords"
              className="underline decoration-dotted underline-offset-4"
            >
              katalog-endring
            </Link>{" "}
            for å unngå drift.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={reprocessKeywordsAction}>
            <Button variant="outline" type="submit">
              Start re-tagging
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

async function OracleTab() {
  // Pull the 30 most recent Tier 2-completed AI-flagged saker that haven't
  // already been operator-overridden. The operator picks ones worth
  // correcting from the list. (Order is newest-first so daily reviews land
  // on fresh material.)
  const rows = await sbFetch<OracleRow[]>(
    `/storting_saker?is_ai_relevant=is.true&tier2_completed_at=not.is.null` +
      `&select=sak_id,tittel,korttittel,sesjon_id,komite_navn,tier2_completed_at,llm_categories` +
      `&order=tier2_completed_at.desc&limit=30`,
    { service: true },
  ).catch(() => [] as OracleRow[]);

  // Recent corrections — show the last 10 so the operator can see
  // their work and verify "mark_not_ai" rows dropped out cleanly.
  const recent = await sbFetch<CorrectionLog[]>(
    `/tier2_corrections?source_table=eq.storting_saker` +
      `&select=id,source_id,action,accepted_slug,proposed_slug,notes,corrected_at` +
      `&order=corrected_at.desc&limit=10`,
    { service: true },
  ).catch(() => [] as CorrectionLog[]);

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <Sparkles className="size-3.5" />
            Orakel-kø — siste 30 Tier 2-resultater
          </CardTitle>
          <CardDescription>
            Se gjennom hva Tier 2 har tildelt, og overstyr hvis nødvendig.{" "}
            <strong>Bekreft</strong> logger at LLM-en hadde rett (treningsdata
            for neste prompt-revisjon).{" "}
            <strong>Marker ikke-AI</strong> tømmer{" "}
            <code className="font-mono">llm_categories</code> så raden faller
            ut av snapshot-aggregering ved neste refresh. Ingen av handlingene
            endrer <code className="font-mono">is_ai_relevant</code> (det er
            nøkkelord-drevet — endre katalogen på{" "}
            <Link
              href="/admin/keywords"
              className="underline decoration-dotted underline-offset-4"
            >
              /admin/keywords
            </Link>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen Tier 2-resultater ennå. Kjør{" "}
              <code className="font-mono">offentlig-llm-tier2</code> eller bruk
              Burst Tier 2 fra Ingest-fanen.
            </p>
          ) : (
            rows.map((r) => {
              const cats = r.llm_categories?.categories ?? [];
              const slugs = cats.map((c) => c.slug);
              const isOverridden = r.llm_categories?.operator_override === true;
              return (
                <div
                  key={r.sak_id}
                  className={cn(
                    "flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm",
                    isOverridden ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : "",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/offentlig/notices/storting/${r.sak_id}`}
                      className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
                    >
                      {r.korttittel || r.tittel}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.komite_navn ?? "—"} · {r.sesjon_id ?? "—"} ·{" "}
                      Tier 2: {fmtDateTime(r.tier2_completed_at)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {cats.length === 0 ? (
                        <Badge variant="outline" className="opacity-60">
                          ingen kategori
                        </Badge>
                      ) : (
                        cats.map((c, i) => (
                          <Badge key={i} variant="outline" className="font-mono">
                            {c.slug}
                            <span className="ml-1 text-[0.6rem] text-muted-foreground">
                              {(c.confidence * 100).toFixed(0)}%
                            </span>
                          </Badge>
                        ))
                      )}
                      {isOverridden ? (
                        <Badge variant="outline" className="border-amber-300 font-mono">
                          operator overstyrt
                        </Badge>
                      ) : null}
                    </div>
                    {r.llm_categories?.rationale ? (
                      <p className="mt-1 border-l-2 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
                        {r.llm_categories.rationale}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <form action={oracleAcceptAction}>
                      <input type="hidden" name="sak_id" value={r.sak_id} />
                      <input
                        type="hidden"
                        name="proposed_slug"
                        value={slugs[0] ?? ""}
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Bekreft
                      </Button>
                    </form>
                    <form
                      action={oracleMarkNotAiAction}
                      className="flex flex-col items-end gap-1"
                    >
                      <input type="hidden" name="sak_id" value={r.sak_id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        className="text-amber-700 hover:text-amber-700 dark:text-amber-300"
                      >
                        Marker ikke-AI
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {recent.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Nylige overstyringer
            </CardTitle>
            <CardDescription>
              Audit-log for{" "}
              <code className="font-mono">tier2_corrections</code>. Brukes som
              few-shot-eksempler i neste prompt-revisjon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {recent.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-muted/40 pb-1.5 last:border-b-0"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-[0.65rem]",
                    c.action === "mark_not_ai"
                      ? "border-amber-300 text-amber-700 dark:text-amber-300"
                      : "",
                  )}
                >
                  {c.action}
                </Badge>
                <Link
                  href={`/admin/offentlig/notices/storting/${c.source_id}`}
                  className="font-mono text-xs underline decoration-dotted underline-offset-4"
                >
                  sak {c.source_id}
                </Link>
                {c.accepted_slug ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    → {c.accepted_slug}
                  </span>
                ) : null}
                {c.notes ? (
                  <span className="text-xs italic text-muted-foreground">
                    “{c.notes}”
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtDateTime(c.corrected_at)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
