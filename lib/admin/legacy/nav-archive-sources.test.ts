import { gzipSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  adPageUrl,
  fetchLiveAdPage,
  listCcCrawls,
  fetchCcIndexPageCount,
  fetchCcIndexPage,
  parseCcIndexLines,
  fetchCcWarcRecord,
  fetchWaybackCdx,
  waybackRawUrl,
  fetchWaybackCapture,
  USER_AGENT,
} from "./nav-archive-sources.js";

type Call = { url: string; headers: Record<string, string> };

function makeFetcher(handler: (url: string, init: any) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: any = {}) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = String(v);
    calls.push({ url, headers });
    return handler(url, init);
  };
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const UUID = "0009f8c4-0122-4d19-ba9b-bfe18a0c90b0";

describe("live page", () => {
  it("builds the public ad url", () => {
    expect(adPageUrl(UUID)).toBe(`https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}`);
  });

  it("returns html on 200 and identifies itself", async () => {
    const { fetcher, calls } = makeFetcher(() => new Response("<html>ad</html>", { status: 200 }));
    const r = await fetchLiveAdPage(UUID, { fetcher });
    expect(r).toEqual({ http_status: 200, html: "<html>ad</html>" });
    expect(calls[0].headers["user-agent"]).toBe(USER_AGENT);
  });

  it("returns null html on 404", async () => {
    const { fetcher } = makeFetcher(() => new Response("gone", { status: 404 }));
    const r = await fetchLiveAdPage(UUID, { fetcher });
    expect(r).toEqual({ http_status: 404, html: null });
  });
});

describe("Common Crawl index", () => {
  it("lists crawls from 2024 onward, oldest first", async () => {
    const body = JSON.stringify([
      { id: "CC-MAIN-2025-08" },
      { id: "CC-MAIN-2023-50" },
      { id: "CC-MAIN-2024-10" },
      { id: "CC-MAIN-2024-51" },
    ]);
    const { fetcher, calls } = makeFetcher(() => new Response(body, { status: 200 }));
    expect(await listCcCrawls({ fetcher })).toEqual(["CC-MAIN-2024-10", "CC-MAIN-2024-51", "CC-MAIN-2025-08"]);
    expect(calls[0].url).toBe("https://index.commoncrawl.org/collinfo.json");
  });

  it("reads the page count for the ad-page prefix", async () => {
    const { fetcher, calls } = makeFetcher(() => new Response('{"pages": 3, "pageSize": 5, "blocks": 12}', { status: 200 }));
    expect(await fetchCcIndexPageCount("CC-MAIN-2025-30", { fetcher })).toBe(3);
    expect(calls[0].url).toContain("/CC-MAIN-2025-30-index?");
    expect(calls[0].url).toContain("showNumPages=true");
    expect(calls[0].url).toContain(encodeURIComponent("arbeidsplassen.nav.no/stillinger/stilling/*"));
  });

  it("parses index lines into (id, captured_at, locator) rows and drops non-200/non-html", () => {
    const lines = [
      JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}`, timestamp: "20250718130112", status: "200", mime: "text/html", filename: "crawl-data/CC-MAIN-2025-30/segments/x/warc/y.warc.gz", offset: "80232288", length: "20400" }),
      JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/11111111-1111-1111-1111-111111111111`, timestamp: "20250718130113", status: "404", mime: "text/html", filename: "f", offset: "1", length: "2" }),
      JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}?x=1`, timestamp: "20250718130114", status: "200", mime: "text/html", filename: "f2", offset: "3", length: "4" }),
      JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/not-a-uuid`, timestamp: "20250718130115", status: "200", mime: "text/html", filename: "f3", offset: "5", length: "6" }),
      "",
      "not json",
    ].join("\n");
    const rows = parseCcIndexLines(lines, "CC-MAIN-2025-30");
    expect(rows).toEqual([
      {
        id: UUID,
        source: "commoncrawl",
        captured_at: "2025-07-18T13:01:12Z",
        locator: { crawl: "CC-MAIN-2025-30", filename: "crawl-data/CC-MAIN-2025-30/segments/x/warc/y.warc.gz", offset: 80232288, length: 20400 },
      },
      {
        id: UUID,
        source: "commoncrawl",
        captured_at: "2025-07-18T13:01:14Z",
        locator: { crawl: "CC-MAIN-2025-30", filename: "f2", offset: 3, length: 4 },
      },
    ]);
  });

  it("fetches one index page with the status filter", async () => {
    const line = JSON.stringify({ url: `https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}`, timestamp: "20250718130112", status: "200", mime: "text/html", filename: "f", offset: "1", length: "2" });
    const { fetcher, calls } = makeFetcher(() => new Response(line, { status: 200 }));
    const rows = await fetchCcIndexPage("CC-MAIN-2025-30", 2, { fetcher });
    expect(rows).toHaveLength(1);
    expect(calls[0].url).toContain("page=2");
    expect(calls[0].url).toContain("filter=status%3A200");
  });
});

function warcRecord(httpHead: string, body: Buffer) {
  const http = Buffer.concat([Buffer.from(httpHead.replace(/\n/g, "\r\n") + "\r\n\r\n", "utf8"), body]);
  const warcHead = `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}\r\nContent-Type: application/http; msgtype=response\r\nContent-Length: ${http.length}\r\n\r\n`;
  return gzipSync(Buffer.concat([Buffer.from(warcHead, "utf8"), http, Buffer.from("\r\n\r\n")]));
}

