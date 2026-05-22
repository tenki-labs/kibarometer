// GET /admin/api/bruk/export-confirmed.csv — one-click CSV of all confirmed
// /bruk respondents. Linked from the prominent card on /admin/bruk Oversikt.
//
// Auth: covered by the global /admin/* middleware gate — only staff cookies
// reach this handler.
//
// CSV format (per the plan):
//   - UTF-8 with BOM (Excel-friendly), CRLF line endings
//   - Multi-select arrays joined with "|" and double-quoted
//   - Norwegian column headers matching the admin UI
//   - Excludes ip_hash, user_agent_hash, internal id, raw_jsonb, all tokens —
//     minimum data exposure per GDPR. Forensics stays in the DB.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { sbFetch } from "@/lib/admin/sb";

type Row = {
  confirmed_at: string | null;
  email: string;
  q1_bransje: string;
  q2_frequency: string;
  q3_tools: string[] | null;
  q4_use_cases: string[] | null;
  q5_workplace_policy: string | null;
};

const HEADERS = [
  "bekreftet_dato",
  "email",
  "bransje",
  "frekvens",
  "verktoy",
  "bruksomraader",
  "arbeidsplass_policy",
];

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function joinMulti(arr: string[] | null): string {
  if (!arr || arr.length === 0) return "";
  return arr.join("|");
}

function isoOrEmpty(v: string | null): string {
  return v ?? "";
}

export async function GET() {
  try {
    const rows = await sbFetch<Row[]>(
      "/bruk_responses?status=eq.confirmed&select=confirmed_at,email,q1_bransje,q2_frequency,q3_tools,q4_use_cases,q5_workplace_policy&order=confirmed_at.desc",
      { service: true },
    );

    const utf8Bom = "﻿";
    const lines: string[] = [HEADERS.join(",")];
    for (const r of rows) {
      lines.push(
        [
          isoOrEmpty(r.confirmed_at),
          csvEscape(r.email),
          csvEscape(r.q1_bransje),
          r.q2_frequency,
          csvEscape(joinMulti(r.q3_tools)),
          csvEscape(joinMulti(r.q4_use_cases)),
          r.q5_workplace_policy ?? "",
        ].join(","),
      );
    }
    const body = utf8Bom + lines.join("\r\n") + "\r\n";

    const filename = `bruk-bekreftede-${new Date().toISOString().slice(0, 10)}.csv`;
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
