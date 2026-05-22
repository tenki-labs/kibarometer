// app/(site)/bruk/actions.ts — server actions for the /bruk pillar.
//
// Three actions:
//   submitBrukAction         — POST from the survey form
//   reissueConfirmEmailAction — POST from /bruk/sjekk-eposten when the user
//                               wants a new confirmation email
//   deleteSelfAction         — POST from /bruk/slett with the user's
//                               long-lived delete token
//
// All three follow the PRG convention: validate → mutate → redirect with a
// flash query string. They never return HTML.

"use server";

import "server-only";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { isDisposableEmail } from "@/lib/email/disposable-domains";
import {
  confirmEmailHtml,
  confirmEmailText,
} from "@/lib/email/templates/confirm";
import {
  confirmedEmailHtml,
  confirmedEmailText,
} from "@/lib/email/templates/confirmed";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { checkRate } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const Q2_VALUES = [
  "daglig",
  "ukentlig",
  "av-og-til",
  "proevd-ikke-regelmessig",
  "aldri",
] as const;
const Q3_VALUES = [
  "chatgpt",
  "claude",
  "gemini",
  "copilot",
  "perplexity",
  "lokal",
  "andre",
  "vil-ikke-svare",
] as const;
const Q4_VALUES = [
  "skriving",
  "soek",
  "oppsummering",
  "koding",
  "oversettelse",
  "laering",
  "idemyldring",
  "bildegen",
  "dataanalyse",
  "underholdning",
  "annet",
] as const;
const Q5_VALUES = [
  "sanksjonert",
  "tolerert",
  "uklart",
  "fraraadet",
  "vet-ikke",
] as const;

const CONFIRM_TOKEN_TTL_HOURS = 24;
const MIN_FORM_FILL_MS = 2000; // honeypot: humans take >2s
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kibarometer.no";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string | Buffer): Buffer {
  return crypto.createHash("sha256").update(input).digest();
}

function dailySalt(): string {
  // Day-bucketed so the same IP/UA hashes to a different value each day.
  // Forensic correlation works inside a day; nothing leaks across days.
  return new Date().toISOString().slice(0, 10);
}

async function getClientFingerprint(): Promise<{
  ipHash: Buffer | null;
  uaHash: Buffer | null;
  ipKey: string;
}> {
  const h = await headers();
  const xff = h.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  const ua = h.get("user-agent") ?? "";
  const salt = dailySalt();
  return {
    ipHash: ip ? sha256(`${ip}|${salt}`) : null,
    uaHash: ua ? sha256(ua) : null,
    // ipKey is for rate-limit bucketing — must be stable per IP within a day.
    ipKey: ip ? sha256(`ratelimit|${ip}|${salt}`).toString("hex").slice(0, 24) : "unknown",
  };
}

function buildSubmitSchema() {
  return z
    .object({
      email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
      q1_bransje: z.string().min(1, "Velg bransje"),
      q2_frequency: z.enum(Q2_VALUES),
      // Multi-selects come in as repeated form fields — already normalized to
      // arrays in the action body before validation.
      q3_tools: z.array(z.enum(Q3_VALUES)).optional(),
      q4_use_cases: z.array(z.enum(Q4_VALUES)).optional(),
      q5_workplace_policy: z.enum(Q5_VALUES).optional(),
      // Honeypot + anti-bot timing.
      favoritfarge: z.string().max(0).optional(),
      formLoadedAt: z.coerce.number().int().positive(),
    })
    .refine((d) => {
      // Q3/Q4 skip rule: when q2='aldri', both must be empty/absent.
      const usesAi = d.q2_frequency !== "aldri";
      const hasTools = Array.isArray(d.q3_tools) && d.q3_tools.length > 0;
      const hasUseCases = Array.isArray(d.q4_use_cases) && d.q4_use_cases.length > 0;
      return usesAi ? hasTools && hasUseCases : !hasTools && !hasUseCases;
    }, {
      message:
        "Velg minst ett verktøy og bruksområde dersom du bruker AI (eller velg 'Aldri').",
      path: ["q3_tools"],
    })
    .refine((d) => {
      // Q5 skip rule: only when q1='privatperson'.
      const isPrivate = d.q1_bransje === "privatperson";
      const hasPolicy = !!d.q5_workplace_policy;
      return isPrivate ? !hasPolicy : hasPolicy;
    }, {
      message: "Velg hvordan arbeidsplassen stiller seg til AI-bruk.",
      path: ["q5_workplace_policy"],
    });
}

