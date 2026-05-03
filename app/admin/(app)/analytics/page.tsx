import Link from "next/link";
import { BarChart3, Globe, Link as LinkIcon, MapPin } from "lucide-react";

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
import { StatCard } from "@/app/admin/_components/stat-card";
import {
  getMetric,
  getPageviewSeries,
  getStats,
  umamiConfigured,
} from "@/lib/admin/umami";

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABEL: Record<Range, string> = {
  "24h": "24 timer",
  "7d": "7 dager",
  "30d": "30 dager",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rangeParam = pickString(sp.range);
  const range: Range = (RANGES as readonly string[]).includes(rangeParam ?? "")
    ? (rangeParam as Range)
    : "7d";

  const cfg = umamiConfigured();

  if (!cfg) {
    return (
      <>
        <Flash searchParams={sp} />
        <PageHeader
          eyebrow="Innsikt"
          title="Analytics"
          description="Self-hosted besøksstatistikk via kiba-umami."
        />
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Umami er ikke ferdig satt opp
            </CardTitle>
            <CardDescription>
              Mangler <code className="font-mono">UMAMI_USERNAME</code>,{" "}
              <code className="font-mono">UMAMI_PASSWORD</code> eller{" "}
              <code className="font-mono">UMAMI_WEBSITE_ID</code> i{" "}
              <code className="font-mono">/opt/kibarometer/env/admin.env</code>.
              Lokalt: <code className="font-mono">.env.local</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            <p className="mb-2">
              Førstegangs-oppsett (én gang per miljø — Umami self-hosted har
              ingen API-keys-UI; vi logger inn med brukernavn/passord og
              cacher JWT-tokenet i 50 min):
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Åpne Umami:{" "}
                <code className="font-mono text-xs">http://localhost:3001</code>{" "}
                (lokalt) eller via SSH-tunnel{" "}
                <code className="font-mono text-xs">
                  ssh -L 3001:127.0.0.1:3001 deploy@193.200.238.120
                </code>{" "}
                (VPS — krever{" "}
                <code className="font-mono">127.0.0.1:3001:3000</code>{" "}
                port-binding på <code className="font-mono">kiba-umami</code>).
              </li>
              <li>
                Logg inn med default <code className="font-mono">admin</code>{" "}
                / <code className="font-mono">umami</code>, bytt passord (nå
                blir det adminens <em>API-passord</em>).
              </li>
              <li>
                Lag et nettsted (Settings → Websites → Add) — domene{" "}
                <code className="font-mono text-xs">localhost</code> lokalt
                eller <code className="font-mono text-xs">kibarometer.no</code>{" "}
                på VPS. Kopier <code className="font-mono">Website ID</code>.
              </li>
              <li>
                Skriv inn i env-filen ({" "}
                <code className="font-mono text-xs">.env.local</code> /{" "}
                <code className="font-mono text-xs">admin.env</code>):{" "}
                <code className="font-mono">UMAMI_USERNAME</code>,{" "}
                <code className="font-mono">UMAMI_PASSWORD</code>,{" "}
                <code className="font-mono">UMAMI_WEBSITE_ID</code> og{" "}
                <code className="font-mono">NEXT_PUBLIC_UMAMI_WEBSITE_ID</code>{" "}
                (siste samme som Website ID).
              </li>
              <li>
                Restart <code className="font-mono">pnpm dev</code> /
                re-deploy. Tracker-tagen bakes inn i (site)/layout.tsx, og
                denne siden begynner å vise data.
              </li>
            </ol>
          </CardContent>
        </Card>
      </>
    );
  }

  const [stats, series, topPaths, topReferrers, topCountries] = await Promise.all([
    getStats(cfg, range).catch(() => null),
    getPageviewSeries(cfg, range).catch(() => null),
    getMetric(cfg, range, "path", 15).catch(() => []),
    getMetric(cfg, range, "referrer", 10).catch(() => []),
    getMetric(cfg, range, "country", 10).catch(() => []),
  ]);

  // Tiny SVG sparkline for the pageviews series.
  const points = series?.pageviews ?? [];
  const maxY = Math.max(1, ...points.map((p) => p.y));
  const sparkW = 600;
  const sparkH = 80;
  const path =
    points.length === 0
      ? ""
      : points
          .map((p, i) => {
            const x = (i / Math.max(1, points.length - 1)) * sparkW;
            const y = sparkH - (p.y / maxY) * sparkH;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Innsikt"
        title="Analytics"
        description={`Besøksstatistikk fra Umami — siste ${RANGE_LABEL[range].toLowerCase()}.`}
        action={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/admin/analytics?range=${r}`}
                className={
                  r === range
                    ? "rounded-md border bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                    : "rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                }
              >
                {RANGE_LABEL[r]}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sidevisninger"
          value={stats ? stats.pageviews.value.toLocaleString("nb-NO") : "—"}
          hint={stats ? diffHint(stats.pageviews.value, stats.pageviews.prev) : "—"}
        />
        <StatCard
          label="Unike besøkende"
          value={stats ? stats.visitors.value.toLocaleString("nb-NO") : "—"}
          hint={stats ? diffHint(stats.visitors.value, stats.visitors.prev) : "—"}
        />
        <StatCard
          label="Økter"
          value={stats ? stats.visits.value.toLocaleString("nb-NO") : "—"}
          hint={stats ? diffHint(stats.visits.value, stats.visits.prev) : "—"}
        />
        <StatCard
          label="Snittid (s)"
          value={
            stats && stats.visits.value > 0
              ? Math.round(stats.totaltime.value / stats.visits.value).toString()
              : "—"
          }
          hint="per økt"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <BarChart3 className="size-3.5" />
            Sidevisninger over tid
          </CardTitle>
          <CardDescription>
            {points.length} datapunkter · maks {maxY.toLocaleString("nb-NO")} per{" "}
            {range === "24h" ? "time" : "døgn"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <svg
            viewBox={`0 0 ${sparkW} ${sparkH}`}
            preserveAspectRatio="none"
            className="h-20 w-full"
            aria-label="Sidevisninger over tid"
          >
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricCard
          icon={<LinkIcon className="size-3.5" />}
          title="Topp sider"
          rows={topPaths}
          formatLabel={(s) => s || "/"}
        />
        <MetricCard
          icon={<Globe className="size-3.5" />}
          title="Topp henvisere"
          rows={topReferrers}
          formatLabel={(s) => s || <span className="text-muted-foreground">direkte</span>}
        />
        <MetricCard
          icon={<MapPin className="size-3.5" />}
          title="Topp land"
          rows={topCountries}
          formatLabel={(s) => s || "ukjent"}
        />
      </div>
    </>
  );
}

function MetricCard({
  icon,
  title,
  rows,
  formatLabel,
}: {
  icon: React.ReactNode;
  title: string;
  rows: { x: string; y: number }[];
  formatLabel: (s: string) => React.ReactNode;
}) {
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Verdi</TableHead>
            <TableHead className="text-right">Antall</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={2}
                className="py-8 text-center text-muted-foreground"
              >
                Ingen data
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.x}>
                <TableCell className="max-w-xs truncate font-mono text-xs">
                  {formatLabel(r.x)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.y}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function diffHint(curr?: number, prev?: number): string {
  if (curr == null || prev == null) return "—";
  if (prev === 0) return curr > 0 ? "ny periode" : "ingen forrige";
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}% mot forrige`;
}

function pickString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