describe("Common Crawl WARC fetch", () => {
  const locator = { crawl: "CC-MAIN-2025-30", filename: "crawl-data/x.warc.gz", offset: 100, length: 50 };

  it("range-fetches, gunzips and returns the HTTP body", async () => {
    const html = "<html><body>Bodø – ærlig</body></html>";
    const gz = warcRecord("HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8", Buffer.from(html, "utf8"));
    const { fetcher, calls } = makeFetcher(() => new Response(gz, { status: 206 }));
    const r = await fetchCcWarcRecord(locator, { fetcher });
    expect(r).toEqual({ http_status: 200, html });
    expect(calls[0].url).toBe("https://data.commoncrawl.org/crawl-data/x.warc.gz");
    expect(calls[0].headers.range).toBe("bytes=100-149");
  });

  it("decodes a chunked body when the capture kept transfer-encoding", async () => {
    const chunked = Buffer.from("5\r\n<html\r\n1\r\n>\r\n0\r\n\r\n", "utf8");
    const gz = warcRecord("HTTP/1.1 200 OK\nTransfer-Encoding: chunked", chunked);
    const { fetcher } = makeFetcher(() => new Response(gz, { status: 206 }));
    const r = await fetchCcWarcRecord(locator, { fetcher });
    expect(r).toEqual({ http_status: 200, html: "<html>" });
  });

  it("gunzips a body when the capture kept content-encoding", async () => {
    const gz = warcRecord("HTTP/1.1 200 OK\nContent-Encoding: gzip", gzipSync(Buffer.from("<html>zipped</html>")));
    const { fetcher } = makeFetcher(() => new Response(gz, { status: 206 }));
    const r = await fetchCcWarcRecord(locator, { fetcher });
    expect(r).toEqual({ http_status: 200, html: "<html>zipped</html>" });
  });

  it("reports the embedded status and no html when the capture was not 200", async () => {
    const gz = warcRecord("HTTP/1.1 404 Not Found\nContent-Type: text/html", Buffer.from("gone"));
    const { fetcher } = makeFetcher(() => new Response(gz, { status: 206 }));
    expect(await fetchCcWarcRecord(locator, { fetcher })).toEqual({ http_status: 404, html: null });
  });

  it("surfaces a failed range request", async () => {
    const { fetcher } = makeFetcher(() => new Response("nope", { status: 503 }));
    expect(await fetchCcWarcRecord(locator, { fetcher })).toEqual({ http_status: 503, html: null });
  });
});

describe("Wayback", () => {
  it("lists a month of captures from the CDX api", async () => {
    const body = JSON.stringify([
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["no,nav,arbeidsplassen)/stillinger/stilling/" + UUID, "20250623033356", `https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}`, "text/html", "200", "D", "19179"],
      ["no,nav,arbeidsplassen)/stillinger/stilling/junk", "20250623033357", "https://arbeidsplassen.nav.no/stillinger/stilling/junk", "text/html", "200", "D", "1"],
    ]);
    const { fetcher, calls } = makeFetcher(() => new Response(body, { status: 200 }));
    const rows = await fetchWaybackCdx("202506", { fetcher });
    expect(rows).toEqual([
      {
        id: UUID,
        source: "wayback",
        captured_at: "2025-06-23T03:33:56Z",
        locator: { timestamp: "20250623033356", url: `https://arbeidsplassen.nav.no/stillinger/stilling/${UUID}` },
      },
    ]);
    expect(calls[0].url).toContain("from=202506");
    expect(calls[0].url).toContain("to=202506");
    expect(calls[0].url).toContain("output=json");
    expect(calls[0].url).toContain("collapse=urlkey");
  });

  it("returns an empty list for an empty month", async () => {
    const { fetcher } = makeFetcher(() => new Response("", { status: 200 }));
    expect(await fetchWaybackCdx("202401", { fetcher })).toEqual([]);
  });

  it("throws when the CDX api is unavailable so the indexer can retry later", async () => {
    const { fetcher } = makeFetcher(() => new Response("offline", { status: 503 }));
    await expect(fetchWaybackCdx("202401", { fetcher })).rejects.toThrow(/503/);
  });

  it("builds the raw (id_) capture url", () => {
    expect(waybackRawUrl({ timestamp: "20250623033356", url: "https://a.no/x" })).toBe("https://web.archive.org/web/20250623033356id_/https://a.no/x");
  });

  it("fetches a capture and flags rate limiting", async () => {
    const ok = makeFetcher(() => new Response("<html>c</html>", { status: 200 }));
    expect(await fetchWaybackCapture({ timestamp: "1", url: "https://a.no/x" }, { fetcher: ok.fetcher })).toEqual({ http_status: 200, html: "<html>c</html>", rateLimited: false });
    const limited = makeFetcher(() => new Response("slow down", { status: 429 }));
    expect(await fetchWaybackCapture({ timestamp: "1", url: "https://a.no/x" }, { fetcher: limited.fetcher })).toEqual({ http_status: 429, html: null, rateLimited: true });
  });
});
