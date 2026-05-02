import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1a4dff",
          color: "#fafafa",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          fontFamily: '"DM Sans", system-ui, sans-serif',
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        K
      </div>
    ),
    size,
  );
}
