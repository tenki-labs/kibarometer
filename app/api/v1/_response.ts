// app/api/v1/_response.ts — shared JSON response helper for the public API.
// 60s edge cache, permissive CORS so journalists can fetch from anywhere.

export function json<T>(data: T): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
