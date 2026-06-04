import { describe, it, expect } from "vitest";

import { MlxError } from "./mlx-error";
import { isTransientMlxFailure } from "./llm-failure";

describe("isTransientMlxFailure", () => {
  // The regression: these used to bump llm_retry_count, so a single MLX
  // outage poisoned the whole backlog (every row → retry_count >= RETRY_LIMIT
  // → excluded → queue_empty). They must now be classified transient.
  it("classifies an MLX 502 (http) as transient — retry must NOT be bumped", () => {
    expect(isTransientMlxFailure(new MlxError("http", "http 502", 502))).toBe(
      true,
    );
  });

  it("classifies an unreachable tunnel (network) as transient", () => {
    expect(isTransientMlxFailure(new MlxError("unreachable", "network"))).toBe(
      true,
    );
  });

  it("classifies unparseable model output (parse) as permanent — it IS item-specific", () => {
    expect(isTransientMlxFailure(new MlxError("parse", "not JSON"))).toBe(false);
  });

  it("classifies auth as non-transient (the run stops on auth elsewhere)", () => {
    expect(isTransientMlxFailure(new MlxError("auth", "401", 401))).toBe(false);
  });

  it("classifies unknown / non-MlxError errors as permanent", () => {
    expect(isTransientMlxFailure(new Error("boom"))).toBe(false);
    expect(isTransientMlxFailure("boom")).toBe(false);
    expect(isTransientMlxFailure(null)).toBe(false);
    expect(isTransientMlxFailure(undefined)).toBe(false);
  });
});
