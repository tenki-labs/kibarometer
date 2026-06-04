import { describe, it, expect, vi } from "vitest";

import { toggle } from "./keywords.js";

// Regression guard for the "VIBE MAT AS" resurrection bug.
//
// Removing a keyword from the catalogue must be a SOFT-delete (status set to
// 'rejected'), never a hard DELETE. The keyword seeds live in migrations that
// re-run on every deploy with `insert ... on conflict (term_norm, language) do
// nothing`. A hard-deleted row leaves no conflict target, so the next deploy
// re-inserts the term as a fresh `canonical` keyword and it starts matching
// again. A `rejected` tombstone survives `on conflict do nothing`, so the
// removal sticks across deploys. `toggle` ("Deaktiver"/"Aktiver") is the only
// removal/restore affordance in the admin — these tests pin its contract.

// Minimal PostgREST stub: first call is the `select=status` read, the second
// is the PATCH whose body we capture.
function makeSb(currentStatus: string) {
  const calls: Array<{ path: string; opts: Record<string, unknown> }> = [];
  const sb = vi.fn(async (path: string, opts: Record<string, unknown> = {}) => {
    calls.push({ path, opts });
    if (opts.method === "PATCH") {
      return [{ id: "kw1", status: (opts.body as { status: string }).status }];
    }
    return [{ status: currentStatus }];
  });
  return { sb, calls };
}

describe("toggle — keyword removal is a soft-delete tombstone, never a hard delete", () => {
  it("deactivating a canonical keyword sets status='rejected' (survives deploy re-seed)", async () => {
    const { sb, calls } = makeSb("canonical");
    await toggle({ sb, id: "kw1" });
    const patch = calls.find((c) => c.opts.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch!.opts.body).toEqual({ status: "rejected" });
    // Never a DELETE — that is what resurrected "vibe" on every deploy.
    expect(calls.some((c) => c.opts.method === "DELETE")).toBe(false);
  });

  it("deactivating a trial keyword also lands on 'rejected'", async () => {
    const { sb, calls } = makeSb("trial");
    await toggle({ sb, id: "kw1" });
    const patch = calls.find((c) => c.opts.method === "PATCH");
    expect(patch!.opts.body).toEqual({ status: "rejected" });
  });

  it("re-activating a rejected keyword sets status='canonical'", async () => {
    const { sb, calls } = makeSb("rejected");
    await toggle({ sb, id: "kw1" });
    const patch = calls.find((c) => c.opts.method === "PATCH");
    expect(patch!.opts.body).toEqual({ status: "canonical" });
  });
});
