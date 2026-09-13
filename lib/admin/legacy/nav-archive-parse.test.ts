import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseArbeidsplassenAd } from "./nav-archive-parse.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), "utf8");

const AD_2024 = fixture("arbeidsplassen-ad-2024-wayback.html");
const AD_2026 = fixture("arbeidsplassen-ad-2026-wayback.html");

describe("parseArbeidsplassenAd — 2024-era page (Wayback capture)", () => {
  const ad = parseArbeidsplassenAd(AD_2024)!;

  it("reads identity and status from the embedded adData blob", () => {
    expect(ad.id).toBe("000213c5-e760-40b4-9701-0a529ee25367");
    expect(ad.status).toBe("INACTIVE");
    expect(ad.title).toBe("Har du lyst på en sommerjobb der du får være ute?");
    expect(ad.source).toBe("Stillingsregistrering");
  });

  it("reads real published/expires timestamps", () => {
    expect(ad.published).toBe("2023-03-16T00:00:00+01:00");
    expect(ad.expires).toBe("2023-04-16T00:00:00+02:00");
  });

  it("reads employer, job title and location", () => {
    expect(ad.jobTitle).toBe("Sommerjobb for ungdom - hjelpegartner");
    expect(ad.employerName).toBe("Bodø Andelslandbruk Sa");
    expect(ad.municipal).toBe("BODØ");
    expect(ad.county).toBeNull();
    expect(ad.applyUrl).toBeNull();
  });

  it("takes the ad body, not the employer blurb, as description", () => {
    expect(ad.description).toContain("ungdommer som hjelpegartnere");
    expect(ad.description).toContain("<p>");
    expect(ad.description).not.toContain("startet i 2013");
  });
});

describe("parseArbeidsplassenAd — 2026-era page (Wayback capture)", () => {
  const ad = parseArbeidsplassenAd(AD_2026)!;

  it("reads identity and status", () => {
    expect(ad.id).toBe("0009f8c4-0122-4d19-ba9b-bfe18a0c90b0");
    expect(ad.status).toBe("INACTIVE");
    expect(ad.title).toBe("Vil du jobbe med salg av anerkjente digitale produkter?");
    expect(ad.source).toBe("FINN");
  });

  it("reads timestamps and nested application url", () => {
    expect(ad.published).toBe("2026-02-18T06:06:37.753Z");
    expect(ad.expires).toBe("2026-03-08T23:00:00.000Z");
    expect(ad.applyUrl).toMatch(/^https:\/\/gyldendal\.teamtailor\.com\//);
  });

  it("reads employer, job title and county", () => {
    expect(ad.jobTitle).toBe("Salgskonsulent");
    expect(ad.employerName).toBe("Gyldendal");
    expect(ad.county).toBe("OSLO");
    expect(ad.municipal).toBe("OSLO");
  });

  it("takes the ad body, not the employer blurb, as description", () => {
    expect(ad.description!.length).toBeGreaterThan(200);
    expect(ad.description).not.toContain("Norges største bokkonsern");
  });
});

describe("parseArbeidsplassenAd — non-ad pages", () => {
  it("returns null for a page without an ad body", () => {
    expect(parseArbeidsplassenAd("<html><body><h1>Arbeidsplassen.no</h1></body></html>")).toBeNull();
    expect(parseArbeidsplassenAd("")).toBeNull();
  });

  it("still returns the description when the metadata blob is missing", () => {
    const html = `<html><body><main><h1>Tittel</h1>
      <div class="arb-rich-text job-posting-text"><p>Vi søker en <b>KI-utvikler</b>.</p></div>
      </main></body></html>`;
    const ad = parseArbeidsplassenAd(html)!;
    expect(ad.description).toBe("<p>Vi søker en <b>KI-utvikler</b>.</p>");
    expect(ad.title).toBe("Tittel");
    expect(ad.id).toBeNull();
    expect(ad.published).toBeNull();
  });

  it("strips the RSC $D prefix from serialised dates (Common Crawl 2024-11+ pages)", () => {
    const blob = JSON.stringify(`0:["$","x",null,{"adData":{"id":"0002237d-8398-4972-a437-993a3c280e85","status":"INACTIVE","title":"Sykepleier","published":"$D2024-10-23T22:00:00.000Z","expires":"$D2024-11-09T23:00:00.000Z"}}]`);
    const html = `<script>self.__next_f.push([1,${blob}])</script><div class="job-posting-text"><p>x</p></div>`;
    const ad = parseArbeidsplassenAd(html)!;
    expect(ad.published).toBe("2024-10-23T22:00:00.000Z");
    expect(ad.expires).toBe("2024-11-09T23:00:00.000Z");
  });

  it("keeps nested markup inside the description block intact", () => {
    const html = `<div class="job-posting-text"><div><p>A</p><div><ul><li>B</li></ul></div></div></div><div class="job-posting-text"><p>employer</p></div>`;
    const ad = parseArbeidsplassenAd(html)!;
    expect(ad.description).toBe("<div><p>A</p><div><ul><li>B</li></ul></div></div>");
  });
});
