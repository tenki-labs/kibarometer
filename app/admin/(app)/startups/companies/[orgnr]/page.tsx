import Link from "next/link";
import { notFound } from "next/navigation";

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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";

import { forgetCompanyAction } from "./actions";

export const dynamic = "force-dynamic";

type CompanyDetail = {
  orgnr: string;
  navn: string;
  organisasjonsform: string | null;
  registrert_dato: string | null;
  stiftelsesdato: string | null;
  slettet_dato: string | null;
  naeringskode_1: string | null;
  naeringskode_2: string | null;
  naeringskode_3: string | null;
  naeringskode_taxonomy_version: string | null;
  nace_category_slug: string | null;
  kommunenummer: string | null;
  postnummer: string | null;
  poststed: string | null;
  fylke: string | null;
  antall_ansatte: number | null;
  aksjekapital: number | null;
  aktivitet: string | null;
  konkurs: boolean;
  under_avvikling: boolean;
  has_ai_in_name: boolean;
  has_ai_in_aktivitet: boolean;
  is_ai_relevant: boolean;
  matched_keywords_name: string[] | null;
  matched_keywords_aktivitet: string[] | null;
  roles_fetched_at: string | null;
  youngest_role_age_at_reg: number | null;
  role_count: number | null;
  ingested_at: string;
  last_seen_at: string;
};

type RoleRow = {
  role_code: string;
  person_navn: string;
  fodselsdato: string;
  valid_from: string | null;
};

