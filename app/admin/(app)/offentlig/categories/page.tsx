import Link from "next/link";
import { FolderTree, Power } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { cn } from "@/lib/utils";
import { sbFetch } from "@/lib/admin/sb";
import { toggleStortingActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type Tab = "storting" | "mappinger" | "doffin";

type StortingCategory = {
  slug: string;
  label_no: string;
  label_en: string | null;
  sort_order: number;
  is_active: boolean;
};

function strParam(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

function isTab(s: string | null): s is Tab {
  return s === "storting" || s === "mappinger" || s === "doffin";
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CategoriesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab = isTab(strParam(sp.tab)) ? (strParam(sp.tab) as Tab) : "storting";

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Offentlig sektor"
        title="Kategorier"
        description={
          <>
            Per-kilde taksonomier som Tier 2 tildeler slugs fra. Mappinger
            kobler doffin-slugs til storting-slugs (driver politikk-til-innkjøp
            lag-grafen) når begge halvdelene er live.
          </>
        }
        action={
          <div className="flex gap-2">
            <TabButton
              href="/admin/offentlig/categories?tab=storting"
              active={tab === "storting"}
              label="Stortinget"
            />
            <TabButton
              href="/admin/offentlig/categories?tab=mappinger"
              active={tab === "mappinger"}
              label="Mappinger"
            />
            <TabButton
              href="/admin/offentlig/categories?tab=doffin"
              active={tab === "doffin"}
              label="Doffin"
            />
          </div>
        }
      />

      {tab === "storting" ? (
        <StortingCategoriesTab />
      ) : tab === "mappinger" ? (
        <MappingerTab />
      ) : (
        <DoffinCategoriesTab />
      )}
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

async function StortingCategoriesTab() {
  const cats = await sbFetch<StortingCategory[]>(
    `/storting_categories?select=slug,label_no,label_en,sort_order,is_active` +
      `&order=is_active.desc,sort_order.asc,slug.asc`,
    { service: true },
  ).catch(() => [] as StortingCategory[]);

  const active = cats.filter((c) => c.is_active).length;

  return (
    <Card className="mt-6 gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
          <FolderTree className="size-4" />
          {active} aktive · {cats.length - active} inaktive
        </CardTitle>
        <CardDescription className="mt-1">
          Tier 2 leser <code className="font-mono">is_active=true</code> på hver
          cron-tick, så endringer slår inn uten redeploy. Slugen er
          primærnøkkel — opprettelse / endring av label krever migrasjon.
          Skipper du en slug, faller den ut av Tier 2-prompten på neste tick.
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Etikett (NO)</TableHead>
              <TableHead>Etikett (EN)</TableHead>
              <TableHead className="w-24 text-right">Aktiv</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-12 text-center text-muted-foreground"
                >
                  Ingen storting-kategorier. Migrasjon{" "}
                  <code className="font-mono text-xs">
                    0064_offentlig_storting.sql
                  </code>{" "}
                  seeder 11 slugs ved deploy.
                </TableCell>
              </TableRow>
            ) : (
              cats.map((c) => (
                <TableRow key={c.slug}>
                  <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                  <TableCell className="font-medium">{c.label_no}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.label_en ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <form
                      action={toggleStortingActiveAction.bind(null, c.slug)}
                      className="inline"
                    >
                      <input
                        type="hidden"
                        name="is_active"
                        value={String(!c.is_active)}
                      />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel={c.is_active ? "Av…" : "På…"}
                      >
                        <Power />
                        {c.is_active ? "Aktiv" : "Inaktiv"}
                      </SubmitButton>
                    </form>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function MappingerTab() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>
          <Badge variant="outline">Venter på Doffin</Badge>
        </CardTitle>
        <CardDescription>
          Mappinger kobler{" "}
          <code className="font-mono">doffin_categories</code>-slugs til{" "}
          <code className="font-mono">storting_categories</code>-slugs. De
          driver <em>policy-til-innkjøp lag</em>-grafen på{" "}
          <Link
            href="/docs/offentlig-sektor"
            className="underline decoration-dotted underline-offset-4"
          >
            /offentlig
          </Link>
          : når et Stortinget-vedtak i kategori X medianfølges av et
          Doffin-anbud i en mappet kategori Y, regner snapshot-jobben ut
          mediantiden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Mapping-tabellen lander når Doffin-halvdelen ingester. Frem til
          da har vi bare én kildetaksonomi (Stortinget) — én-til-én
          mappinger gir ingen analyseverdi.
        </p>
      </CardContent>
    </Card>
  );
}

function DoffinCategoriesTab() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>
          <Badge variant="outline">Venter på Doffin</Badge>
        </CardTitle>
        <CardDescription>
          Doffin-taksonomi kommer i en senere migrasjon når{" "}
          <code className="font-mono">doffin_notices</code>-tabellen finnes.
          Foreløpig seeding fra plan: forvaltning-ai, helse-ai, utdanning-ai,
          samferdsel-ai, forsvar-ai, infrastruktur-ai, konsulent-ai,
          data-plattform, annet.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
