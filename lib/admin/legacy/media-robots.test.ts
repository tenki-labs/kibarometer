import { describe, it, expect, beforeEach } from "vitest";
import { parseRobots, isPathAllowed, isAllowed, getRobots, _resetCache, DEFAULT_UA_TOKEN } from "./media-robots.js";

describe("parseRobots", () => {
  it("groups consecutive User-agent lines", () => {
    const r = parseRobots(`
      User-agent: Googlebot
      User-agent: kibarometerbot
      Disallow: /private/
    `);
    expect(r.groups[0].agents).toEqual(["googlebot", "kibarometerbot"]);
    expect(r.groups[0].rules).toEqual([{ type: "disallow", path: "/private/" }]);
  });

  it("opens a new group after a directive when seeing a fresh User-agent", () => {
    const r = parseRobots(`
      User-agent: Googlebot
      Disallow: /a/
      User-agent: *
      Disallow: /b/
    `);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].agents).toEqual(["googlebot"]);
    expect(r.groups[1].agents).toEqual(["*"]);
  });

  it("ignores comments and blank lines", () => {
    const r = parseRobots(`
      # leading comment
      User-agent: *
      Disallow: /tmp/  # trailing comment

      Allow: /tmp/public
    `);
    expect(r.groups[0].rules).toEqual([
      { type: "disallow", path: "/tmp/" },
      { type: "allow", path: "/tmp/public" },
    ]);
  });

  it("captures Crawl-delay as ms", () => {
    const r = parseRobots(`
      User-agent: *
      Crawl-delay: 2.5
    `);
    expect(r.crawlDelayMs).toBe(2500);
  });
});

describe("isPathAllowed", () => {
  it("allows by default when no Disallow matches", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /admin/\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/articles/foo")).toBe(true);
  });

  it("blocks paths matching Disallow", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /admin/\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/admin/users")).toBe(false);
  });

  it("longer Allow overrides shorter Disallow", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /\nAllow: /articles/\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/articles/foo")).toBe(true);
    expect(isPathAllowed(r, "kibarometerbot", "/admin")).toBe(false);
  });

  it("longer Disallow overrides shorter Allow", () => {
    const r = parseRobots(`User-agent: *\nAllow: /\nDisallow: /articles/private/\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/articles/private/x")).toBe(false);
    expect(isPathAllowed(r, "kibarometerbot", "/articles/public/x")).toBe(true);
  });

  it("supports * wildcard and $ anchor", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /*.pdf$\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/files/report.pdf")).toBe(false);
    expect(isPathAllowed(r, "kibarometerbot", "/files/report.pdfx")).toBe(true);
  });

  it("prefers UA-specific group over wildcard", () => {
    const r = parseRobots(`
      User-agent: kibarometerbot
      Disallow:
      User-agent: *
      Disallow: /
    `);
    expect(isPathAllowed(r, "kibarometerbot/1.0", "/anything")).toBe(true);
    expect(isPathAllowed(r, "someotherbot", "/anything")).toBe(false);
  });

  it("treats empty Disallow as 'nothing disallowed'", () => {
    const r = parseRobots(`User-agent: *\nDisallow:\n`);
    expect(isPathAllowed(r, "kibarometerbot", "/anywhere")).toBe(true);
  });
});

describe("isAllowed (URL form)", () => {
  it("checks the path+query against the rules", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /search\n`);
    expect(isAllowed(r, "kibarometerbot", "https://example.no/search?q=ai")).toBe(false);
    expect(isAllowed(r, "kibarometerbot", "https://example.no/articles/foo")).toBe(true);
  });

  it("rejects malformed URLs", () => {
    const r = parseRobots("");
    expect(isAllowed(r, "kibarometerbot", "not a url")).toBe(false);
  });
});

describe("getRobots (cached fetch)", () => {
  beforeEach(() => _resetCache());

  it("treats 404 as allow-all", async () => {
    const fetcher = async () => new Response("Not found", { status: 404 });
    const rules = await getRobots({ host: "example.no", fetcher: fetcher as any, ua: DEFAULT_UA_TOKEN });
    expect(isPathAllowed(rules, DEFAULT_UA_TOKEN, "/anything")).toBe(true);
  });

  it("caches across calls within TTL", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response("User-agent: *\nDisallow: /admin/\n", { status: 200 });
    };
    await getRobots({ host: "cache.example.no", fetcher: fetcher as any });
    await getRobots({ host: "cache.example.no", fetcher: fetcher as any });
    expect(calls).toBe(1);
  });

  it("falls back to allow-all on network error", async () => {
    const fetcher = async () => { throw new Error("DNS fail"); };
    const rules = await getRobots({ host: "broken.example.no", fetcher: fetcher as any });
    expect(isPathAllowed(rules, DEFAULT_UA_TOKEN, "/anything")).toBe(true);
  });
});
