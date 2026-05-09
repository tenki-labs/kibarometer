// Run the projection against the actual vendored geojson and assert the
// shape callers depend on. Catches: geojson schema drift (property renames,
// missing features), our local fylkesnummer→Fylke table going stale, and
// winding regressions (paths/centroids landing at the antipode).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FYLKER } from "./fylke";
import {
  NORWAY_VIEWBOX,
  projectFylker,
  type FylkeFeatureCollection,
} from "./norway-projection";

const fc = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "public/geo/fylker-s.geojson"),
    "utf8",
  ),
) as FylkeFeatureCollection;
const paths = projectFylker(fc);

describe("projectFylker", () => {
  it("emits exactly 15 fylker", () => {
    expect(paths.length).toBe(15);
  });

  it("covers every fylke in the FYLKER enum, no extras", () => {
    expect(new Set(paths.map((p) => p.fylke))).toEqual(new Set(FYLKER));
  });

  it("emits a real SVG path for each fylke", () => {
    for (const p of paths) {
      expect(p.d.length).toBeGreaterThan(0);
      expect(p.d.startsWith("M")).toBe(true);
    }
  });

  it("places every centroid inside the viewBox", () => {
    for (const p of paths) {
      expect(p.labelX).toBeGreaterThan(0);
      expect(p.labelX).toBeLessThan(400);
      expect(p.labelY).toBeGreaterThan(0);
      expect(p.labelY).toBeLessThan(600);
    }
  });
});

describe("NORWAY_VIEWBOX", () => {
  it("matches the projected extent", () => {
    expect(NORWAY_VIEWBOX).toBe("0 0 400 600");
  });
});
