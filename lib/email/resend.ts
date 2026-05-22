// lib/email/resend.ts — server-side Resend client used by /bruk submit and
// confirmation flows.
//
// Auth model: Resend's API is a single POST to /emails with a Bearer API key.
// No SDK — bare fetch matches the lib/admin/umami.ts precedent (no third-party
// client where a single endpoint will do).
//
// Env vars (both optional — when missing, resendConfigured() returns null and
// callers degrade gracefully):
//   RESEND_API_KEY  — Bearer API key from resend.com dashboard
//   RESEND_FROM     — From address, e.g. 'Kibarometer <noreply@kibarometer.no>'
//
// Failure semantics: on send failure (HTTP non-2xx or network), the calling
// server action keeps the pending row, increments send_attempts, logs
// last_send_error, and surfaces a "send på nytt" CTA to the user. See
// app/(site)/bruk/actions.ts.

import "server-only";

const ENDPOINT = "https://api.resend.com/emails";

export type ResendConfig = {
  apiKey: string;
  from: string;
};

export function resendConfigured(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export type SendInput = {
  to: string;
  subject: string;
  html: string;
  /** Plaintext fallback. Required by Resend best-practice for deliverability. */
  text: string;
  /** Optional reply-to override; defaults to RESEND_FROM. */
  replyTo?: string;
};

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

// One-shot send. Does NOT retry — the caller decides whether to keep the
// pending row or surface the failure to the user. This matches the GDPR-aware
// design where users explicitly trigger resends rather than the system retrying
// silently.
export async function sendEmail(input: SendInput): Promise<SendResult> {
  const cfg = resendConfigured();
  if (!cfg) {
    return { ok: false, status: 0, error: "Resend ikke konfigurert" };
  }
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: `network: ${msg.slice(0, 200)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 500) };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: json.id ?? "" };
}
