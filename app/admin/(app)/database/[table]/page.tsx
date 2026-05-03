import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { sbFetch } from "@/lib/admin/sb";

const PAGE_SIZE = 100;

// Same table-name guard as admin_list_tables() — defense in depth: even if
// someone navigates by typing /admin/database/<sensitive-table> directly we
// refuse to render. PostgREST + service-role would technically let us read
// it, so this list is the only thing standing between the URL bar and the
// data.
const NAME_GUARD = /^[a-z][a-z0-9_]*$/;
const COL_NAME_GUARD = /^[a-z_][a-z0-9_]*$/;
const DENY_KEYWORDS = ["token", "secret", "password"];

// jsonb / json columns can carry multi-MB payloads (notably nav_raw.payload).
// `select=*&limit=100` on those tables 502s at Kong because the upstream
// response exceeds its window. Project them away by default; the viewer is
// for spotting shape and recent rows, not for inspecting full JSON.
const JSON_TYPES = new Set(["json", "jsonb"]);

type ColumnInfo = { column_name: string; data_type: string };

type Props = {
  params: Promise<{ table: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DataTablePage({ params, searchParams }: Props) {
  const { table } = await params;
  const sp = await searchParams;

  const offsetParam = pickString(sp.offset);
  const offset = Math.max(0, parseInt(offsetParam ?? "0", 10) || 0);
  const orderParam = pickString(sp.order);

  if (!NAME_GUARD.test(table) || DENY_KEYWORDS.some((k) => table.includes(k))) {
    return errorCard(table, "Tabellnavnet er blokkert eller ugyldig.");
  }

  const columnsMeta = await sbFetch<ColumnInfo[]>(
    "/rpc/admin_list_table_columns",
    { service: true, method: "POST", body: { p_table: table } },
  ).catch(() => [] as ColumnInfo[]);

  const visibleCols = columnsMeta.filter(
    (c) =>
      COL_NAME_GUARD.test(c.column_name) && !JSON_TYPES.has(c.data_type),
  );
  const hiddenCount = columnsMeta.length - visibleCols.length;
  // If the RPC is missing (pre-migration) or the table genuinely has no
  // columns, fall back to `*` so we don't render an empty page; this keeps
  // the diagnostic value of "did the route work at all" intact.
  const selectClause =
    visibleCols.length > 0
      ? visibleCols.map((c) => c.column_name).join(",")
      : "*";

  let rows: Record<string, unknown>[] = [];
  let errorMsg: string | null = null;

  try {
    const orderQs = orderParam ? `&order=${encodeURIComponent(orderParam)}` : "";
    rows = await sbFetch<Record<string, unknown>[]>(
      `/${encodeURIComponent(table)}?select=${selectClause}&limit=${PAGE_SIZE}&offset=${offset}${orderQs}`,
      { service: true },
    );
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  if (errorMsg) {
    return errorCard(table, errorMsg);
  }

  const columns =
    visibleCols.length > 0
      ? visibleCols.map((c) => c.column_name)
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];

  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;
  // No total count (PostgREST count semantics are version-dependent + sbFetch
  // doesn't expose Content-Range). Use full-page heuristic: if we got
  // PAGE_SIZE rows there might be more, otherwise we've reached the end.
  const hasNext = rows.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Innsikt"
        title={table}
        description={`Viser ${rows.length} rader fra offset ${offset}.`}
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/database">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card className="gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Rader
          </CardTitle>
          <CardDescription className="mt-1">
            Skrivebeskyttet. For å sortere: legg til{" "}
            <code className="font-mono text-xs">?order=col.desc</code> i URL-en.
            {hiddenCount > 0 ? (
              <>
                {" "}
                {hiddenCount}{" "}
                {hiddenCount === 1 ? "JSON-kolonne" : "JSON-kolonner"} skjult
                for å unngå tunge svar.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c} className="font-mono text-[0.65rem]">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={Math.max(1, columns.length)}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen rader.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell
                        key={c}
                        className="max-w-xs truncate align-top font-mono text-xs"
                        title={cellTitle(row[c])}
                      >
                        {renderCell(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Button asChild variant="outline" size="sm" disabled={!hasPrev}>
          <Link
            href={`/admin/database/${encodeURIComponent(table)}?offset=${prevOffset}${orderParam ? `&order=${encodeURIComponent(orderParam)}` : ""}`}
            aria-disabled={!hasPrev}
            tabIndex={hasPrev ? 0 : -1}
          >
            <ChevronLeft />
            Forrige
          </Link>
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          offset {offset}
        </span>
        <Button asChild variant="outline" size="sm" disabled={!hasNext}>
          <Link
            href={`/admin/database/${encodeURIComponent(table)}?offset=${nextOffset}${orderParam ? `&order=${encodeURIComponent(orderParam)}` : ""}`}
            aria-disabled={!hasNext}
            tabIndex={hasNext ? 0 : -1}
          >
            Neste
            <ChevronRight />
          </Link>
        </Button>
      </div>
    </>
  );
}

function pickString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function renderCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function cellTitle(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function errorCard(table: string, msg: string) {
  return (
    <>
      <PageHeader
        eyebrow="Innsikt"
        title={table}
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/database">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />
      <Card className="border-destructive">
        <CardContent className="py-6">
          <p className="text-sm text-destructive">{msg}</p>
        </CardContent>
      </Card>
    </>
  );
}
