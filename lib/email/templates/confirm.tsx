// lib/email/templates/confirm.tsx — magic-link confirmation email for /bruk.
//
// Plain HTML template literals — NOT a React component. Next.js Turbopack
// blocks `react-dom/server` imports in server actions; rendering JSX to
// string would require that. Static template strings work fine here since
// the templates have no dynamic structure beyond the confirmUrl.
//
// Kept the .tsx extension purely for consistency with the rest of lib/email;
// no JSX is actually used. Could be renamed to .ts; not worth the churn.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ConfirmEmailProps = {
  confirmUrl: string;
};

export function confirmEmailHtml({ confirmUrl }: ConfirmEmailProps): string {
  const safeUrl = escapeHtml(confirmUrl);
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<title>Bekreft din registrering</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#0a0a0a;background-color:#ffffff;line-height:1.5">
<p style="margin-top:0">Hei,</p>
<p>
Takk for at du registrerte deg på Kibarometers kartlegging av AI-bruk i
Norge. Klikk lenken nedenfor for å bekrefte e-postadressen din og fullføre
registreringen:
</p>
<p style="margin:32px 0;text-align:center">
<a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background-color:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500">
Bekreft registreringen
</a>
</p>
<p style="font-size:14px;color:#525252">
Eller åpne denne adressen i nettleseren:<br />
<a href="${safeUrl}" style="color:#525252;word-break:break-all">${safeUrl}</a>
</p>
<p style="font-size:14px;color:#525252">
Lenken er gyldig i 24 timer. Hvis du ikke registrerte deg, kan du trygt
slette denne e-posten — vi gjør ingenting før du bekrefter.
</p>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:32px 0" />
<p style="font-size:12px;color:#737373;margin-bottom:0">
Kibarometer · kartlegger AI i Norge ·
<a href="https://kibarometer.no" style="color:#737373">kibarometer.no</a>
</p>
</body>
</html>`;
}

export function confirmEmailText(confirmUrl: string): string {
  return [
    "Hei,",
    "",
    "Takk for at du registrerte deg på Kibarometers kartlegging av AI-bruk i Norge.",
    "Åpne denne adressen i nettleseren for å bekrefte e-postadressen din:",
    "",
    confirmUrl,
    "",
    "Lenken er gyldig i 24 timer. Hvis du ikke registrerte deg, kan du trygt slette",
    "denne e-posten — vi gjør ingenting før du bekrefter.",
    "",
    "Kibarometer · kibarometer.no",
  ].join("\n");
}
