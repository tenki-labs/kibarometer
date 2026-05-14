// Tests for sbFetch's transient-5xx retry policy. The wrapper itself is
// thin around global fetch + env vars; we mock fetch with vi.spyOn and
// stub env so the test stays hermetic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sbFetch } from "./sb";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_INTERNAL_URL = "http://test-supabase.local";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  Object.assign(process.env, originalEnv);
});

function mkResponse(status: number, body: unknown = ""): Response {
  // Statuses 204/205/304 forbid a body in the WHATWG Response constructor.
  const text =
    status === 204 || status === 205 || status === 304
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  return new Response(text, { status });
}

// vi.fn().mockResolvedValue(x) reuses the same x across calls — but a
// fetch Response can only have its body read once. This factory hands back
// a fresh Response each invocation so a mock that needs to fire repeatedly
// behaves like real fetch().
function freshResponseMock(
  status: number,
  body: unknown = "",
): () => Promise<Response> {
  return () => Promise.resolve(mkResponse(status, body));
}

describe("sbFetch retry policy", () => {
  it("retries idempotent PATCH on 502 and eventually succeeds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mkResponse(502, "kong: bad gateway"))
      .mockResolvedValueOnce(mkResponse(204, ""));

    const r = await sbFetch("/jobs?id=eq.abc", {
      service: true,
      method: "PATCH",
      body: { status: "running" },
      prefer: "return=minimal",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r).toBeNull();
  });

  it("retries idempotent GET through two 503s", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mkResponse(503))
      .mockResolvedValueOnce(mkResponse(503))
      .mockResolvedValueOnce(mkResponse(200, [{ id: 1 }]));

    const r = await sbFetch<{ id: number }[]>("/storting_saker?limit=1", {
      service: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(r).toEqual([{ id: 1 }]);
  });

  it("does NOT retry POST by default (non-idempotent)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(freshResponseMock(502, "kong: bad gateway"));

    await expect(
      sbFetch("/jobs", {
        service: true,
        method: "POST",
        body: { name: "test" },
      }),
    ).rejects.toThrow(/→ 502/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries POST when caller sets retryTransient: true (upsert opt-in)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mkResponse(502, "kong: bad gateway"))
      .mockResolvedValueOnce(mkResponse(201, ""));

    await sbFetch("/storting_saker?on_conflict=sak_id", {
      service: true,
      method: "POST",
      body: [{ sak_id: 1 }],
      prefer: "return=minimal,resolution=merge-duplicates",
      retryTransient: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on non-transient 4xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        freshResponseMock(400, { message: "violates check constraint" }),
      );

    await expect(
      sbFetch("/jobs?id=eq.abc", {
        service: true,
        method: "PATCH",
        body: { status: "weird" },
      }),
    ).rejects.toThrow(/→ 400: violates check constraint/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws same error format after exhausting retries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(freshResponseMock(504, "gateway timeout"));

    await expect(
      sbFetch("/jobs?id=eq.abc", {
        service: true,
        method: "PATCH",
        body: { status: "running" },
      }),
    ).rejects.toThrow(/PostgREST PATCH \/jobs\?id=eq\.abc → 504: gateway timeout/);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("summarizes huge in.() filter paths so status + body survive truncation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      freshResponseMock(504, "gateway timeout"),
    );

    const orgnrs = Array.from({ length: 100 }, (_, i) => 924796000 + i).join(",");
    const path = `/brreg_companies?orgnr=in.(${orgnrs})&select=orgnr,registrert_dato`;

    let captured: Error | null = null;
    try {
      await sbFetch(path, { service: true });
    } catch (err) {
      captured = err as Error;
    }

    expect(captured).toBeInstanceOf(Error);
    const msg = captured!.message;
    // Survives the jobs.error slice(0, 1000) AND the current_step slice(0, 200).
    expect(msg.length).toBeLessThan(400);
    expect(msg).toMatch(/→ 504: gateway timeout$/);
    expect(msg).toContain("PostgREST GET ");
    expect(msg).toContain("…");
  });

  it("retries network-level fetch rejection on idempotent method", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce(mkResponse(200, [{ id: 1 }]));

    const r = await sbFetch<{ id: number }[]>("/storting_saker?limit=1", {
      service: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r).toEqual([{ id: 1 }]);
  });

  it("retryTransient: false disables retry even on idempotent methods", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(freshResponseMock(502, "kong"));

    await expect(
      sbFetch("/jobs", {
        service: true,
        method: "GET",
        retryTransient: false,
      }),
    ).rejects.toThrow(/→ 502/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
