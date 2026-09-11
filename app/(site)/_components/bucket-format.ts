// Shared bucket-key formatters for the chart components. Bucket keys come
// in three shapes:
//   YYYY-MM-DD  (length 10) — daily, from dateKey(iso, "day")
//   YYYY-Www    (length 8)  — ISO 8601 weekly, from dateKey(iso, "week")
//   YYYY-MM     (length 7)  — monthly, from dateKey(iso, "month") at long
//                              ranges (1y / since-2024 / max), or from
//                              charts reading intrinsically-monthly snapshot
//                              tables (e.g. brreg_snapshot_founder_age_monthly).
// See bucketGrainForRange in app/(site)/_lib/range.ts for the canonical
// Range → grain mapping.

const NO_DATE_FMT_FULL = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const NO_DATE_FMT_MONTH = new Intl.DateTimeFormat("nb-NO", {
  month: "long",
  year: "numeric",
});

const NO_DATE_FMT_SHORT_DAY = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "short",
});

const NO_DATE_FMT_SHORT_MONTH = new Intl.DateTimeFormat("nb-NO", {
  month: "short",
  year: "2-digit",
});

function isWeekKey(bucket: string): boolean {
  return bucket.length === 8 && bucket[4] === "-" && bucket[5] === "W";
}

// Monday (UTC) of an ISO-8601 week — inverse of isoWeekKey in range.ts.
// Jan 4 is always in ISO week 1, so week 1's Monday is the Monday on or
// before Jan 4; add (week-1) whole weeks. Weekly buckets are labelled by
// this date, not the week number (readers want date/month, not "uke 17").
export function isoWeekMondayUTC(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
  return monday;
}

export function formatBucket(bucket: string): string {
  if (isWeekKey(bucket)) {
    const [year, w] = bucket.split("-W");
    const monday = isoWeekMondayUTC(Number(year), Number(w));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    // Date range for the week, e.g. "28. apr – 04. mai 2026" — no week number.
    return `${NO_DATE_FMT_SHORT_DAY.format(monday)} – ${NO_DATE_FMT_FULL.format(sunday)}`;
  }
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

export function formatBucketShort(bucket: string): string {
  if (isWeekKey(bucket)) {
    const [year, w] = bucket.split("-W");
    // The week's Monday, same "28. apr" style as daily ticks.
    return NO_DATE_FMT_SHORT_DAY.format(isoWeekMondayUTC(Number(year), Number(w)));
  }
  if (bucket.length === 7) {
    return NO_DATE_FMT_SHORT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_SHORT_DAY.format(new Date(bucket + "T00:00:00Z"));
}
