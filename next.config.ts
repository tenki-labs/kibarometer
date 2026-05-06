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
      // Admin URL slug standardization (PR 1 of admin restructure).
      // English dev slugs everywhere; sidebar labels stay Norwegian.
      // 308 permanent — bookmarks update on next hit; middleware
      // matcher /admin/:path* still gates these because the redirect
      // resolves to a /admin/* destination.
      {
        source: "/admin/jobs",
        destination: "/admin/processes",
        permanent: true,
      },
      {
        source: "/admin/jobs/:path*",
        destination: "/admin/processes/:path*",
        permanent: true,
      },
      {
        source: "/admin/oppstart",
        destination: "/admin/startups",
        permanent: true,
      },
      {
        source: "/admin/oppstart/:path*",
        destination: "/admin/startups/:path*",
        permanent: true,
      },
      {
        source: "/admin/categories",
        destination: "/admin/job-market/categories",
        permanent: true,
      },
      {
        source: "/admin/categories/:path*",
        destination: "/admin/job-market/categories/:path*",
        permanent: true,
      },
      {
        source: "/admin/llm-prompts",
        destination: "/admin/media/prompts",
        permanent: true,
      },
      {
        source: "/admin/llm-prompts/:path*",
        destination: "/admin/media/prompts/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
