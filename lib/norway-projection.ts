// lib/norway-projection.ts — Pure projection of Norway's 15 post-2024
// fylker into SVG path strings. No `server-only`, no `fs` — orchestrators
// (lib/norway-paths.ts) read the geojson file and delegate here. Tests
// import this module directly.

import { geoConicConformal, geoPath } from "d3-geo";

import type { Fylke } from "./fylke";

export type FylkeProperties = {
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
export type FylkeFeature = {
  type: "Feature";
  properties: FylkeProperties;
  geometry: FeatureGeometry;
};
export type FylkeFeatureCollection = {
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

export function projectFylker(
  fc: FylkeFeatureCollection,
): readonly NorwayFylkePath[] {
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
