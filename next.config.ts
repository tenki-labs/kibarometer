import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by docker/web.Dockerfile — multi-stage build copies
  // .next/standalone/ into the runtime image.
  output: "standalone",
  // The dev/CI typecheck (pnpm typecheck) is the source of truth; don't
  // re-run it during `next build` since the build itself can't fail on
  // type errors anyway when run in CI with strict: false.
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/jobb-barometer",
        destination: "/jobbmarked",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
