// lib/email/templates/confirmed.tsx — post-confirmation receipt for /bruk.
// Sent immediately after the user clicks the magic link. Carries the
// long-lived delete token so the user can self-serve withdraw their data at
// any time without a support ticket.

/* eslint-disable @next/next/no-head-element -- this is an email HTML
   document, not a Next.js page; <head> is the appropriate element. */

import * as React from "react";

export type ConfirmedEmailProps = {
  deleteUrl: string;
  brukUrl: string;
};

export function ConfirmedEmail({ deleteUrl, brukUrl }: ConfirmedEmailProps) {
  return (
    <html lang="nb">
      <head>
        <meta charSet="utf-8" />
        <title>Du er registrert</title>
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
          Du er nå registrert på Kibarometers kartlegging av AI-bruk i Norge.
          Svarene dine telles inn i de offentlige aggregerte tallene på{" "}
          <a href={brukUrl}>{brukUrl}</a>.
        </p>
        <p>
          <strong>Vil du slette svarene dine senere?</strong> Bruk lenken nedenfor.
          Den utløper ikke — ta vare på denne e-posten hvis du vil kunne slette
          deg selv uten å kontakte oss.
        </p>
        <p style={{ margin: "32px 0", textAlign: "center" }}>
          <a
            href={deleteUrl}
            style={{
              display: "inline-block",
              padding: "12px 24px",
              border: "1px solid #0a0a0a",
              color: "#0a0a0a",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500,
            }}
          >
            Slett mine svar
          </a>
        </p>
        <p style={{ fontSize: 14, color: "#525252" }}>
          Eller åpne denne adressen i nettleseren:
          <br />
          <a href={deleteUrl} style={{ color: "#525252", wordBreak: "break-all" }}>
            {deleteUrl}
          </a>
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
