// Tests for sb()'s transient-5xx retry policy. Public reads are all GET
// (idempotent), so a Kong 502/503/504 blip or a network reset must be
// retried rather than thrown — otherwise an ISR cache-miss renders an
// empty page until the visitor refreshes. Mirrors lib/admin/sb.test.ts:
// mock fetch with vi.spyOn, stub env so the test stays hermetic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sb } from "./supabase";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://test-site.local";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://test-supabase.local";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
  process.env.SUPABASE_INTERNAL_URL = "http://test-supabase.local";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  Object.assign(process.env, originalEnv);
});

function mkResponse(status: number, body: unknown = ""): Response {
  const text =
    status === 204 || status === 205 || status === 304
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  return new Response(text, { status });
}

describe("sb() retry policy", () => {
  it("retries a 502 Kong blip and eventually returns data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mkResponse(502, "kong: bad gateway"))
      .mockResolvedValueOnce(mkResponse(200, [{ ai_count: 7 }]));

    const rows = await sb<{ ai_count: number }[]>("/snapshot_daily");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([{ ai_count: 7 }]);
  });

  it("retries a network rejection and eventually returns data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(mkResponse(200, []));

    const rows = await sb<unknown[]>("/snapshot_daily");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([]);
  });

  it("does NOT retry a non-transient 4xx and throws immediately", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mkResponse(404, "not found"));

    await expect(sb("/snapshot_missing")).rejects.toThrow(/404/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on a persistent 502", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mkResponse(502, "kong: bad gateway"));

    await expect(sb("/snapshot_daily")).rejects.toThrow(/502/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
