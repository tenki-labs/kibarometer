// /admin/keywords/candidates — review queue for Tier 1-discovered phrases.
// Three sections per the LLM-pipeline plan:
//   1. Ventende  — pending candidates surfaced by refresh_keyword_candidates()
//      (>= 3 distinct postings in the last 90 days). Each row expands to show
//      5 verbatim receipts (~50 chars of context with the phrase highlighted)
//      and a promotion form: trial / canonical / merge / reject.
//   2. På prøve  — keywords currently in status='trial'. Match in tagging but
//      excluded from public is_ai stats. Default-graduation hint when
//      >= 14 days old AND >= 10 matches. Actions: graduate / demote.
//   3. Avviste / sammenslåtte — collapsed audit log of operator decisions.
//
// Promotion is a pure SQL update (no LLM call) — Tier 1 already validated the
// phrase verbatim; we just append it to nav_postings.matched_keywords for
// every posting that already has the phrase in llm_ai_phrases. See
// supabase/migrations/0019_promote_keyword_candidate.sql.

import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Sparkles,
  TimerReset,
  TrendingDown,
  XCircle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { getStaffClaims } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

import {
  actAction,
  demoteAction,
  graduateAction,
} from "./actions";

export const dynamic = "force-dynamic";

const TRIAL_DAYS_THRESHOLD = 14;
const TRIAL_MATCHES_THRESHOLD = 10;
const RECEIPTS_PER_CANDIDATE = 5;
const RECEIPT_CONTEXT_CHARS = 25;

type CandidateStatus = "pending" | "trial" | "canonical" | "rejected" | "merged";

type SourceTag = "jobs" | "media" | "brreg";

type Sample = {
  source: SourceTag;
  id: string;
  title: string | null;
  link: string | null;
  text: string | null;
};

