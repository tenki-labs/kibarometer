// GET /api/v1/bruk/snapshot — hidden while the /bruk pillar is offline.
// Returns 404 so cite-by-URL consumers get a clean miss instead of a
// half-broken JSON shape. Restore by reverting this file.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 404 });
}
