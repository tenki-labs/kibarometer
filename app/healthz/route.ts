// Liveness probe for Caddy / docker healthcheck. Always returns 200 if the
// Next.js process is alive — does not check downstream services.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ ok: true });
}
