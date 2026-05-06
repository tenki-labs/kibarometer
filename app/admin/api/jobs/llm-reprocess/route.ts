export const runtime = "nodejs";

import {
  runReprocess,
  type ReprocessScope,
} from "@/lib/admin/llm-reprocess";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

const VALID_SCOPES = new Set<ReprocessScope>([
  "all_ai",
  "category",
  "since_date",
]);

// POST /admin/api/jobs/llm-reprocess
// Body: { scope: 'all_ai'|'category'|'since_date', category_slug?, since_date?, dry_run? }
// Cron-friendly: bearer-authed; returns 200 with structured result. Manual
// trigger from /admin/nav/categories (PR 7) uses the same shape.
export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "request body must be JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "request body must be an object" },
      { status: 400 },
    );
  }
  const obj = body as Record<string, unknown>;
  const scope = obj.scope;
  if (typeof scope !== "string" || !VALID_SCOPES.has(scope as ReprocessScope)) {
    return Response.json(
      {
        error: `scope must be one of: ${Array.from(VALID_SCOPES).join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await runReprocess({
      sb: sbFetch,
      trigger: "manual",
      scope: scope as ReprocessScope,
      category_slug:
        typeof obj.category_slug === "string" ? obj.category_slug : undefined,
      since_date:
        typeof obj.since_date === "string" ? obj.since_date : undefined,
      dry_run: obj.dry_run === true,
    });
    if (result.status === "error") {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
