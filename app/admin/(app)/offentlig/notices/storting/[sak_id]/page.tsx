import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";

export const dynamic = "force-dynamic";

type SakRow = {
  sak_id: number;
  tittel: string;
  korttittel: string | null;
  henvisning: string | null;
  type_kode: number | null;
  status_kode: number | null;
  dokumentgruppe_kode: number | null;
  sesjon_id: string | null;
  behandlet_sesjon_id: string | null;
  komite_id: number | null;
  komite_navn: string | null;
  sist_oppdatert_dato: string | null;
  forslagstiller_liste: unknown;
  emne_liste: unknown;
  saksordfoerer_liste: unknown;
  has_ai_in_title: boolean;
  has_ai_in_emner: boolean;
  is_ai_relevant: boolean;
  matched_keywords_title: string[] | null;
  matched_keywords_emner: string[] | null;
  llm_ai_phrases: { phrases?: { text: string }[]; phrases_returned?: number } | null;
  tier1_completed_at: string | null;
  llm_retry_count: number;
  llm_categories: {
    categories?: { slug: string; confidence: number }[];
    rationale?: string;
    invalid_slugs_dropped?: number;
  } | null;
  tier2_completed_at: string | null;
  llm_taxonomy_version: string | null;
  llm_model_version: string | null;
  ingest_mode: string | null;
  ingested_at: string | null;
  retagged_at: string | null;
};

type VedtakRow = {
  vedtak_id: number;
  nummer: number | null;
  dato_tid: string | null;
  tittel: string | null;
  type_id: string | null;
  type_navn: string | null;
  has_ai_in_text: boolean;
  is_ai_relevant: boolean;
  vedtak_lenke_url: string | null;
};

type Emne = { id?: number; navn?: string; er_hovedemne?: boolean };
type Forslagstiller = {
  fornavn?: string;
  etternavn?: string;
  parti?: { navn?: string };
};

