// Liveness probe — replaces /admin/health from the legacy zero-deps admin.
// The Docker healthcheck for kiba-admin used to wget this; the new
// kiba-web container uses /healthz at the project root, but we keep
// /admin/health for compatibility with any monitoring that still pings it.

export const runtime = "nodejs";

export function GET() {
  return Response.json({ ok: true });
}
