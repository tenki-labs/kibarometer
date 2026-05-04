// lib/occupation-descriptions.ts — Short Norwegian descriptions per NAV
// `category` (yrkeskategori level1). Used in the segment-2 hover tooltip.
//
// NAV's level1 categories are stable; descriptions live here as a hardcoded
// const for now. Move to a `site_content`-style table if editing frequency
// picks up. Fallback `descriptionFor` returns null for unknown categories so
// the tooltip can render without a description.

const DESCRIPTIONS: Record<string, string> = {
  "Akademiske yrker":
    "Yrker som typisk krever lengre universitets- eller høgskoleutdanning, fra forskere og advokater til siviløkonomer og psykologer.",
  "Barne- og ungdomsarbeid":
    "Pedagoger, barnehagelærere, miljøarbeidere og andre som jobber direkte med barn og ungdom.",
  "Butikk- og salgsarbeid":
    "Butikkmedarbeidere, selgere, kassapersonale og andre stillinger i detalj- og engroshandel.",
  "Bygg og anlegg":
    "Tømrere, murere, rørleggere, anleggsarbeidere og andre håndverkere innen bygg og anlegg.",
  "Helse, pleie og omsorg":
    "Sykepleiere, leger, helsefagarbeidere, vernepleiere og andre stillinger i helsesektoren.",
  "Industriarbeid":
    "Operatører, mekanikere og fagarbeidere i produksjon, vedlikehold og prosessindustri.",
  "IT og data":
    "Utviklere, dataingeniører, systemarkitekter, IT-rådgivere og andre stillinger i programvare- og IT-bransjen.",
  "Ingeniør- og ikt-fag":
    "Ingeniører på tvers av disipliner – elektro, maskin, bygg, kjemi, samt IKT-spesialister.",
  "Jordbruk, skogbruk og fiske":
    "Bønder, gartnere, skogsarbeidere, fiskere og andre primærnæringsstillinger.",
  "Kontor og administrasjon":
    "Saksbehandlere, sekretærer, regnskapsmedarbeidere og generelle kontorstillinger.",
  "Ledere":
    "Toppledere, mellomledere, avdelingsledere og andre stillinger med personalansvar.",
  "Meglere og konsulenter":
    "Eiendomsmeglere, finansrådgivere, management-konsulenter og rådgivende stillinger.",
  "Reiseliv og mat":
    "Kokker, servitører, hotellansatte, reiselivsguider og andre stillinger i opplevelses- og serveringsbransjen.",
  "Service og renhold":
    "Renholdspersonale, vaktmestere, vaskeri- og servicearbeidere.",
  "Transport og logistikk":
    "Sjåfører, lagermedarbeidere, kapteiner, piloter og andre stillinger i transport- og logistikkbransjen.",
  "Undervisning":
    "Lærere fra grunnskole til universitet, spesialpedagoger og andre i undervisningssektoren.",
  "Forskning":
    "Forskere, stipendiater, postdoktorer og andre forskningsstillinger ved universiteter, institutter og næringsliv.",
  "Andre yrker":
    "Yrker som ikke passer naturlig inn i en av de øvrige kategoriene.",
  "Ukjent yrke":
    "Stillinger der NAVs feed ikke har fått tildelt en yrkeskategori.",
};

export function descriptionFor(category: string): string | null {
  return DESCRIPTIONS[category] ?? null;
}
