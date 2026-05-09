// lib/norway-paths.ts — Server-only projection of Norway's 15 post-2024
// fylker into SVG path strings, computed once at module load.
//
// Reads `public/geo/fylker-s.geojson` (vendored from
// https://github.com/robhop/fylker-og-kommuner — CC BY 4.0; upstream
// © Kartverket NLOD 2.0) and projects each feature with d3-geo's
// geoConicConformal (parallels 60°/65°, rotate -15° — standard for Norway).
//
// Exported as a frozen array of plain objects so it can be passed as a
// prop into client components without leaking d3-geo into the client
// bundle. `import "server-only"` enforces that.

import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { geoConicConformal, geoPath } from "d3-geo";

import type { Fylke } from "@/lib/fylke";

type FylkeProperties = {
  fylkesnummer?: string;
  fylkesnavn?: string;
};

type Position = number[];
type LinearRing = Position[];
type PolygonGeometry = { type: "Polygon"; coordinates: LinearRing[] };
type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: LinearRing[][];
};
type FeatureGeometry = PolygonGeometry | MultiPolygonGeometry;
type FylkeFeature = {
  type: "Feature";
  properties: FylkeProperties;
  geometry: FeatureGeometry;
};
type FylkeFeatureCollection = {
  type: "FeatureCollection";
  features: FylkeFeature[];
};

// Match by the stable 2-digit code; the geojson's `fylkesnavn` includes
// Sami variants ("Finnmark - Finnmárku - Finmarkku") that don't match
// our internal Fylke enum verbatim.
const FYLKESNUMMER_TO_FYLKE: Record<string, Fylke> = {
  "03": "Oslo",
  "11": "Rogaland",
  "15": "Møre og Romsdal",
  "18": "Nordland",
  "31": "Østfold",
  "32": "Akershus",
  "33": "Buskerud",
  "34": "Innlandet",
  "39": "Vestfold",
  "40": "Telemark",
  "42": "Agder",
  "46": "Vestland",
  "50": "Trøndelag",
  "55": "Troms",
  "56": "Finnmark",
};

const VIEWBOX_W = 400;
const VIEWBOX_H = 600;
const PADDING = 8;

export type NorwayFylkePath = {
  fylke: Fylke;
  d: string;
  labelX: number;
  labelY: number;
};

export const NORWAY_VIEWBOX = `0 0 ${VIEWBOX_W} ${VIEWBOX_H}`;

// d3-geo uses the pre-RFC-7946 winding convention: exterior rings clockwise,
// holes counter-clockwise. The robhop geojson follows RFC 7946 (the opposite),
// which makes d3-geo treat every fylke as the inverted polygon — paths and
// centroids land at the antipode. Reversing every ring flips both conventions
// at once.
function rewindRings(geometry: FeatureGeometry): void {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) ring.reverse();
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) ring.reverse();
    }
  }
}

function loadPaths(): readonly NorwayFylkePath[] {
  const filePath = path.resolve(process.cwd(), "public/geo/fylker-s.geojson");
  const raw = readFileSync(filePath, "utf8");
  const fc = JSON.parse(raw) as FylkeFeatureCollection;

  for (const feature of fc.features) rewindRings(feature.geometry);

  const projection = geoConicConformal()
    .parallels([60, 65])
    .rotate([-15, 0])
    .fitExtent(
      [
        [PADDING, PADDING],
        [VIEWBOX_W - PADDING, VIEWBOX_H - PADDING],
      ],
      fc,
    );
  const pathFn = geoPath(projection);

  const out: NorwayFylkePath[] = [];
  for (const feature of fc.features) {
    const code = feature.properties?.fylkesnummer;
    const fylke = code ? FYLKESNUMMER_TO_FYLKE[code] : undefined;
    if (!fylke) continue;
    const d = pathFn(feature);
    if (!d) continue;
    const [cx, cy] = pathFn.centroid(feature);
    out.push({
      fylke,
      d,
      labelX: Number.isFinite(cx) ? cx : VIEWBOX_W / 2,
      labelY: Number.isFinite(cy) ? cy : VIEWBOX_H / 2,
    });
  }
  return Object.freeze(out);
}

export const NORWAY_FYLKE_PATHS = loadPaths();