function generateToken(): { plain: string; hash: Buffer } {
  const plain = crypto.randomBytes(32).toString("base64url");
  return { plain, hash: sha256(plain) };
}

// ---------------------------------------------------------------------------
// submitBrukAction — POST from the survey form
// ---------------------------------------------------------------------------

export async function submitBrukAction(formData: FormData): Promise<void> {
  // Honeypot — bots fill all fields. Cheap, silent reject.
  const honeypot = String(formData.get("favoritfarge") ?? "");
  if (honeypot.length > 0) {
    redirect("/bruk/sjekk-eposten");
  }

  // Timing — bots submit instantly. Reject if filled in < 2s.
  const formLoadedAt = Number(formData.get("formLoadedAt") ?? 0);
  if (formLoadedAt && Date.now() - formLoadedAt < MIN_FORM_FILL_MS) {
    redirect("/bruk/sjekk-eposten");
  }

  // Normalize multi-select arrays from FormData.
  const raw = {
    email: String(formData.get("email") ?? ""),
    q1_bransje: String(formData.get("q1_bransje") ?? ""),
    q2_frequency: String(formData.get("q2_frequency") ?? ""),
    q3_tools: formData.getAll("q3_tools").map(String),
    q4_use_cases: formData.getAll("q4_use_cases").map(String),
    q5_workplace_policy:
      String(formData.get("q5_workplace_policy") ?? "") || undefined,
    favoritfarge: honeypot,
    formLoadedAt,
  };

  const schema = buildSubmitSchema();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    redirect(
      `/bruk${flashQs({ error: first?.message ?? "Ugyldig skjema" })}`,
    );
  }
  const data = parsed.data;

  // Disposable-email gate — silent block (don't leak which domains are blocked).
  if (isDisposableEmail(data.email)) {
    redirect("/bruk/sjekk-eposten");
  }

  const fp = await getClientFingerprint();

  // Rate limit per IP (5/hour, 20/day) and per email (3/hour).
  const ipHour = await checkRate(`bruk:sub:ip:${fp.ipKey}:hr`, 5, 3600);
  const ipDay = await checkRate(`bruk:sub:ip:${fp.ipKey}:day`, 20, 86400);
  const emailHour = await checkRate(
    `bruk:sub:email:${sha256(data.email).toString("hex").slice(0, 24)}:hr`,
    3,
    3600,
  );
  if (!ipHour.ok || !ipDay.ok || !emailHour.ok) {
    redirect(
      `/bruk${flashQs({ error: "For mange forsøk fra denne nettverket eller e-posten. Prøv igjen om en time." })}`,
    );
  }

  // Generate confirm token (plaintext goes in email URL, hash in DB).
  const { plain: confirmPlain, hash: confirmHash } = generateToken();
  const expiresAt = new Date(
    Date.now() + CONFIRM_TOKEN_TTL_HOURS * 3600 * 1000,
  ).toISOString();

  // Upsert against the unique (lower(email) where status in pending/confirmed)
  // index. If a confirmed row exists, the upsert no-ops and we still redirect
  // to /sjekk-eposten — enumeration defense.
  type UpsertRow = {
    email: string;
    status: "pending";
    q1_bransje: string;
    q2_frequency: string;
    q3_tools: string[] | null;
    q4_use_cases: string[] | null;
    q5_workplace_policy: string | null;
    confirm_token_hash: string; // hex
    delete_token_hash: null;
    token_expires_at: string;
    submitted_at: string;
    user_agent_hash: string | null; // hex
    ip_hash: string | null; // hex
    send_attempts: number;
    last_send_error: null;
  };

  const row: UpsertRow = {
    email: data.email,
    status: "pending",
    q1_bransje: data.q1_bransje,
    q2_frequency: data.q2_frequency,
    q3_tools:
      data.q3_tools && data.q3_tools.length > 0 ? data.q3_tools : null,
    q4_use_cases:
      data.q4_use_cases && data.q4_use_cases.length > 0
        ? data.q4_use_cases
        : null,
    q5_workplace_policy: data.q5_workplace_policy ?? null,
    confirm_token_hash: `\\x${confirmHash.toString("hex")}`,
    delete_token_hash: null,
    token_expires_at: expiresAt,
    submitted_at: new Date().toISOString(),
    user_agent_hash: fp.uaHash ? `\\x${fp.uaHash.toString("hex")}` : null,
    ip_hash: fp.ipHash ? `\\x${fp.ipHash.toString("hex")}` : null,
    send_attempts: 0,
    last_send_error: null,
  };

  try {
    // Service-role write. The partial unique index on lower(email) means a
    // confirmed row blocks INSERT — we catch that via the on_conflict path:
    // INSERT … ON CONFLICT on the column makes the upsert overwrite the
    // pending row (rotating the token if user resubmits) but a confirmed row
    // would also be overwritten, which we DON'T want. So we do a two-step:
    // first SELECT status; if confirmed, no-op redirect; else upsert.
    const existing = await sbFetch<Array<{ status: string }>>(
      `/bruk_responses?email=eq.${encodeURIComponent(data.email)}&select=status&limit=1`,
      { service: true, retryTransient: "auto" },
    );
    if (existing[0]?.status === "confirmed") {
      // Already confirmed — silent redirect to enumeration-safe page.
      redirect("/bruk/sjekk-eposten");
    }

    if (existing[0]?.status === "pending") {
      // Rotate token + reset answers on resubmit.
      await sbFetch(
        `/bruk_responses?email=eq.${encodeURIComponent(data.email)}`,
        {
          service: true,
          method: "PATCH",
          body: row,
          prefer: "return=minimal",
        },
      );
    } else {
      // No active row (or status='expired'/'deleted') — insert fresh.
      await sbFetch("/bruk_responses", {
        service: true,
        method: "POST",
        body: row,
        prefer: "return=minimal",
        retryTransient: false, // POST insert is not idempotent
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    redirect(
      `/bruk${flashQs({ error: `Kunne ikke lagre svaret: ${msg.slice(0, 120)}` })}`,
    );
  }

  // Send the confirmation email. If Resend fails we keep the pending row;
  // the user can retry from /sjekk-eposten.
  const confirmUrl = `${SITE_URL}/bruk/bekreft?token=${confirmPlain}`;
  if (resendConfigured()) {
    const send = await sendEmail({
      to: data.email,
      subject: "Bekreft din registrering på Kibarometer",
      html: confirmEmailHtml({ confirmUrl }),
      text: confirmEmailText(confirmUrl),
    });
    if (send.ok === false) {
      const errMsg = send.error.slice(0, 500);
      // Log to last_send_error so /admin/bruk can surface it.
      await sbFetch(
        `/bruk_responses?email=eq.${encodeURIComponent(data.email)}`,
        {
          service: true,
          method: "PATCH",
          body: {
            send_attempts: 1,
            last_send_error: errMsg,
          },
          prefer: "return=minimal",
        },
      ).catch(() => {}); // Don't fail the user-facing flow on a log write.
    } else {
      await sbFetch(
        `/bruk_responses?email=eq.${encodeURIComponent(data.email)}`,
        {
          service: true,
          method: "PATCH",
          body: { send_attempts: 1 },
          prefer: "return=minimal",
        },
      ).catch(() => {});
    }
  }

  redirect("/bruk/sjekk-eposten");
}

// ---------------------------------------------------------------------------
// reissueConfirmEmailAction — POST from /bruk/sjekk-eposten
// ---------------------------------------------------------------------------

export async function reissueConfirmEmailAction(
  formData: FormData,
): Promise<void> {
  const honeypot = String(formData.get("favoritfarge") ?? "");
  if (honeypot.length > 0) {
    redirect("/bruk/sjekk-eposten");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const emailParse = z.string().email().safeParse(email);
  if (!emailParse.success) {
    redirect("/bruk/sjekk-eposten");
  }

  const fp = await getClientFingerprint();
  // Stricter limit on reissue (3/hour per email, 5/hour per IP) — defense
  // against abuse where someone enumerates emails to spam users.
  const emailCheck = await checkRate(
    `bruk:reissue:email:${sha256(email).toString("hex").slice(0, 24)}:hr`,
    3,
    3600,
  );
  const ipCheck = await checkRate(
    `bruk:reissue:ip:${fp.ipKey}:hr`,
    5,
    3600,
  );
  if (!emailCheck.ok || !ipCheck.ok) {
    redirect("/bruk/sjekk-eposten");
  }

  // Look up the row. If no pending row, silently redirect — enumeration safe.
  const rows = await sbFetch<
    Array<{ id: number; status: string }>
  >(
    `/bruk_responses?email=eq.${encodeURIComponent(email)}&select=id,status&limit=1`,
    { service: true },
  ).catch(() => [] as Array<{ id: number; status: string }>);
  const existing = rows[0];
  if (!existing || existing.status !== "pending") {
    redirect("/bruk/sjekk-eposten");
  }

  // Rotate token.
  const { plain, hash } = generateToken();
  const expiresAt = new Date(
    Date.now() + CONFIRM_TOKEN_TTL_HOURS * 3600 * 1000,
  ).toISOString();
  await sbFetch(`/bruk_responses?id=eq.${existing.id}`, {
    service: true,
    method: "PATCH",
    body: {
      confirm_token_hash: `\\x${hash.toString("hex")}`,
      token_expires_at: expiresAt,
    },
    prefer: "return=minimal",
  });

  if (resendConfigured()) {
    const confirmUrl = `${SITE_URL}/bruk/bekreft?token=${plain}`;
    await sendEmail({
      to: email,
      subject: "Bekreft din registrering på Kibarometer (ny lenke)",
      html: confirmEmailHtml({ confirmUrl }),
      text: confirmEmailText(confirmUrl),
    });
  }

  redirect("/bruk/sjekk-eposten");
}

// ---------------------------------------------------------------------------
// deleteSelfAction — POST from /bruk/slett with the user's delete token
// ---------------------------------------------------------------------------

export async function deleteSelfAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    redirect("/bruk/slett?error=missing-token");
  }
  const hash = `\\x${sha256(token).toString("hex")}`;

  // Hard-delete the row. RLS: service-role bypasses the policies; we deliberately
  // don't expose this action to anon at the PostgREST level.
  await sbFetch(`/bruk_responses?delete_token_hash=eq.${hash}`, {
    service: true,
    method: "DELETE",
    prefer: "return=minimal",
  }).catch(() => {});

  redirect("/bruk/slettet");
}

// ---------------------------------------------------------------------------
// confirmTokenAction — internal helper called by /bruk/bekreft server component
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid-or-expired" | "send-failed" };

/**
 * Called from /bruk/bekreft page (server component) with the plaintext token
 * from the URL. Flips the row to confirmed, mints + emails the delete token.
 *
 * Not exposed as a form action — it's a server function the bekreft page
 * invokes directly. Idempotent on the "already confirmed" case: the second
 * call finds no pending row matching the hash and returns invalid-or-expired,
 * but the row is fine.
 */
export async function confirmTokenServerSide(
  plaintext: string,
): Promise<ConfirmResult> {
  if (!plaintext) return { ok: false, reason: "missing" };

  const fp = await getClientFingerprint();
  await checkRate(`bruk:confirm:ip:${fp.ipKey}:hr`, 30, 3600);
  // Rate-limit observation only; we don't block on this — the bekreft path
  // is GET-only from email and the magic-link token is the real gate.

  const hash = `\\x${sha256(plaintext).toString("hex")}`;
  // Generate the delete token up-front so we can include it in the PATCH.
  const deleteToken = crypto.randomBytes(32).toString("base64url");
  const deleteHash = `\\x${sha256(deleteToken).toString("hex")}`;
  const nowIso = new Date().toISOString();

  // Single-use: filter on token + pending + not-expired, set confirmed,
  // null the confirm hash. Returns the matched rows so we know if it worked.
  const matched = await sbFetch<
    Array<{ id: number; email: string }>
  >(
    `/bruk_responses?confirm_token_hash=eq.${hash}&status=eq.pending&token_expires_at=gt.${encodeURIComponent(nowIso)}&select=id,email`,
    {
      service: true,
      method: "PATCH",
      body: {
        status: "confirmed",
        confirm_token_hash: null,
        delete_token_hash: deleteHash,
        token_expires_at: null,
        confirmed_at: nowIso,
      },
      prefer: "return=representation",
    },
  );
  if (!matched || matched.length === 0) {
    return { ok: false, reason: "invalid-or-expired" };
  }
  const row = matched[0];

  // Send the "you are registered" receipt with the delete-token URL.
  if (resendConfigured()) {
    const deleteUrl = `${SITE_URL}/bruk/slett?token=${deleteToken}`;
    const brukUrl = `${SITE_URL}/bruk`;
    const send = await sendEmail({
      to: row.email,
      subject: "Du er registrert på Kibarometer",
      html: confirmedEmailHtml({ deleteUrl, brukUrl }),
      text: confirmedEmailText(deleteUrl, brukUrl),
    });
    if (send.ok === false) {
      const errMsg = send.error.slice(0, 400);
      // The row is confirmed; the user has access via the link they just
      // clicked. Receipt-email failure is non-fatal but we log it.
      await sbFetch(`/bruk_responses?id=eq.${row.id}`, {
        service: true,
        method: "PATCH",
        body: { last_send_error: `confirmed-email: ${errMsg}` },
        prefer: "return=minimal",
      }).catch(() => {});
    }
  }

  return { ok: true };
}
