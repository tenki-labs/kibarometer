// app/admin/(app)/bruk/actions.ts — server actions for the /admin/bruk pages.
//
// Mutating actions only — CSV exports live as GET route handlers under
// app/admin/api/bruk/ (browser file-download semantics work better with plain
// <a href download> links than with server-action Response returns).

"use server";

import "server-only";

import crypto from "node:crypto";
import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import {
  ConfirmEmail,
  confirmEmailText,
} from "@/lib/email/templates/confirm";
import { renderToStaticMarkup } from "react-dom/server";

const LIST = "/admin/bruk";
const RESPONSES = "/admin/bruk/responses";

const CONFIRM_TOKEN_TTL_HOURS = 24;
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kibarometer.no";

function sha256(input: string | Buffer): Buffer {
  return crypto.createHash("sha256").update(input).digest();
}

// ---------------------------------------------------------------------------
// refreshBrukStatsAction — manual snapshot rebuild
// ---------------------------------------------------------------------------

export async function refreshBrukStatsAction() {
  try {
    await sbFetch("/rpc/refresh_bruk_aggregate_snapshot", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: "Aggregert snapshot ble oppdatert." })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// ---------------------------------------------------------------------------
// resendConfirmAdminAction — admin override, bypasses per-email rate limit
// ---------------------------------------------------------------------------

export async function resendConfirmAdminAction(formData: FormData) {
  const id = Number(formData.get("id") ?? 0);
  if (!id) {
    redirect(`${RESPONSES}${flashQs({ error: "Manglende rad-id." })}`);
  }

  try {
    const rows = await sbFetch<
      Array<{ id: number; email: string; status: string }>
    >(
      `/bruk_responses?id=eq.${id}&select=id,email,status&limit=1`,
      { service: true },
    );
    const row = rows[0];
    if (!row) {
      redirect(`${RESPONSES}${flashQs({ error: "Fant ikke raden." })}`);
    }
    if (row.status !== "pending") {
      redirect(
        `${RESPONSES}${flashQs({
          error: `Kan bare sende på nytt for ventende rader (status=${row.status}).`,
        })}`,
      );
    }

    // Rotate token + extend expiry.
    const plain = crypto.randomBytes(32).toString("base64url");
    const hash = sha256(plain);
    const expiresAt = new Date(
      Date.now() + CONFIRM_TOKEN_TTL_HOURS * 3600 * 1000,
    ).toISOString();

    await sbFetch(`/bruk_responses?id=eq.${row.id}`, {
      service: true,
      method: "PATCH",
      body: {
        confirm_token_hash: `\\x${hash.toString("hex")}`,
        token_expires_at: expiresAt,
      },
      prefer: "return=minimal",
    });

    if (!resendConfigured()) {
      redirect(
        `${RESPONSES}${flashQs({
          error: "RESEND_API_KEY mangler — token rotert, men e-post ikke sendt.",
        })}`,
      );
    }

    const confirmUrl = `${SITE_URL}/bruk/bekreft?token=${plain}`;
    const html = renderToStaticMarkup(ConfirmEmail({ confirmUrl }));
    const send = await sendEmail({
      to: row.email,
      subject: "Bekreft din registrering på Kibarometer",
      html: `<!doctype html>${html}`,
      text: confirmEmailText(confirmUrl),
    });

    if (send.ok === false) {
      const errMsg = send.error.slice(0, 400);
      await sbFetch(`/bruk_responses?id=eq.${row.id}`, {
        service: true,
        method: "PATCH",
        body: {
          last_send_error: `admin-resend: ${errMsg}`,
        },
        prefer: "return=minimal",
      }).catch(() => {});
      redirect(
        `${RESPONSES}${flashQs({ error: `Resend feilet: ${errMsg.slice(0, 120)}` })}`,
      );
    }

    // Bump send_attempts on success.
    await sbFetch(`/bruk_responses?id=eq.${row.id}`, {
      service: true,
      method: "PATCH",
      body: { send_attempts: 1, last_send_error: null },
      prefer: "return=minimal",
    }).catch(() => {});

    redirect(
      `${RESPONSES}${flashQs({ ok: `Bekreftelses-e-post sendt til ${row.email}.` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${RESPONSES}${flashQs({ error: msg(err) })}`);
  }
}

// ---------------------------------------------------------------------------
// deleteResponseAdminAction — hard-delete a single row (GDPR override)
// ---------------------------------------------------------------------------

export async function deleteResponseAdminAction(formData: FormData) {
  const id = Number(formData.get("id") ?? 0);
  if (!id) {
    redirect(`${RESPONSES}${flashQs({ error: "Manglende rad-id." })}`);
  }
  try {
    await sbFetch(`/bruk_responses?id=eq.${id}`, {
      service: true,
      method: "DELETE",
      prefer: "return=minimal",
    });
    redirect(
      `${RESPONSES}${flashQs({ ok: `Rad ${id} slettet permanent.` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${RESPONSES}${flashQs({ error: msg(err) })}`);
  }
}

// ---------------------------------------------------------------------------
// bulkDeleteExpiredPendingAction — same logic as the cron sweep, manual trigger
// ---------------------------------------------------------------------------

export async function bulkDeleteExpiredPendingAction() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  try {
    await sbFetch(
      `/bruk_responses?status=eq.pending&submitted_at=lt.${encodeURIComponent(cutoff)}`,
      {
        service: true,
        method: "DELETE",
        prefer: "return=minimal",
      },
    );
    redirect(
      `${RESPONSES}${flashQs({ ok: "Utløpte ventende rader (> 30 dager) slettet." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${RESPONSES}${flashQs({ error: msg(err) })}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers (mirrored from offentlig/actions.ts)
// ---------------------------------------------------------------------------

function isRedirect(err: unknown): boolean {
  return (
    err instanceof Error &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
