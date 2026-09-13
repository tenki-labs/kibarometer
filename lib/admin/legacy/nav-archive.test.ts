import { gzipSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  archiveEnrichNav,
  archiveIndexNav,
  buildFoundUpdate,
  waybackMonths,
} from "./nav-archive.js";
import { compileMatchers } from "./nav-processor.js";

type SbCall = { path: string; init?: { method?: string; body?: any; prefer?: string } };

function makeSb(handlers: { path: RegExp; method?: string; reply: unknown }[]) {
  const calls: SbCall[] = [];
  const sb = async (path: string, init: any = {}) => {
    calls.push({ path, init });
    const method = init?.method || "GET";
    for (const h of handlers) {
      if (h.path.test(path) && (!h.method || h.method === method)) {
        return typeof h.reply === "function" ? (h.reply as any)(path, init) : h.reply;
      }
    }
    return [];
  };
  return { sb, calls };
}

function makeFetcher(routes: { match: RegExp; reply: (url: string, init: any) => Response }[]) {
  const urls: string[] = [];
  const fetcher = async (url: string, init: any = {}) => {
    urls.push(url);
    for (const r of routes) if (r.match.test(url)) return r.reply(url, init);
    return new Response("unrouted " + url, { status: 599 });
  };
  return { fetcher: fetcher as unknown as typeof fetch, urls };
}

