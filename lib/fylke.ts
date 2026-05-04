// lib/fylke.ts — Normalize NAV's `location_county` strings to today's 15
// Norwegian fylker (post-2024 reform).
//
// NAV's workLocations[0].county can contain pre-2020 names (e.g. "Hordaland"),
// 2020-reform names (e.g. "Viken", "Vestfold og Telemark"), or today's names
// (post-2024 split). We squash everything to today's 15 so the choropleth has
// a stable surface.

export const FYLKER = [
  "Oslo",
  "Akershus",
  "Østfold",
  "Buskerud",
  "Vestfold",
  "Telemark",
  "Innlandet",
  "Agder",
  "Rogaland",
  "Vestland",
  "Møre og Romsdal",
  "Trøndelag",
  "Nordland",
  "Troms",
  "Finnmark",
] as const;

export type Fylke = (typeof FYLKER)[number];

// Lower-case lookup so we match regardless of NAV's casing.
const NORMALIZE_MAP: Record<string, Fylke> = {
  // Today's names (post-2024)
  "oslo": "Oslo",
  "akershus": "Akershus",
  "østfold": "Østfold",
  "buskerud": "Buskerud",
  "vestfold": "Vestfold",
  "telemark": "Telemark",
  "innlandet": "Innlandet",
  "agder": "Agder",
  "rogaland": "Rogaland",
  "vestland": "Vestland",
  "møre og romsdal": "Møre og Romsdal",
  "trøndelag": "Trøndelag",
  "nordland": "Nordland",
  "troms": "Troms",
  "finnmark": "Finnmark",

  // 2020-reform merges (NAV may still emit these on older postings)
  "viken": "Akershus", // Viken split into Akershus + Buskerud + Østfold; without finer detail we lump under Akershus (largest)
  "vestfold og telemark": "Vestfold",
  "troms og finnmark": "Troms",

  // Pre-2020 separate names that merged into today's fylker
  "hedmark": "Innlandet",
  "oppland": "Innlandet",
  "aust-agder": "Agder",
  "vest-agder": "Agder",
  "hordaland": "Vestland",
  "sogn og fjordane": "Vestland",
  "nord-trøndelag": "Trøndelag",
  "sør-trøndelag": "Trøndelag",
};

export function normalizeFylke(county: string | null | undefined): Fylke | null {
  if (!county) return null;
  return NORMALIZE_MAP[county.trim().toLowerCase()] ?? null;
}
