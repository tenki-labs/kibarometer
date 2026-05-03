// lib/env.ts — zod-validated env for the Next.js marketing app.
// Lazy: validates on first access so unrelated build paths don't trip it.
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Server-only — never expose to the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_INTERNAL_URL: z.string().url(),
  // Admin-only (Phase F PR 4): JWT signature secret + cron bearer token.
  // Read directly from process.env in lib/admin/{auth,bearer}.ts. Marked
  // optional here so the marketing-site build doesn't fail on these — the
  // admin code surfaces a clear error at first use if they're missing.
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  FETCHER_TOKEN: z.string().min(1).optional(),
  // Phase G — Umami visitor analytics. NEXT_PUBLIC_* is consumed by
  // (site)/layout.tsx to inject the tracker <script>; the bare-server vars
  // by /admin/analytics. All optional — when blank, the public site omits
  // the script tag and the admin page renders a "not configured" card.
  // Self-hosted Umami has no API-keys feature (cloud-only), so we auth via
  // POST /api/auth/login with username/password and cache the JWT.
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
  UMAMI_INTERNAL_URL: z.string().url().optional(),
  UMAMI_USERNAME: z.string().optional(),
  UMAMI_PASSWORD: z.string().optional(),
  UMAMI_WEBSITE_ID: z.string().optional(),
  // LLM analytics (PR 1+) — Cloudflare-tunneled OpenAI-compatible endpoint
  // exposing Gemma 3 4B-IT (see docs/api_docs.md). Both optional so the
  // CI build with placeholder env passes; lib/admin/mlx.ts surfaces a
  // "not configured" state when MLX_API_KEY is unset.
  MLX_BASE_URL: z.string().url().optional(),
  MLX_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function createEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}

let cached: Env | undefined;
export const env: Env = new Proxy({} as Env, {
  get(_, key: string) {
    if (!cached) cached = createEnv();
    return cached[key as keyof Env];
  },
});
