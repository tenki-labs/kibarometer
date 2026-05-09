import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // `@/...` imports come from server-action specs (e.g. app/admin/(app)/
  // media/queue/actions.test.ts) that exercise code under app/. Picks up
  // tsconfig.json's `paths` automatically so the alias matches what
  // Next.js resolves at runtime — no drift.
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` is a Next.js sentinel module that throws if imported
      // from a client component. Server-action code in app/ imports it
      // transitively via lib/admin/sb. In Vitest there is no Next runtime,
      // so resolve it to an empty stub instead of crashing on load.
      "server-only": new URL(
        "./test/stubs/server-only.js",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/local-dev/data/**",
      "**/supabase/data/**",
      "**/dist/**",
      "**/e2e/**",
    ],
    passWithNoTests: true,
  },
});
