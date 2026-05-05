import { describe, it, expect, beforeEach } from "vitest";
import { politeFetch, _resetRateLimitForTests, DEFAULT_USER_AGENT } from "./media-client.js";
import { _resetCache } from "./media-robots.js";

function makeFetcher(responses: Array<(url: string) => Response | Promise<Response>>) {
  let i = 0;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = async (url: string, init: any = {}) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) headers[k] = String(v);
    }
    calls.push({ url, headers });
    const handler = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return handler(url);
  };
  return { fetcher, calls };
}

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
});

describe("politeFetch — robots.txt enforcement", () => {
  it("blocks URLs disallowed by robots.txt", async () => {
    const { fetcher, calls } = makeFetcher([
      (url) => new Response("User-agent: *\nDisallow: /private/\n", { status: 200 }),
    ]);
    const r = await politeFetch("https://example.no/private/x", { fetcher: fetcher as any });
    expect(r.ok).toBe(false);
    expect(r.disallowed).toBe(true);
    expect(r.error).toBe("robots_disallow");
    expect(calls.map((c) => c.url)).toEqual(["https://example.no/robots.txt"]);
  });

  it("fetches when allowed", async () => {
    const { fetcher, calls } = makeFetcher([
      () => new Response("User-agent: *\nAllow: /\n", { status: 200 }),
      () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    ]);
    const r = await politeFetch("https://example.no/articles/x", { fetcher: fetcher as any });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("can skip robots check when checkRobots=false", async () => {
    const { fetcher, calls } = makeFetcher([
      () => new Response("ok", { status: 200 }),
    ]);
    const r = await politeFetch("https://example.no/x", { fetcher: fetcher as any, checkRobots: false });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.no/x");
  });
});

describe("politeFetch — UA header", () => {
  it("sends the kibarometerbot UA by default", async () => {
    const { fetcher, calls } = makeFetcher([
      () => new Response("", { status: 404 }),
      () => new Response("ok", { status: 200 }),
    ]);
    await politeFetch("https://ua-test.example.no/x", { fetcher: fetcher as any });
    expect(calls[1].headers["User-Agent"]).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).toMatch(/kibarometerbot/);
  });
});

describe("politeFetch — retry on 5xx / network error", () => {
  it("retries once on 503", async () => {
    const { fetcher, calls } = makeFetcher([
      () => new Response("", { status: 404 }),                 // robots
      () => new Response("err", { status: 503 }),             // first attempt
      () => new Response("ok", { status: 200 }),              // retry succeeds
    ]);
    const r = await politeFetch("https://retry-503.example.no/x", { fetcher: fetcher as any });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("does NOT retry on 404", async () => {
    const { fetcher, calls } = makeFetcher([
      () => new Response("", { status: 404 }),                 // robots
      () => new Response("not found", { status: 404 }),        // resource 404
    ]);
    const r = await politeFetch("https://retry-404.example.no/x", { fetcher: fetcher as any });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it("retries once on a thrown network error", async () => {
    let called = 0;
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      called += 1;
      if (called === 1) throw new Error("ECONNRESET");
      return new Response("ok", { status: 200 });
    };
    const r = await politeFetch("https://retry-net.example.no/x", { fetcher: fetcher as any });
    expect(r.ok).toBe(true);
    expect(called).toBe(2);
  });
});

describe("politeFetch — rate limiting", () => {
  it("delays the second request to the same host", async () => {
    const { fetcher } = makeFetcher([
      () => new Response("", { status: 404 }),    // robots
      () => new Response("a", { status: 200 }),
      () => new Response("b", { status: 200 }),
    ]);
    const t0 = Date.now();
    await politeFetch("https://rate.example.no/a", { fetcher: fetcher as any, crawlDelayMs: 150 });
    await politeFetch("https://rate.example.no/b", { fetcher: fetcher as any, crawlDelayMs: 150 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });

  it("does not delay across different hosts", async () => {
    const { fetcher } = makeFetcher([
      () => new Response("", { status: 404 }),    // robots host A
      () => new Response("a", { status: 200 }),
      () => new Response("", { status: 404 }),    // robots host B
      () => new Response("b", { status: 200 }),
    ]);
    const t0 = Date.now();
    await politeFetch("https://hostA.example.no/a", { fetcher: fetcher as any, crawlDelayMs: 200 });
    await politeFetch("https://hostB.example.no/b", { fetcher: fetcher as any, crawlDelayMs: 200 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });
});

describe("politeFetch — invalid input", () => {
  it("returns invalid_url for malformed URLs", async () => {
    const { fetcher } = makeFetcher([]);
    const r = await politeFetch("not a url", { fetcher: fetcher as any });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_url");
  });
});
