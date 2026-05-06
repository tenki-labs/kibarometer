import Link from "next/link";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

type CompanyRow = {
  orgnr: string;
  navn: string;
  organisasjonsform: string | null;
  registrert_dato: string | null;
  nace_category_slug: string | null;
  fylke: string | null;
  is_ai_relevant: boolean;
  has_ai_in_name: boolean;
  has_ai_in_aktivitet: boolean;
  youngest_role_age_at_reg: number | null;
  role_count: number | null;
  aksjekapital: number | null;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 50;

function strParam(
  v: string | string[] | undefined,
): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

export default async function CompaniesPage({ searchParams }: Props) {
  const params = await searchParams;
  const category = strParam(params.category);
  const fylke = strParam(params.fylke);
  const ai = strParam(params.ai);
  const fromDate = strParam(params.from);
  const toDate = strParam(params.to);
  const orgform = strParam(params.orgform);
  const page = Math.max(1, parseInt(strParam(params.page) || "1", 10) || 1);

  const filters: string[] = [];
  if (category) filters.push(`nace_category_slug=eq.${encodeURIComponent(category)}`);
  if (fylke) filters.push(`fylke=eq.${encodeURIComponent(fylke)}`);
  if (orgform) filters.push(`organisasjonsform=eq.${encodeURIComponent(orgform)}`);
  if (ai === "1") filters.push(`is_ai_relevant=is.true`);
  if (fromDate) filters.push(`registrert_dato=gte.${encodeURIComponent(fromDate)}`);
  if (toDate) filters.push(`registrert_dato=lte.${encodeURIComponent(toDate)}`);

  const offset = (page - 1) * PAGE_SIZE;
  const filterQs = filters.length ? `&${filters.join("&")}` : "";

  const rows = await sbFetch<CompanyRow[]>(
    `/brreg_companies?select=orgnr,navn,organisasjonsform,registrert_dato,nace_category_slug,fylke,is_ai_relevant,has_ai_in_name,has_ai_in_aktivitet,youngest_role_age_at_reg,role_count,aksjekapital&order=registrert_dato.desc.nullslast,ingested_at.desc&limit=${PAGE_SIZE}&offset=${offset}${filterQs}`,
    { service: true },
  ).catch(() => [] as CompanyRow[]);

  const buildHref = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const set = (k: string, v: string | null | undefined) => {
      if (v != null && v !== "") sp.set(k, v);
    };
    set("category", overrides.category ?? category);
    set("fylke", overrides.fylke ?? fylke);
    set("ai", overrides.ai ?? ai);
    set("from", overrides.from ?? fromDate);
    set("to", overrides.to ?? toDate);
    set("orgform", overrides.orgform ?? orgform);
    set("page", overrides.page ?? String(page));
    const qs = sp.toString();
    return `/admin/startups/companies${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt"
        title="Foretak"
        description="Søk og filtrer på alle ingesterte brreg-foretak. Klikk orgnr for full detalj inkludert rolle-liste."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Filtre</CardTitle>
          <CardDescription>GET-form; URL-parametere er stabile (delbare lenker).</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="GET" className="grid grid-cols-2 gap-3 md:grid-cols-7">
            <div>
              <Label htmlFor="f-category" className="text-xs">Kategori</Label>
              <Input id="f-category" name="category" defaultValue={category ?? ""} placeholder="it / kreativ-media / …" />
            </div>
            <div>
              <Label htmlFor="f-fylke" className="text-xs">Fylke</Label>
              <Input id="f-fylke" name="fylke" defaultValue={fylke ?? ""} placeholder="Oslo / Vestland / …" />
            </div>
            <div>
              <Label htmlFor="f-orgform" className="text-xs">Selskapsform</Label>
              <Input id="f-orgform" name="orgform" defaultValue={orgform ?? ""} placeholder="AS / ENK / NUF" />
            </div>
            <div>
              <Label htmlFor="f-from" className="text-xs">Fra</Label>
              <Input id="f-from" name="from" type="date" defaultValue={fromDate ?? ""} />
            </div>
            <div>
              <Label htmlFor="f-to" className="text-xs">Til</Label>
              <Input id="f-to" name="to" type="date" defaultValue={toDate ?? ""} />
            </div>
            <div>
              <Label htmlFor="f-ai" className="text-xs">Bare AI-relevante</Label>
              <select
                id="f-ai"
                name="ai"
                defaultValue={ai ?? ""}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Alle</option>
                <option value="1">Bare AI</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">Bruk filter</Button>
              <Button type="button" asChild variant="outline" size="sm">
                <Link href="/admin/startups/companies">Nullstill</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orgnr</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Reg. dato</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Fylke</TableHead>
                <TableHead className="text-right">Aksjekap.</TableHead>
                <TableHead className="text-right">Yngste</TableHead>
                <TableHead className="text-right">Roller</TableHead>
                <TableHead>AI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                    Ingen treff. Prøv et videre filter eller kjør 'Hent nå' fra oversikten.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.orgnr}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/startups/companies/${encodeURIComponent(c.orgnr)}`}
                        className="hover:underline"
                      >
                        {c.orgnr}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[24ch] truncate text-xs">{c.navn}</TableCell>
                    <TableCell className="text-xs">{c.organisasjonsform || "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">{c.registrert_dato || "—"}</TableCell>
                    <TableCell className="text-xs">{c.nace_category_slug || "—"}</TableCell>
                    <TableCell className="text-xs">{c.fylke || "—"}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {c.aksjekapital !== null ? c.aksjekapital.toLocaleString("nb-NO") : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {c.youngest_role_age_at_reg ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{c.role_count ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {c.has_ai_in_name && <Badge variant="secondary" className="mr-1">navn</Badge>}
                      {c.has_ai_in_aktivitet && <Badge variant="secondary">aktivitet</Badge>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Side {page} · {rows.length} rader (sidens størrelse {PAGE_SIZE})
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: String(page - 1) })}>← Forrige</Link>
            </Button>
          )}
          {rows.length === PAGE_SIZE && (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: String(page + 1) })}>Neste →</Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