type Props = {
  params: Promise<{ orgnr: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function ageAt(dob: string, asOf: string | null): number | null {
  if (!asOf) return null;
  const d = new Date(dob);
  const a = new Date(asOf);
  if (Number.isNaN(d.getTime()) || Number.isNaN(a.getTime())) return null;
  let age = a.getUTCFullYear() - d.getUTCFullYear();
  const m = a.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && a.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

export default async function CompanyDetailPage({ params, searchParams }: Props) {
  const { orgnr } = await params;
  const sp = await searchParams;

  const [companyRows, rolesRows] = await Promise.all([
    sbFetch<CompanyDetail[]>(
      `/brreg_companies?orgnr=eq.${encodeURIComponent(orgnr)}&select=*`,
      { service: true },
    ).catch(() => [] as CompanyDetail[]),
    sbFetch<RoleRow[]>(
      `/brreg_roles?orgnr=eq.${encodeURIComponent(orgnr)}&select=role_code,person_navn,fodselsdato,valid_from&order=role_code.asc,person_navn.asc`,
      { service: true },
    ).catch(() => [] as RoleRow[]),
  ]);

  const c = companyRows[0];
  if (!c) notFound();

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Foretak"
        title={c.navn}
        description={
          <>
            <span className="font-mono">{c.orgnr}</span>
            <span aria-hidden> · </span>
            <span>{c.organisasjonsform || "—"}</span>
            {c.is_ai_relevant && (
              <>
                <span aria-hidden> · </span>
                <Badge variant="secondary">AI-relevant</Badge>
              </>
            )}
            {c.konkurs && (
              <>
                <span aria-hidden> · </span>
                <Badge variant="destructive">Konkurs</Badge>
              </>
            )}
          </>
        }
        action={
          <a
            href={`https://w2.brreg.no/enhet/sok/detalj.jsp?orgnr=${encodeURIComponent(c.orgnr)}`}
            target="_blank"
            rel="noopener"
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Se i brreg ↗
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identitet og næring</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Registrert</dt>
              <dd className="tabular-nums">{c.registrert_dato || "—"}</dd>
              <dt className="text-muted-foreground">Stiftet</dt>
              <dd className="tabular-nums">{c.stiftelsesdato || "—"}</dd>
              {c.slettet_dato && (
                <>
                  <dt className="text-muted-foreground">Slettet</dt>
                  <dd className="tabular-nums">{c.slettet_dato}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Næringskode 1</dt>
              <dd className="tabular-nums">{c.naeringskode_1 || "—"}</dd>
              {c.naeringskode_2 && (
                <>
                  <dt className="text-muted-foreground">Næringskode 2</dt>
                  <dd className="tabular-nums">{c.naeringskode_2}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Taksonomi</dt>
              <dd className="tabular-nums">{c.naeringskode_taxonomy_version || "—"}</dd>
              <dt className="text-muted-foreground">Kategori</dt>
              <dd>{c.nace_category_slug || "—"}</dd>
              <dt className="text-muted-foreground">Fylke</dt>
              <dd>{c.fylke || "—"}</dd>
              <dt className="text-muted-foreground">Kommune</dt>
              <dd>
                {c.poststed || "—"}{" "}
                <span className="text-muted-foreground tabular-nums">
                  ({c.kommunenummer || "—"})
                </span>
              </dd>
              <dt className="text-muted-foreground">Postnummer</dt>
              <dd className="tabular-nums">{c.postnummer || "—"}</dd>
              <dt className="text-muted-foreground">Antall ansatte</dt>
              <dd className="tabular-nums">{c.antall_ansatte ?? "— (0–4 brukker)"}</dd>
              <dt className="text-muted-foreground">Aksjekapital (NOK)</dt>
              <dd className="tabular-nums">
                {c.aksjekapital !== null ? c.aksjekapital.toLocaleString("nb-NO") : "—"}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI-tagging</CardTitle>
            <CardDescription>
              Resultat fra delte nøkkelord-matchere kjørt mot navn og aktivitet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">I navn</dt>
              <dd>{c.has_ai_in_name ? "Ja" : "Nei"}</dd>
              <dt className="text-muted-foreground">Treff i navn</dt>
              <dd className="text-xs">
                {c.matched_keywords_name?.join(", ") || "—"}
              </dd>
              <dt className="text-muted-foreground">I aktivitet</dt>
              <dd>{c.has_ai_in_aktivitet ? "Ja" : "Nei"}</dd>
              <dt className="text-muted-foreground">Treff i aktivitet</dt>
              <dd className="text-xs">
                {c.matched_keywords_aktivitet?.join(", ") || "—"}
              </dd>
            </dl>
            {c.aktivitet && (
              <div className="mt-4">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
                  Aktivitet / formål
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs">{c.aktivitet}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Roller (kun fysiske personer)</CardTitle>
          <CardDescription>
            {c.roles_fetched_at ? (
              <>
                Hentet {new Date(c.roles_fetched_at).toLocaleString("nb-NO")}.
                {c.youngest_role_age_at_reg !== null
                  ? ` Yngste rolle ved registrering: ${c.youngest_role_age_at_reg} år.`
                  : " Ingen kvalifiserende roller for grunderalder-beregning."}
              </>
            ) : (
              "Roller er ikke hentet ennå (kategori har ikke enrich_roles=true, eller venter i kø)."
            )}{" "}
            <strong>Disse personopplysningene vises kun i admin.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rolle</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead className="tabular-nums">Født</TableHead>
                <TableHead className="text-right tabular-nums">Alder ved reg.</TableHead>
                <TableHead className="tabular-nums">Gyldig fra</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolesRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Ingen lagrede roller (verken ikke hentet, eller utelukkende juridiske personer som vi ikke lagrer).
                  </TableCell>
                </TableRow>
              ) : (
                rolesRows.map((r) => {
                  const age = ageAt(r.fodselsdato, c.registrert_dato);
                  return (
                    <TableRow key={`${r.role_code}-${r.person_navn}-${r.fodselsdato}`}>
                      <TableCell className="font-mono text-xs">{r.role_code}</TableCell>
                      <TableCell className="text-sm">{r.person_navn}</TableCell>
                      <TableCell className="tabular-nums text-xs">{r.fodselsdato}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{age ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {r.valid_from || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6 border-rose-200 dark:border-rose-900">
        <CardHeader>
          <CardTitle className="text-base">Hard-slett foretak (GDPR)</CardTitle>
          <CardDescription>
            Permanent sletting av foretaket og dets roller. Aggregat-statistikker
            i snapshot-tabellene blir liggende, men individuelle person-data
            forsvinner. Rad i <code className="text-xs">jobs</code> registrerer
            handlingen for revisjon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={forgetCompanyAction}>
            <input type="hidden" name="orgnr" value={c.orgnr} />
            <SubmitButton size="sm" variant="destructive" pendingLabel="Sletter…">
              Slett {c.orgnr} permanent
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/admin/startups/companies" className="underline underline-offset-2">
          ← Tilbake til foretakliste
        </Link>
      </p>
    </>
  );
}
