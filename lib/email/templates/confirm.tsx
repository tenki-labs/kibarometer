// lib/email/templates/confirm.tsx — magic-link confirmation email for /bruk.
//
// Rendered via react-dom/server's renderToStaticMarkup. Plaintext fallback is
// hand-written by the caller; we don't auto-derive it from the JSX because
// strip-tags loses the URL formatting context.

/* eslint-disable @next/next/no-head-element -- this is an email HTML
   document, not a Next.js page; <head> is the appropriate element. */

import * as React from "react";

export type ConfirmEmailProps = {
  confirmUrl: string;
};

export function ConfirmEmail({ confirmUrl }: ConfirmEmailProps) {
  return (
    <html lang="nb">
      <head>
        <meta charSet="utf-8" />
        <title>Bekreft din registrering</title>
      </head>
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
          maxWidth: 560,
          margin: "0 auto",
          padding: "24px 16px",
          color: "#0a0a0a",
          backgroundColor: "#ffffff",
          lineHeight: 1.5,
        }}
      >
        <p style={{ marginTop: 0 }}>Hei,</p>
        <p>
          Takk for at du registrerte deg på Kibarometers kartlegging av AI-bruk
          i Norge. Klikk lenken nedenfor for å bekrefte e-postadressen din og
          fullføre registreringen:
        </p>
        <p style={{ margin: "32px 0", textAlign: "center" }}>
          <a
            href={confirmUrl}
            style={{
              display: "inline-block",
              padding: "12px 24px",
              backgroundColor: "#0a0a0a",
              color: "#ffffff",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500,
            }}
          >
            Bekreft registreringen
          </a>
        </p>
        <p style={{ fontSize: 14, color: "#525252" }}>
          Eller åpne denne adressen i nettleseren:
          <br />
          <a href={confirmUrl} style={{ color: "#525252", wordBreak: "break-all" }}>
            {confirmUrl}
          </a>
        </p>
        <p style={{ fontSize: 14, color: "#525252" }}>
          Lenken er gyldig i 24 timer. Hvis du ikke registrerte deg, kan du
          trygt slette denne e-posten — vi gjør ingenting før du bekrefter.
        </p>
        <hr
          style={{
            border: 0,
            borderTop: "1px solid #e5e5e5",
            margin: "32px 0",
          }}
        />
        <p style={{ fontSize: 12, color: "#737373", marginBottom: 0 }}>
          Kibarometer · kartlegger AI i Norge ·{" "}
          <a href="https://kibarometer.no" style={{ color: "#737373" }}>
            kibarometer.no
          </a>
        </p>
      </body>
    </html>
  );
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
