// lib/email/templates/confirmed.tsx — post-confirmation receipt for /bruk.
// Sent immediately after the user clicks the magic link. Carries the
// long-lived delete token so the user can self-serve withdraw their data at
// any time without a support ticket.
//
// Plain HTML template literals (not JSX) — same reason as confirm.tsx.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ConfirmedEmailProps = {
  deleteUrl: string;
  brukUrl: string;
};

export function confirmedEmailHtml({
  deleteUrl,
  brukUrl,
}: ConfirmedEmailProps): string {
  const safeDelete = escapeHtml(deleteUrl);
  const safeBruk = escapeHtml(brukUrl);
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>Du er registrert</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#0a0a0a;background-color:#ffffff;line-height:1.5">
<p style="margin-top:0">Hei,</p>
<p>
Du er nå registrert på Kibarometers kartlegging av AI-bruk i Norge.
Svarene dine telles inn i de offentlige aggregerte tallene på
<a href="${safeBruk}">${safeBruk}</a>.
</p>
<p>
<strong>Vil du slette svarene dine senere?</strong> Bruk lenken nedenfor.
Den utløper ikke — ta vare på denne e-posten hvis du vil kunne slette deg
selv uten å kontakte oss.
</p>
<p style="margin:32px 0;text-align:center">
<a href="${safeDelete}" style="display:inline-block;padding:12px 24px;border:1px solid #0a0a0a;color:#0a0a0a;text-decoration:none;border-radius:6px;font-weight:500">
Slett mine svar
</a>
</p>
<p style="font-size:14px;color:#525252">
Eller åpne denne adressen i nettleseren:<br />
<a href="${safeDelete}" style="color:#525252;word-break:break-all">${safeDelete}</a>
</p>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:32px 0" />
<p style="font-size:12px;color:#737373;margin-bottom:0">
Kibarometer · kartlegger AI i Norge ·
<a href="https://kibarometer.no" style="color:#737373">kibarometer.no</a>
</p>
</body>
</html>`;
}

export function confirmedEmailText(deleteUrl: string, brukUrl: string): string {
  return [
    "Hei,",
    "",
    `Du er nå registrert på Kibarometers kartlegging av AI-bruk i Norge.`,
    `Svarene dine telles inn i de offentlige aggregerte tallene på ${brukUrl}.`,
    "",
    "Vil du slette svarene dine senere? Bruk lenken nedenfor. Den utløper ikke",
    "— ta vare på denne e-posten hvis du vil kunne slette deg selv uten å",
    "kontakte oss:",
    "",
    deleteUrl,
    "",
    "Kibarometer · kibarometer.no",
  ].join("\n");
}
