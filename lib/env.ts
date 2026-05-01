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