const noSleep = async () => {};
const NOW = new Date("2026-09-13T12:00:00Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const KEYWORDS = [{ term: "KI", match_type: "word" }, { term: "maskinlæring", match_type: "word" }];

function adHtml(id: string | null, body: string, extra: Record<string, unknown> = {}) {
  const blob = id ? JSON.stringify(`0:["$","x",null,{"adData":${JSON.stringify({ id, title: "T " + id.slice(0, 4), status: "INACTIVE", published: "2024-05-02T00:00:00+02:00", expires: "2024-06-01T00:00:00+02:00", jobTitle: "Utvikler", employer: { name: "Firma" }, locationList: [{ county: "OSLO", municipal: "OSLO" }], ...extra })}}]`) : null;
  return `<html><body><h1>Tittel</h1>${blob ? `<script>self.__next_f.push([1,${blob}])</script>` : ""}<div class="job-posting-text">${body}</div><div class="job-posting-text"><p>Om bedriften</p></div></body></html>`;
}

function warc(html: string, status = 200) {
  const http = Buffer.from(`HTTP/1.1 ${status} X\r\nContent-Type: text/html\r\n\r\n${html}`, "utf8");
  const head = `WARC/1.0\r\nWARC-Type: response\r\nContent-Length: ${http.length}\r\n\r\n`;
  return gzipSync(Buffer.concat([Buffer.from(head), http, Buffer.from("\r\n\r\n")]));
}

const jobHandlers = (name: string) => [
  { path: new RegExp(`^/jobs\\?name=eq\\.${name}&status=eq\\.running`), reply: [] },
  { path: /^\/jobs\?status=eq\.running/, reply: [] },
  { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-1" }] },
  { path: /^\/jobs\?id=eq\.job-1/, method: "PATCH", reply: [] },
];

describe("waybackMonths", () => {
  it("runs from 2024-01 through the current month", () => {
    const months = waybackMonths(new Date("2024-03-15T00:00:00Z"));
    expect(months).toEqual([
      ["wayback:2024-01", "202401"],
      ["wayback:2024-02", "202402"],
      ["wayback:2024-03", "202403"],
    ]);
  });
});

describe("buildFoundUpdate", () => {
  it("writes description, provenance, real dates and retags", () => {
    const matchers = compileMatchers(KEYWORDS);
    const ad = {
      id: A, status: "INACTIVE", title: "Ad title", source: "FINN",
      published: "2024-05-02T00:00:00+02:00", expires: "2024-06-01T00:00:00+02:00", updated: null,
      jobTitle: "Utvikler", employerName: "Firma", county: "OSLO", municipal: "OSLO",
      applyUrl: "https://apply.example", description: "<p>Vi søker en som kan KI.</p>",
    };
    const u = buildFoundUpdate({ id: A, title: null }, ad, "commoncrawl", matchers, "2026-09-13T12:00:00.000Z");
    expect(u).toMatchObject({
      description: "<p>Vi søker en som kan KI.</p>",
      description_source: "commoncrawl",
      archive_result: "found:commoncrawl",
      archive_checked_at: "2026-09-13T12:00:00.000Z",
      detail_fetched_at: "2026-09-13T12:00:00.000Z",
      retagged_at: "2026-09-13T12:00:00.000Z",
      title: "Ad title",
      occupation: "Utvikler",
      location_county: "OSLO",
      apply_url: "https://apply.example",
      posted_at: "2024-05-01T22:00:00.000Z",
      expires_at: "2024-05-31T22:00:00.000Z",
      is_ai: true,
      matched_keywords: ["KI"],
    });
  });

  it("keeps the existing title and tolerates missing metadata", () => {
    const u = buildFoundUpdate({ id: A, title: "Kept" }, { description: "<p>x</p>" } as any, "live_page", compileMatchers(KEYWORDS), "t");
    expect(u.title).toBeUndefined();
    expect(u).not.toHaveProperty("posted_at");
    expect(u).not.toHaveProperty("expires_at");
    expect(u.is_ai).toBe(false);
  });
});

describe("archiveIndexNav", () => {
  it("indexes undone crawls page by page, re-pulls the two newest Wayback months, records runs", async () => {
    const upserts: any[] = [];
    const runs: any[] = [];
    const { sb } = makeSb([
      ...jobHandlers("archive_index_nav"),
      { path: /^\/nav_archive_index_runs\?select=source_key/, reply: [{ source_key: "commoncrawl:CC-MAIN-2024-10" }, { source_key: "wayback:2024-01" }, { source_key: "wayback:2024-02" }, { source_key: "wayback:2024-03" }] },
      { path: /^\/nav_archive_index\?on_conflict=id,source,captured_at/, method: "POST", reply: (_p: string, init: any) => { upserts.push(...init.body); return []; } },
      { path: /^\/nav_archive_index_runs\?on_conflict=source_key/, method: "POST", reply: (_p: string, init: any) => { runs.push(...init.body); return []; } },
    ]);
    const idxLine = (uuid: string, ts: string) => JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/${uuid}`, timestamp: ts, status: "200", mime: "text/html", filename: "f.warc.gz", offset: "1", length: "2" });
    const cdx = (rows: string[][]) => JSON.stringify([["timestamp", "original"], ...rows]);
    const { fetcher, urls } = makeFetcher([
      { match: /collinfo\.json$/, reply: () => new Response(JSON.stringify([{ id: "CC-MAIN-2024-10" }, { id: "CC-MAIN-2024-18" }]), { status: 200 }) },
      { match: /CC-MAIN-2024-18-index\?.*showNumPages/, reply: () => new Response('{"pages": 2}', { status: 200 }) },
      { match: /CC-MAIN-2024-18-index\?.*page=0/, reply: () => new Response(idxLine(A, "20240501000000"), { status: 200 }) },
      { match: /CC-MAIN-2024-18-index\?.*page=1/, reply: () => new Response(idxLine(B, "20240502000000") + "\n" + idxLine(A, "20240501000000"), { status: 200 }) },
      { match: /cdx\/search\/cdx\?.*from=202402/, reply: () => new Response(cdx([["20240210000000", `https://arbeidsplassen.nav.no/stillinger/stilling/${C}`]]), { status: 200 }) },
      { match: /cdx\/search\/cdx\?.*from=202403/, reply: () => new Response("", { status: 200 }) },
    ]);

    const r: any = await archiveIndexNav({ sb, fetcher, sleep: noSleep, now: () => new Date("2024-03-20T00:00:00Z") });

    expect(r.status).toBe("success");
    expect(r.cc_crawls_indexed).toBe(1);
    expect(r.cc_rows).toBe(3);
    expect(upserts.filter((u) => u.source === "commoncrawl").map((u) => [u.id, u.captured_at])).toEqual([
      [A, "2024-05-01T00:00:00Z"],
      [B, "2024-05-02T00:00:00Z"],
      [A, "2024-05-01T00:00:00Z"],
    ]);
    expect(upserts.find((u) => u.source === "commoncrawl").locator).toEqual({ crawl: "CC-MAIN-2024-18", filename: "f.warc.gz", offset: 1, length: 2 });
    // 2024-01 is done and old -> skipped; 2024-02 and 2024-03 are the two newest -> re-pulled.
    expect(urls.some((u) => u.includes("from=202401"))).toBe(false);
    expect(r.wayback_months_indexed).toBe(2);
    expect(r.wayback_rows).toBe(1);
    expect(upserts.find((u) => u.source === "wayback")).toMatchObject({ id: C, locator: { timestamp: "20240210000000" } });
    expect(runs.map((x) => x.source_key)).toEqual(["commoncrawl:CC-MAIN-2024-18", "wayback:2024-02", "wayback:2024-03"]);
    expect(runs[0].rows_indexed).toBe(3);
  });

  it("keeps Common Crawl results and records the error when the Wayback CDX is offline", async () => {
    const runs: any[] = [];
    const { sb, calls } = makeSb([
      ...jobHandlers("archive_index_nav"),
      { path: /^\/nav_archive_index_runs\?select=source_key/, reply: [] },
      { path: /^\/nav_archive_index_runs\?on_conflict=source_key/, method: "POST", reply: (_p: string, init: any) => { runs.push(...init.body); return []; } },
    ]);
    const { fetcher } = makeFetcher([
      { match: /collinfo\.json$/, reply: () => new Response(JSON.stringify([{ id: "CC-MAIN-2024-10" }]), { status: 200 }) },
      { match: /showNumPages/, reply: () => new Response('{"pages": 0}', { status: 200 }) },
      { match: /cdx\/search\/cdx/, reply: () => new Response("Temporarily Offline", { status: 503 }) },
    ]);
    const r: any = await archiveIndexNav({ sb, fetcher, sleep: noSleep, now: () => new Date("2024-02-01T00:00:00Z") });
    expect(r.status).toBe("success");
    expect(r.cc_crawls_indexed).toBe(1);
    expect(r.wayback_months_indexed).toBe(0);
    expect(r.wayback_error).toMatch(/503/);
    expect(runs.map((x) => x.source_key)).toEqual(["commoncrawl:CC-MAIN-2024-10"]);
    const finish = calls.find((c) => /^\/jobs\?id=eq\.job-1/.test(c.path) && c.init?.method === "PATCH" && c.init?.body?.status);
    expect(finish?.init?.body.status).toBe("success");
  });

  it("skips when a run is already in flight", async () => {
    const { sb } = makeSb([
      { path: /^\/jobs\?name=eq\.archive_index_nav&status=eq\.running/, reply: [{ id: "other" }] },
      { path: /^\/jobs\?status=eq\.running/, reply: [] },
    ]);
    expect(await archiveIndexNav({ sb, fetcher: makeFetcher([]).fetcher, sleep: noSleep })).toEqual({ status: "skipped", reason: "already_running" });
  });
});

