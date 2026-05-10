import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { dryRunAction, updateAction } from "../../actions";
import { SourceFields, type SourceFormShape } from "../../_form";

export const dynamic = "force-dynamic";

type Source = SourceFormShape & {
  id: string;
  last_polled_at: string | null;
  backfill_cursor: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditSourcePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const rows = await sbFetch<Source[]>(
    `/media_sources?id=eq.${encodeURIComponent(id)}` +
      `&select=id,name,domain,rss_url,crawl_delay_ms,is_active,category,last_polled_at,backfill_cursor,notes,created_at,updated_at`,
    { service: true },
  ).catch(() => [] as Source[]);
  const src = rows[0];
  if (!src) notFound();

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title={src.name ?? "Kilde"}
        description={
          <>
            <span className="font-mono">{src.domain}</span>
            {src.last_polled_at ? (
              <>
                {" "}
                · Sist pollet {fmtDateTime(src.last_polled_at)}
              </>
            ) : null}
            {src.backfill_cursor ? (
              <>
                {" "}
                · backfill_cursor {src.backfill_cursor}
              </>
            ) : null}
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/media/sources">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Konfigurasjon
            </CardTitle>
            <CardDescription>
              JSON-feltene parses ved lagring; ugyldig JSON gir feilmelding og
              raden patches ikke.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateAction.bind(null, src.id)}
              className="flex flex-col gap-6"
            >
              <SourceFields initial={src} />
              <div className="flex gap-2">
                <SubmitButton pendingLabel="Lagrer…">Lagre</SubmitButton>
                <Button asChild variant="ghost">
                  <Link href="/admin/media/sources">Avbryt</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
                <FlaskConical className="size-3.5" />
                Tørrtest
              </CardTitle>
              <CardDescription>
                Validér RSS- og ekstraktor-oppsettet før du aktiverer kilden.
                Tester gjør live HTTP-kall — sjekk crawl_delay_ms først.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form
                action={dryRunAction.bind(null, src.id)}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="target" value="rss" />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Henter…"
                  disabled={!src.rss_url}
                >
                  Test RSS-feeden
                </SubmitButton>
                {!src.rss_url ? (
                  <p className="text-xs text-muted-foreground">
                    rss_url er tom — sett den først.
                  </p>
                ) : null}
              </form>

              <form
                action={dryRunAction.bind(null, src.id)}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="target" value="scrapegraph" />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Spør sidekarens…"
                >
                  Tørrtest scrapegraph-discover
                </SubmitButton>
                <p className="text-xs text-muted-foreground">
                  Henter første aktive keyword fra <code className="font-mono">/admin/keywords</code>{" "}
                  og spør kiba-scraper-sidecaren om topp 5 URL-er fra{" "}
                  <code className="font-mono">{src.domain}</code>.
                </p>
              </form>

              <form
                action={dryRunAction.bind(null, src.id)}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="target" value="extract" />
                <Label htmlFor="sample_url" className="text-xs">
                  Test ekstraksjon (legacy JSON-LD)
                </Label>
                <Input
                  id="sample_url"
                  name="sample_url"
                  placeholder="https://www.example.no/artikkel/123"
                  className="font-mono text-xs"
                />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Henter…"
                >
                  Kjør ekstraktor
                </SubmitButton>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
                Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <div>
                <span className="text-foreground">Opprettet:</span>{" "}
                {fmtDateTime(src.created_at)}
              </div>
              <div>
                <span className="text-foreground">Oppdatert:</span>{" "}
                {fmtDateTime(src.updated_at)}
              </div>
              <div>
                <span className="text-foreground">ID:</span>{" "}
                <code className="font-mono">{src.id}</code>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
