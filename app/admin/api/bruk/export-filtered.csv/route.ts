// GET /admin/api/bruk/export-filtered.csv — CSV export respecting the Svar
// page's URL filters. Linked from the "Eksporter utvalg" button on
// /admin/bruk/responses.
//
// Accepted query params (all optional, mirror the Svar page filters):
//   status   — 'pending' | 'confirmed' | 'expired' | 'deleted' (default: all)
//   bransje  — taxonomy slug or 'privatperson'
//   q2       — frequency enum
//   email    — substring (case-insensitive, ilike *value*)
//   since    — ISO date, submitted_at >= since
//   until    — ISO date, submitted_at <= until
//
// Same CSV format as export-confirmed.csv. Excludes hashes + tokens + raw_jsonb.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { sbFetch } from "@/lib/admin/sb";

type Row = {
  submitted_at: string;
  confirmed_at: string | null;
  email: string;
  status: string;
  q1_bransje: string;
  q2_frequency: string;
  q3_tools: string[] | null;
  q4_use_cases: string[] | null;
  q5_workplace_policy: string | null;
  send_attempts: number;
};

const HEADERS = [
  "innsendt_dato",
  "bekreftet_dato",
  "status",
  "email",
  "bransje",
  "frekvens",
  "verktoy",
  "bruksomraader",
  "arbeidsplass_policy",
  "send_forsoek",
];

const ALLOWED_STATUSES = new Set([
  "pending",
  "confirmed",
  "expired",
  "deleted",
]);

const ALLOWED_FREQUENCIES = new Set([
  "daglig",
  "ukentlig",
  "av-og-til",
  "proevd-ikke-regelmessig",
  "aldri",
]);

function csvEscape(v: string): string {
  if (
    v.includes(",") ||
    v.includes('"') ||
    v.includes("\n") ||
    v.includes("\r")
  ) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function joinMulti(arr: string[] | null): string {
  return arr && arr.length > 0 ? arr.join("|") : "";
}

function isValidIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v);
}

function buildPostgrestQuery(sp: URLSearchParams): string {
  const parts: string[] = [];
  parts.push(
    "select=submitted_at,confirmed_at,email,status,q1_bransje,q2_frequency,q3_tools,q4_use_cases,q5_workplace_policy,send_attempts",
  );

  const status = sp.get("status");
  if (status && ALLOWED_STATUSES.has(status)) {
    parts.push(`status=eq.${status}`);
  }

  const bransje = sp.get("bransje");
  if (bransje) {
    // Accept 'privatperson' or any non-empty slug. PostgREST escapes are minimal
    // here because we let it return rows that match — the trigger on
    // bruk_responses validates real slugs at insert; filtering by an unknown
    // slug just returns nothing.
    parts.push(`q1_bransje=eq.${encodeURIComponent(bransje)}`);
  }

  const q2 = sp.get("q2");
  if (q2 && ALLOWED_FREQUENCIES.has(q2)) {
    parts.push(`q2_frequency=eq.${q2}`);
  }

  const email = sp.get("email");
  if (email && email.length <= 200) {
    parts.push(`email=ilike.*${encodeURIComponent(email)}*`);
  }

  const since = sp.get("since");
  if (since && isValidIsoDate(since)) {
    parts.push(`submitted_at=gte.${encodeURIComponent(since)}`);
  }
  const until = sp.get("until");
  if (until && isValidIsoDate(until)) {
    parts.push(`submitted_at=lte.${encodeURIComponent(until)}`);
  }

  parts.push("order=submitted_at.desc");
  return parts.join("&");
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const query = buildPostgrestQuery(sp);
    const rows = await sbFetch<Row[]>(`/bruk_responses?${query}`, {
      service: true,
    });

    const utf8Bom = "﻿";
    const lines: string[] = [HEADERS.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.submitted_at,
          r.confirmed_at ?? "",
          r.status,
          csvEscape(r.email),
          csvEscape(r.q1_bransje),
          r.q2_frequency,
          csvEscape(joinMulti(r.q3_tools)),
          csvEscape(joinMulti(r.q4_use_cases)),
          r.q5_workplace_policy ?? "",
          String(r.send_attempts ?? 0),
        ].join(","),
      );
    }
    const body = utf8Bom + lines.join("\r\n") + "\r\n";

    const filename = `bruk-utvalg-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
