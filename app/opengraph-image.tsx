import { ImageResponse } from "next/og";

export const alt =
  "Kibarometeret — åpen kartlegging av kunstig intelligens i Norge, daglig oppdatert.";
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
            fontSize: 84,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Åpen kartlegging av kunstig intelligens i Norge, daglig oppdatert.
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
          <span style={{ color: "#0f0f12" }}>Tenki Labs</span>
        </div>
      </div>
    ),
    size,
  );
}
