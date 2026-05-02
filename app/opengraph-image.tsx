import { ImageResponse } from "next/og";

export const alt =
  "Kibarometeret — uavhengig analyse av norsk arbeidsmarked basert på data fra NAV";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fafafa",
          color: "#0f0f12",
          padding: "96px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: '"DM Sans", system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#6e6e76",
          }}
        >
          · kibarometer
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            maxWidth: "950px",
          }}
        >
          Norsk arbeidsmarked, daglig oppdatert.
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 32,
            color: "#6e6e76",
          }}
        >
          <span>kibarometer.no</span>
          <span style={{ color: "#1a4dff" }}>Tenki Labs</span>
        </div>
      </div>
    ),
    size,
  );
}