type Props = {
  params: Promise<{ sak_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StortingSakDetailPage({ params, searchParams }: Props) {
  const { sak_id } = await params;
  const sp = await searchParams;

  const sakIdNum = parseInt(sak_id, 10);
  if (!Number.isFinite(sakIdNum)) {
    return (
      <>
        <Flash searchParams={sp} />
        <NotFound />
      </>
    );
  }

  const [rows, vedtak] = await Promise.all([
    sbFetch<SakRow[]>(
      `/storting_saker?sak_id=eq.${sakIdNum}` +
        `&select=sak_id,tittel,korttittel,henvisning,type_kode,status_kode,dokumentgruppe_kode,sesjon_id,behandlet_sesjon_id,komite_id,komite_navn,sist_oppdatert_dato,forslagstiller_liste,emne_liste,saksordfoerer_liste,has_ai_in_title,has_ai_in_emner,is_ai_relevant,matched_keywords_title,matched_keywords_emner,llm_ai_phrases,tier1_completed_at,llm_retry_count,llm_categories,tier2_completed_at,llm_taxonomy_version,llm_model_version,ingest_mode,ingested_at,retagged_at`,
      { service: true },
    ).catch(() => [] as SakRow[]),
    sbFetch<VedtakRow[]>(
      `/storting_vedtak?sak_id=eq.${sakIdNum}` +
        `&select=vedtak_id,nummer,dato_tid,tittel,type_id,type_navn,has_ai_in_text,is_ai_relevant,vedtak_lenke_url` +
        `&order=nummer.asc.nullslast`,
      { service: true },
    ).catch(() => [] as VedtakRow[]),
  ]);

  const sak = rows[0];
  if (!sak) {
    return (
      <>
        <Flash searchParams={sp} />
        <NotFound />
      </>
    );
  }

  const emner = Array.isArray(sak.emne_liste) ? (sak.emne_liste as Emne[]) : [];
  const forslagstillere = Array.isArray(sak.forslagstiller_liste)
    ? (sak.forslagstiller_liste as Forslagstiller[])
    : [];

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow={`Stortinget · sak ${sak.sak_id}`}
        title={sak.korttittel || sak.tittel}
        description={
          <>
            {sak.henvisning ? <span>{sak.henvisning} · </span> : null}
            <span>
              Sesjon {sak.sesjon_id ?? "—"}
              {sak.komite_navn ? ` · ${sak.komite_navn}` : ""}
            </span>
          </>
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/offentlig/notices?tab=storting">
              <ArrowLeft className="size-3.5" />
              Tilbake
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Sak-metadata
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <KV label="Tittel">{sak.tittel}</KV>
            {sak.korttittel ? <KV label="Korttittel">{sak.korttittel}</KV> : null}
            <KV label="Henvisning">{sak.henvisning ?? "—"}</KV>
            <KV label="Type-kode">{numLabel(sak.type_kode)}</KV>
            <KV label="Status-kode">{numLabel(sak.status_kode)}</KV>
            <KV label="Dokumentgruppe">{numLabel(sak.dokumentgruppe_kode)}</KV>
            <KV label="Sesjon">{sak.sesjon_id ?? "—"}</KV>
            <KV label="Behandlet sesjon">{sak.behandlet_sesjon_id ?? "—"}</KV>
            <KV label="Komité">
              {sak.komite_navn ?? "—"}
              {sak.komite_id ? (
                <span className="ml-1 font-mono text-[0.7rem] text-muted-foreground">
                  #{sak.komite_id}
                </span>
              ) : null}
            </KV>
            <KV label="Sist oppdatert">
              {sak.sist_oppdatert_dato
                ? fmtDateTime(sak.sist_oppdatert_dato)
                : "—"}
            </KV>
            <KV label="Ingestert">
              {sak.ingested_at ? fmtDateTime(sak.ingested_at) : "—"}
            </KV>
            <KV label="Re-tagget">
              {sak.retagged_at ? fmtDateTime(sak.retagged_at) : "—"}
            </KV>
            <KV label="Ingest-modus">
              <Badge variant="outline" className="font-mono">
                {sak.ingest_mode ?? "—"}
              </Badge>
            </KV>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              AI-flagging
            </CardTitle>
            <CardDescription>
              Boolean-flagg er nøkkelord-drevne ved ingest. LLM-feltene er
              etterproduktet av Tier 1 og Tier 2.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <KV label="is_ai_relevant">
              <Badge variant={sak.is_ai_relevant ? "default" : "outline"}>
                {sak.is_ai_relevant ? "ja" : "nei"}
              </Badge>
            </KV>
            <KV label="has_ai_in_title">
              <Badge variant={sak.has_ai_in_title ? "default" : "outline"}>
                {sak.has_ai_in_title ? "ja" : "nei"}
              </Badge>
            </KV>
            <KV label="has_ai_in_emner">
              <Badge variant={sak.has_ai_in_emner ? "default" : "outline"}>
                {sak.has_ai_in_emner ? "ja" : "nei"}
              </Badge>
            </KV>
            <KV label="Matchede nøkkelord (tittel)">
              {renderKeywords(sak.matched_keywords_title)}
            </KV>
            <KV label="Matchede nøkkelord (emner)">
              {renderKeywords(sak.matched_keywords_emner)}
            </KV>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Emner
          </CardTitle>
        </CardHeader>
        <CardContent>
          {emner.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen emner.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {emner.map((e, i) => (
                <Badge key={`${e?.id ?? i}-${e?.navn ?? ""}`} variant="outline">
                  {e?.navn ?? "?"}
                  {e?.er_hovedemne ? (
                    <span className="ml-1 text-[0.6rem] text-muted-foreground">
                      ★
                    </span>
                  ) : null}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {forslagstillere.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Forslagstillere
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {forslagstillere.map((p, i) => (
                <Badge key={i} variant="outline">
                  {[p?.fornavn, p?.etternavn].filter(Boolean).join(" ")}
                  {p?.parti?.navn ? (
                    <span className="ml-1 text-[0.6rem] text-muted-foreground">
                      {p.parti.navn}
                    </span>
                  ) : null}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Tier 1 — AI-fraser
            </CardTitle>
            <CardDescription>
              {sak.tier1_completed_at
                ? `Kjørt ${fmtDateTime(sak.tier1_completed_at)} · ${sak.llm_ai_phrases?.phrases_returned ?? "?"} returnert, ${sak.llm_ai_phrases?.phrases?.length ?? 0} validert`
                : sak.ingest_mode === "backfill"
                  ? "Hoppes over: Tier 1 er forward-only på live ingest."
                  : "Ikke kjørt ennå."}
              {sak.llm_retry_count > 0 ? (
                <span className="ml-1 text-amber-600">
                  · {sak.llm_retry_count} forsøk feilet
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sak.llm_ai_phrases?.phrases?.length ? (
              <div className="flex flex-wrap gap-1">
                {sak.llm_ai_phrases.phrases.map((p, i) => (
                  <Badge key={i} variant="outline" className="font-mono">
                    {p.text}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ingen fraser.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Tier 2 — Kategorier
            </CardTitle>
            <CardDescription>
              {sak.tier2_completed_at
                ? `Kjørt ${fmtDateTime(sak.tier2_completed_at)} · taxonomy ${sak.llm_taxonomy_version ?? "?"} · model ${sak.llm_model_version ?? "?"}`
                : "Ikke kjørt ennå."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sak.llm_categories?.categories?.length ? (
              <div className="flex flex-wrap gap-1">
                {sak.llm_categories.categories.map((c, i) => (
                  <Badge key={i} variant="outline" className="font-mono">
                    {c.slug}
                    <span className="ml-1 text-[0.6rem] text-muted-foreground">
                      {(c.confidence * 100).toFixed(0)}%
                    </span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ingen kategorier tildelt.
              </p>
            )}
            {sak.llm_categories?.rationale ? (
              <p className="border-l-2 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
                {sak.llm_categories.rationale}
              </p>
            ) : null}
            {sak.llm_categories?.invalid_slugs_dropped ? (
              <p className="text-xs text-amber-600">
                {sak.llm_categories.invalid_slugs_dropped} ugyldige slugs droppet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {vedtak.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Vedtak ({vedtak.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {vedtak.map((v) => (
              <div
                key={v.vedtak_id}
                className="flex items-start gap-3 rounded-md border p-3 text-sm"
              >
                <Badge variant="outline" className="font-mono">
                  #{v.nummer ?? "?"}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {v.tittel ?? `Vedtak ${v.vedtak_id}`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {v.dato_tid ? fmtDateTime(v.dato_tid) : "—"}
                    {v.type_navn ? ` · ${v.type_navn}` : ""}
                    {v.type_id ? (
                      <span className="ml-1 font-mono">[{v.type_id}]</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 text-[0.65rem]">
                  {v.is_ai_relevant ? (
                    <Badge variant="outline" className="font-mono">
                      AI
                    </Badge>
                  ) : null}
                  {v.vedtak_lenke_url ? (
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={v.vedtak_lenke_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Åpne
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function KV({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-muted/50 pb-1.5">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

function NotFound() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Sak ikke funnet</CardTitle>
        <CardDescription>
          ID-en finnes ikke i <code className="font-mono">storting_saker</code>.
          Sjekk om den er fra en ennå ikke ingestert sesjon.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/offentlig/notices?tab=storting">
            <ArrowLeft className="size-3.5" />
            Tilbake til oversikten
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function renderKeywords(arr: string[] | null): React.ReactNode {
  if (!arr || arr.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {arr.map((k) => (
        <Badge key={k} variant="outline" className="font-mono text-[0.65rem]">
          {k}
        </Badge>
      ))}
    </span>
  );
}

function numLabel(n: number | null): string {
  return n == null ? "—" : String(n);
}