type Candidate = {
  term_norm: string;
  evidence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  sources: SourceTag[];
  samples: Sample[];
  status: CandidateStatus;
  merged_into_term: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

const SOURCE_LABEL: Record<SourceTag, string> = {
  jobs: "Stillinger",
  media: "Medie",
  brreg: "Oppstart",
};

type CanonicalKeyword = {
  id: string;
  term: string;
  language: string;
  category: string;
};

type TrialKeyword = {
  id: string;
  term: string;
  term_norm: string;
  language: string;
  category: string;
  created_at: string;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CandidatesPage({ searchParams }: Props) {
  const params = await searchParams;
  const claims = await getStaffClaims();
  const reviewer = claims?.email ?? "admin";

  const [pending, audit, canonicals, trials] = await Promise.all([
    sbFetch<Candidate[]>(
      `/keyword_candidates?status=eq.pending` +
        `&select=*&order=evidence_count.desc,last_seen_at.desc&limit=100`,
      { service: true },
    ),
    sbFetch<Candidate[]>(
      `/keyword_candidates?status=in.(rejected,merged)` +
        `&select=*&order=reviewed_at.desc.nullslast&limit=50`,
      { service: true },
    ),
    sbFetch<CanonicalKeyword[]>(
      `/keywords?status=eq.canonical` +
        `&select=id,term,language,category&order=term_norm.asc`,
      { service: true },
    ),
    sbFetch<TrialKeyword[]>(
      `/keywords?status=eq.trial` +
        `&select=id,term,term_norm,language,category,created_at` +
        `&order=created_at.asc`,
      { service: true },
    ),
  ]);

  const trialMatchCounts = await Promise.all(
    trials.map((t) => countMatches(t.term)),
  );

  const auditByStatus = {
    rejected: audit.filter((a) => a.status === "rejected"),
    merged: audit.filter((a) => a.status === "merged"),
  };

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Kandidater"
        description={
          <>
            <span>
              AI-relaterte uttrykk hentet ut av Tier 1 og funnet i ≥ 3 stillinger
              de siste 90 dagene. Promoter til nøkkelordkatalogen eller avvis.
            </span>
          </>
        }
      />
      <AutoRefresh enabled intervalMs={30000} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Til vurdering"
          value={pending.length}
          hint="phraser i køen"
        />
        <StatCard
          label="På prøve"
          value={trials.length}
          hint="midlertidig aktive nøkkelord"
        />
        <StatCard
          label="Klar for graduering"
          value={trials.filter((t, i) =>
            isReadyForGraduation(t, trialMatchCounts[i] ?? 0),
          ).length}
          hint={`≥ ${TRIAL_DAYS_THRESHOLD} dager · ≥ ${TRIAL_MATCHES_THRESHOLD} treff`}
        />
        <StatCard
          label="I logg"
          value={audit.length}
          hint="avviste / sammenslåtte"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Sparkles className="size-4" />
            Ventende kandidater
          </CardTitle>
          <CardDescription>
            Sortert etter antall stillinger phrasen forekommer i. Klikk en rad
            for å se 5 utdrag og handlingsalternativer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen ventende kandidater. Tier 1-phraser dukker opp her når et
              uttrykk er sett i ≥ 3 stillinger de siste 90 dagene.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {pending.map((cand) => (
                <PendingRow
                  key={cand.term_norm}
                  candidate={cand}
                  canonicals={canonicals}
                  reviewer={reviewer}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <TimerReset className="size-4" />
            På prøve
          </CardTitle>
          <CardDescription>
            Nøkkelord som matcher i tagging, men som er ekskludert fra
            offentlig is_ai-statistikk inntil de gradueres.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {trials.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Ingen nøkkelord på prøve.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Term</TableHead>
                    <TableHead>Språk</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead className="text-right">Dager</TableHead>
                    <TableHead className="text-right">Treff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Handlinger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trials.map((t, i) => (
                    <TrialRow
                      key={t.id}
                      keyword={t}
                      matches={trialMatchCounts[i] ?? 0}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <XCircle className="size-4" />
            Avviste og sammenslåtte
          </CardTitle>
          <CardDescription>
            Revisjonslogg. Avgjørelser tatt av operatøren — phrasene
            re-overflateres ikke ved neste refresh.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen avgjørelser ennå.</p>
          ) : (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Vis {audit.length} oppføring{audit.length === 1 ? "" : "er"}
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
                <AuditTable
                  rows={auditByStatus.rejected}
                  emptyLabel="Ingen avviste."
                  title="Avviste"
                />
                <AuditTable
                  rows={auditByStatus.merged}
                  emptyLabel="Ingen sammenslåtte."
                  title="Sammenslåtte"
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PendingRow({
  candidate,
  canonicals,
  reviewer,
}: {
  candidate: Candidate;
  canonicals: CanonicalKeyword[];
  reviewer: string;
}) {
  const samples = (candidate.samples ?? []).slice(0, RECEIPTS_PER_CANDIDATE);
  const sources = candidate.sources ?? [];
  const evidenceLabel = inferEvidenceLabel(sources);

  return (
    <details className="rounded-md border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40">
        <span className="font-mono text-sm">{candidate.term_norm}</span>
        <Badge variant="secondary">
          {candidate.evidence_count} {evidenceLabel}
        </Badge>
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[0.65rem]">
              {SOURCE_LABEL[s] ?? s}
            </Badge>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          Sist sett {fmtDateTime(candidate.last_seen_at)}
        </span>
      </summary>

      <div className="border-t border-border px-4 py-4">
        <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
          Utdrag ({samples.length}/{RECEIPTS_PER_CANDIDATE})
        </p>
        {samples.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Kildene som ga grunnlaget er ikke lenger tilgjengelige.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {samples.map((p) => {
              const receipt = makeReceipt(p.text, candidate.term_norm);
              const titleText = p.title ?? p.id;
              return (
                <li
                  key={`${p.source}:${p.id}`}
                  className="rounded-md border border-border/60 bg-muted/20 p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-[0.6rem]">
                      {SOURCE_LABEL[p.source] ?? p.source}
                    </Badge>
                    {p.link ? (
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        {titleText}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{titleText}</span>
                    )}
                  </div>
                  {receipt ? (
                    <p className="font-mono text-xs leading-relaxed">
                      <span className="text-muted-foreground">
                        {receipt.before}
                      </span>
                      <mark className="bg-amber-200 px-0.5 dark:bg-amber-900/60 dark:text-amber-100">
                        {receipt.match}
                      </mark>
                      <span className="text-muted-foreground">
                        {receipt.after}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      Phrasen ble ikke funnet i utdraget (sannsynligvis
                      redigert etter Tier 1 kjørte).
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <PromoteForm
          candidate={candidate}
          canonicals={canonicals}
          reviewer={reviewer}
        />
      </div>
    </details>
  );
}

function PromoteForm({
  candidate,
  canonicals,
  reviewer,
}: {
  candidate: Candidate;
  canonicals: CanonicalKeyword[];
  reviewer: string;
}) {
  const action = actAction.bind(null, candidate.term_norm);
  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="reviewed_by" value={reviewer} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`term-${candidate.term_norm}`}>Term</Label>
          <Input
            id={`term-${candidate.term_norm}`}
            name="term"
            defaultValue={candidate.term_norm}
            placeholder={candidate.term_norm}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`language-${candidate.term_norm}`}>Språk</Label>
          <Select name="language" defaultValue="any">
            <SelectTrigger id={`language-${candidate.term_norm}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">alle</SelectItem>
              <SelectItem value="no">norsk</SelectItem>
              <SelectItem value="en">engelsk</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`category-${candidate.term_norm}`}>Kategori</Label>
          <Select name="category" defaultValue="concept">
            <SelectTrigger id={`category-${candidate.term_norm}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tool">Verktøy</SelectItem>
              <SelectItem value="role">Rolle / tittel</SelectItem>
              <SelectItem value="concept">Begrep</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`match_type-${candidate.term_norm}`}>Match</Label>
          <Select name="match_type" defaultValue="substring">
            <SelectTrigger id={`match_type-${candidate.term_norm}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="word">ord</SelectItem>
              <SelectItem value="substring">delstreng</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`merge-${candidate.term_norm}`}>
          Slå sammen med (kun ved «Slå sammen»)
        </Label>
        <Select name="merge_target_id" defaultValue="">
          <SelectTrigger id={`merge-${candidate.term_norm}`}>
            <SelectValue placeholder="Velg eksisterende kanonisk nøkkelord" />
          </SelectTrigger>
          <SelectContent>
            {canonicals.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.term}{" "}
                <span className="text-muted-foreground">
                  · {k.language} · {k.category}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="intent"
          value="trial"
          variant="outline"
          pendingLabel="Lagrer…"
        >
          <TimerReset />
          Godkjenn (trial)
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="canonical"
          pendingLabel="Lagrer…"
        >
          <CheckCircle2 />
          Godkjenn (kanonisk)
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="merge"
          variant="outline"
          pendingLabel="Slår sammen…"
        >
          <ArrowRight />
          Slå sammen
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="reject"
          variant="ghost"
          pendingLabel="Avviser…"
        >
          <XCircle />
          Avvis
        </SubmitButton>
      </div>
    </form>
  );
}

function TrialRow({
  keyword,
  matches,
}: {
  keyword: TrialKeyword;
  matches: number;
}) {
  const days = daysSince(keyword.created_at);
  const ready = isReadyForGraduation(keyword, matches);
  const graduate = graduateAction.bind(null, keyword.id);
  const demote = demoteAction.bind(null, keyword.id);
  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{keyword.term}</TableCell>
      <TableCell>{keyword.language}</TableCell>
      <TableCell>{keyword.category}</TableCell>
      <TableCell className="text-right tabular-nums">{days}</TableCell>
      <TableCell className="text-right tabular-nums">{matches}</TableCell>
      <TableCell>
        {ready ? (
          <Badge className="bg-emerald-500 text-emerald-50 hover:bg-emerald-500/90">
            Klar for graduering
          </Badge>
        ) : (
          <Badge variant="secondary">På prøve</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <form action={graduate}>
            <SubmitButton size="sm" pendingLabel="Lagrer…">
              <GraduationCap />
              Graduer
            </SubmitButton>
          </form>
          <form action={demote}>
            <SubmitButton size="sm" variant="ghost" pendingLabel="Lagrer…">
              <TrendingDown />
              Demoter
            </SubmitButton>
          </form>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AuditTable({
  rows,
  emptyLabel,
  title,
}: {
  rows: Candidate[];
  emptyLabel: string;
  title: string;
}) {
  return (
    <div className="rounded-md border">
      <p className="border-b border-border bg-muted/30 px-3 py-2 font-mono text-[0.65rem] uppercase tracking-[0.14em]">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Term</TableHead>
              <TableHead>{title === "Sammenslåtte" ? "→ målterm" : "Behandlet"}</TableHead>
              <TableHead className="text-right">Stillinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.term_norm}>
                <TableCell className="font-mono text-xs">
                  {r.term_norm}
                </TableCell>
                <TableCell className="text-xs">
                  {r.status === "merged" ? (
                    <span className="font-mono">
                      {r.merged_into_term ?? "—"}
                    </span>
                  ) : (
                    fmtDateTime(r.reviewed_at)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {r.evidence_count}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function makeReceipt(
  description: string | null,
  phrase: string,
): { before: string; match: string; after: string } | null {
  if (!description) return null;
  const idx = description.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - RECEIPT_CONTEXT_CHARS);
  const end = Math.min(
    description.length,
    idx + phrase.length + RECEIPT_CONTEXT_CHARS,
  );
  // Preserve original casing — phrase length is a lower-case index but the
  // surrounding text we slice out of the original description.
  const before = (start > 0 ? "…" : "") + description.slice(start, idx);
  const match = description.slice(idx, idx + phrase.length);
  const after =
    description.slice(idx + phrase.length, end) +
    (end < description.length ? "…" : "");
  return { before, match, after };
}

// Pluralise the evidence-count chip ("12 stillinger" / "12 artikler" / "12
// selskaper" / "12 kilder") based on which pipelines surfaced the phrase.
// Mixed sources fall back to a generic word so the chip stays accurate
// without spelling out every combination.
function inferEvidenceLabel(sources: SourceTag[]): string {
  if (sources.length === 1) {
    if (sources[0] === "jobs") return "stillinger";
    if (sources[0] === "media") return "artikler";
    if (sources[0] === "brreg") return "selskaper";
  }
  return "kilder";
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function isReadyForGraduation(t: TrialKeyword, matches: number): boolean {
  return (
    daysSince(t.created_at) >= TRIAL_DAYS_THRESHOLD &&
    matches >= TRIAL_MATCHES_THRESHOLD
  );
}

async function countMatches(term: string): Promise<number> {
  // PostgREST `cs` (contains) on the matched_keywords text[] column. The
  // value is a Postgres-array literal, so quote the term to handle spaces.
  const filter = `cs.${encodeURIComponent(`{"${term.replace(/"/g, "\\\"")}"}`)}`;
  const rows = await sbFetch<{ id: string }[]>(
    `/nav_postings?matched_keywords=${filter}&select=id&limit=1000`,
    { service: true },
  );
  return rows.length;
}