describe("archiveEnrichNav", () => {
  function baseSb(extra: { path: RegExp; method?: string; reply: unknown }[], patches: Record<string, any[]>) {
    return makeSb([
      ...jobHandlers("archive_enrich_nav"),
      { path: /^\/keywords/, reply: KEYWORDS },
      {
        path: /^\/nav_postings\?id=eq\./,
        method: "PATCH",
        reply: (path: string, init: any) => {
          const id = decodeURIComponent(path.slice("/nav_postings?id=eq.".length));
          (patches[id] ||= []).push(init.body);
          return [];
        },
      },
      ...extra,
    ]);
  }

  it("noops when both queues are empty", async () => {
    const { sb, calls } = baseSb([], {});
    const r: any = await archiveEnrichNav({ sb, fetcher: makeFetcher([]).fetcher, sleep: noSleep, now: () => NOW });
    expect(r.status).toBe("noop");
    expect(calls.some((c) => c.path === "/jobs" && c.init?.method === "POST")).toBe(false);
  });

  it("live pass: hit gets description + retag, 404 is marked live_miss, 5xx is left for the next tick", async () => {
    const patches: Record<string, any[]> = {};
    const { sb, calls } = baseSb([
      { path: /^\/nav_postings\?description=is\.null&archive_result=is\.null&posted_at=gte\./, reply: [{ id: A, title: "Data" }, { id: B, title: "Kokk" }, { id: C, title: "X" }] },
    ], patches);
    const { fetcher } = makeFetcher([
      { match: new RegExp(`stilling/${A}$`), reply: () => new Response(adHtml(A, "<p>Erfaring med maskinlæring.</p>"), { status: 200 }) },
      { match: new RegExp(`stilling/${B}$`), reply: () => new Response("", { status: 404 }) },
      { match: new RegExp(`stilling/${C}$`), reply: () => new Response("", { status: 502 }) },
    ]);
    const r: any = await archiveEnrichNav({ sb, fetcher, sleep: noSleep, now: () => NOW });

    expect(r).toMatchObject({ status: "success", live_hits: 1, live_misses: 1, live_failed: 1 });
    expect(patches[A][0]).toMatchObject({
      description: "<p>Erfaring med maskinlæring.</p>",
      description_source: "live_page",
      archive_result: "found:live_page",
      is_ai: true,
      matched_keywords: ["maskinlæring"],
      occupation: "Utvikler",
      posted_at: "2024-05-01T22:00:00.000Z",
    });
    expect(patches[B]).toEqual([{ archive_result: "live_miss", archive_checked_at: NOW.toISOString() }]);
    expect(patches[C]).toBeUndefined();
    const liveQuery = calls.find((c) => c.path.startsWith("/nav_postings?description=is.null"))!.path;
    expect(liveQuery).toContain(encodeURIComponent("2025-10-18T12:00:00.000Z"));
    expect(liveQuery).toContain("limit=120");
  });

  it("archive pass: Common Crawl first, Wayback as fallback, misses marked, wrong-id captures rejected", async () => {
    const patches: Record<string, any[]> = {};
    const cc = (id: string, n: number) => ({ id, title: "T", source: "commoncrawl", captured_at: `2025-0${n}-01T00:00:00Z`, locator: { crawl: "c", filename: `${id}-${n}.warc.gz`, offset: 0, length: 10 } });
    const wb = (id: string) => ({ id, title: "T", source: "wayback", captured_at: "2025-01-01T00:00:00Z", locator: { timestamp: "20250101000000", url: `https://arbeidsplassen.nav.no/stillinger/stilling/${id}` } });
    const { sb } = baseSb([
      { path: /^\/nav_archive_queue\?/, reply: [cc(A, 2), cc(A, 1), cc(B, 1), wb(B), cc(C, 1)] },
    ], patches);
    const { fetcher, urls } = makeFetcher([
      // A: newest CC capture is a 404 page inside the WARC, older one is good.
      { match: new RegExp(`${A}-2\\.warc\\.gz`), reply: () => new Response(warc("<html>gone</html>", 404), { status: 206 }) },
      { match: new RegExp(`${A}-1\\.warc\\.gz`), reply: () => new Response(warc(adHtml(A, "<p>KI i praksis</p>")), { status: 206 }) },
      // B: CC capture carries the wrong ad (redirect capture); Wayback has the right one.
      { match: new RegExp(`${B}-1\\.warc\\.gz`), reply: () => new Response(warc(adHtml(C, "<p>feil annonse</p>")), { status: 206 }) },
      { match: new RegExp(`web\\.archive\\.org/web/20250101000000id_/.*${B}`), reply: () => new Response(adHtml(B, "<p>Vanlig jobb</p>"), { status: 200 }) },
      // C: capture without any ad body.
      { match: new RegExp(`${C}-1\\.warc\\.gz`), reply: () => new Response(warc("<html><body>Arbeidsplassen.no</body></html>"), { status: 206 }) },
    ]);
    const r: any = await archiveEnrichNav({ sb, fetcher, sleep: noSleep, now: () => NOW });

    expect(r).toMatchObject({ status: "success", archive_hits_commoncrawl: 1, archive_hits_wayback: 1, archive_misses: 1, archive_deferred: 0 });
    expect(patches[A][0]).toMatchObject({ description_source: "commoncrawl", is_ai: true, matched_keywords: ["KI"] });
    expect(patches[B][0]).toMatchObject({ description_source: "wayback", description: "<p>Vanlig jobb</p>", is_ai: false });
    expect(patches[C]).toEqual([{ archive_result: "archive_miss", archive_checked_at: NOW.toISOString() }]);
    expect(urls.filter((u) => u.includes("web.archive.org"))).toHaveLength(1);
  });

  it("archive pass: a Wayback 429 stops further Wayback fetches and defers the rows instead of marking them", async () => {
    const patches: Record<string, any[]> = {};
    const wb = (id: string) => ({ id, title: "T", source: "wayback", captured_at: "2025-01-01T00:00:00Z", locator: { timestamp: "20250101000000", url: `https://arbeidsplassen.nav.no/stillinger/stilling/${id}` } });
    const { sb } = baseSb([
      { path: /^\/nav_archive_queue\?/, reply: [wb(A), wb(B)] },
    ], patches);
    const { fetcher, urls } = makeFetcher([
      { match: /web\.archive\.org/, reply: () => new Response("slow down", { status: 429 }) },
    ]);
    const r: any = await archiveEnrichNav({ sb, fetcher, sleep: noSleep, now: () => NOW });
    expect(r).toMatchObject({ archive_deferred: 2, archive_misses: 0, wayback_rate_limited: true });
    expect(urls.filter((u) => u.includes("web.archive.org"))).toHaveLength(1);
    expect(Object.keys(patches)).toEqual([]);
  });

  it("respects the per-tick Wayback budget", async () => {
    const patches: Record<string, any[]> = {};
    const wb = (id: string) => ({ id, title: "T", source: "wayback", captured_at: "2025-01-01T00:00:00Z", locator: { timestamp: "20250101000000", url: `https://arbeidsplassen.nav.no/stillinger/stilling/${id}` } });
    const { sb } = baseSb([
      { path: /^\/nav_archive_queue\?/, reply: [wb(A), wb(B), wb(C)] },
    ], patches);
    const { fetcher, urls } = makeFetcher([
      { match: /web\.archive\.org\/web\/.*stilling\/([0-9a-f-]+)$/, reply: (url) => new Response(adHtml(url.slice(-36), "<p>ok</p>"), { status: 200 }) },
    ]);
    const r: any = await archiveEnrichNav({ sb, fetcher, sleep: noSleep, now: () => NOW, waybackBudget: 2 });
    expect(r).toMatchObject({ archive_hits_wayback: 2, archive_deferred: 1 });
    expect(urls).toHaveLength(2);
    expect(patches[C]).toBeUndefined();
  });

  it("stops at the wall budget and still finishes the job row", async () => {
    const patches: Record<string, any[]> = {};
    const { sb, calls } = baseSb([
      { path: /^\/nav_postings\?description=is\.null&archive_result=is\.null/, reply: [{ id: A, title: "a" }, { id: B, title: "b" }] },
    ], patches);
    let t = 0;
    const { fetcher, urls } = makeFetcher([{ match: /./, reply: () => new Response("", { status: 404 }) }]);
    const r: any = await archiveEnrichNav({ sb, fetcher, sleep: async () => { t += 1000; }, now: () => NOW, maxWallMs: -1 });
    expect(r).toMatchObject({ stopped: "wall" });
    expect(urls).toHaveLength(0);
    expect(calls.find((c) => /^\/jobs\?id=eq\.job-1/.test(c.path) && c.init?.body?.status)?.init?.body.status).toBe("success");
    expect(t).toBe(0);
  });
});
