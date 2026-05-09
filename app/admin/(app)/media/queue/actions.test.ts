// First server-action spec in the repo. Tests three branches of
// runDiscoverAction by mocking next/navigation's redirect (which Next
// expects to throw a NEXT_REDIRECT-marked error) and the underlying
// runDiscover orchestrator. Pattern is reusable for future server-action
// specs — see also the @/-alias resolution note in vitest.config.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted before any import of the action so the action's compiled
// module never resolves the real next/navigation. The mocked redirect
// mirrors Next's contract: throws an Error whose `digest` field starts
// with "NEXT_REDIRECT" so the action's local isRedirect() helper can
// recognise + re-throw it.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`redirect:${url}`) as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw err;
  }),
}));

// Sibling actions in the same file import `after` from next/server.
// runDiscoverAction itself doesn't use it, but ESM resolves all named
// imports at module load — stub as a synchronous executor so the import
// graph doesn't crash on next/server's server-only globals.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));

// Substitute runDiscover so each test seeds the return shape.
vi.mock("@/lib/admin/legacy/media-discover.js", () => ({
  runDiscover: vi.fn(),
}));

// Import order matters: redirect/runDiscover are now mocked, so the
// action's module load picks up the mocks.
import { redirect } from "next/navigation";
import { runDiscover } from "@/lib/admin/legacy/media-discover.js";
import { runDiscoverAction } from "./actions";

const redirectSpy = vi.mocked(redirect);
const runDiscoverSpy = vi.mocked(runDiscover);

// Pull the flash text out of the redirect URL. `URLSearchParams` decodes
// `+` to space (which `decodeURIComponent` does NOT), so this is the
// only correct way to read flashQs output back.
function flashText(): { ok: string | null; error: string | null; path: string } {
  const raw = String(redirectSpy.mock.calls[0]?.[0] ?? "");
  const u = new URL(raw, "http://localhost");
  return {
    ok: u.searchParams.get("flash_ok"),
    error: u.searchParams.get("flash_error"),
    path: u.pathname,
  };
}

describe("runDiscoverAction", () => {
  beforeEach(() => {
    redirectSpy.mockClear();
    runDiscoverSpy.mockClear();
  });

  it("flashes sources/enqueued/skipped counts on success", async () => {
    runDiscoverSpy.mockResolvedValue({
      status: "success",
      sources: 2,
      items_seen: 30,
      items_matched: 5,
      enqueued: 3,
    });

    // The action always finishes by calling redirect(), which our mock
    // throws — so awaiting the action itself rejects. That's the
    // signal that the redirect path was reached, not a failure.
    await expect(runDiscoverAction()).rejects.toThrow();

    expect(redirectSpy).toHaveBeenCalledTimes(1);
    const f = flashText();
    expect(f.path).toBe("/admin/media/queue");
    expect(f.ok).toContain("2 kilder sjekket");
    expect(f.ok).toContain("3 URL-er lagt i kø");
    // 30 seen - 5 matched = 25 keyword-filtered
    expect(f.ok).toContain("25 hoppet over (keyword-filter)");
    expect(f.error).toBeNull();
  });

  it("omits the skipped clause when items_seen === items_matched", async () => {
    runDiscoverSpy.mockResolvedValue({
      status: "success",
      sources: 1,
      items_seen: 4,
      items_matched: 4,
      enqueued: 4,
    });

    await expect(runDiscoverAction()).rejects.toThrow();

    const f = flashText();
    expect(f.ok).toContain("1 kilder sjekket");
    expect(f.ok).toContain("4 URL-er lagt i kø");
    expect(f.ok).not.toContain("hoppet over");
  });

  it("flashes the noop reason when runDiscover returns noop", async () => {
    runDiscoverSpy.mockResolvedValue({
      status: "noop",
      reason: "no_active_rss_sources",
    });

    await expect(runDiscoverAction()).rejects.toThrow();

    const f = flashText();
    expect(f.ok).toContain("Discover hoppet over: no_active_rss_sources");
  });

  it("flashes the error message when runDiscover throws", async () => {
    runDiscoverSpy.mockRejectedValue(new Error("RSS fetch failed: 503"));

    await expect(runDiscoverAction()).rejects.toThrow();

    const f = flashText();
    expect(f.ok).toBeNull();
    expect(f.error).toContain("RSS fetch failed: 503");
  });
});
