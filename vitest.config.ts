import { defineConfig } from "vitest/config";

export default defineConfig({
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
