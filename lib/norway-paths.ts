// lib/norway-paths.ts — Server-only entry point for the Norway choropleth.
// Reads the vendored fylker geojson once at module load and delegates the
// projection to lib/norway-projection.ts (pure, testable). `import "server-only"`
// keeps d3-geo and the geojson out of every client bundle.
//
// Geojson source: https://github.com/robhop/fylker-og-kommuner (CC BY 4.0;
// upstream © Kartverket NLOD 2.0).

import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  projectFylker,
  type FylkeFeatureCollection,
} from "./norway-projection";

export {
  NORWAY_VIEWBOX,
  type NorwayFylkePath,
} from "./norway-projection";

const filePath = path.resolve(process.cwd(), "public/geo/fylker-s.geojson");
const fc = JSON.parse(readFileSync(filePath, "utf8")) as FylkeFeatureCollection;

export const NORWAY_FYLKE_PATHS = projectFylker(fc);
