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

export function formatBucket(bucket: string): string {
  if (isWeekKey(bucket)) {
    const [year, w] = bucket.split("-W");
    return `Uke ${w} · ${year}`;
  }
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

export function formatBucketShort(bucket: string): string {
  if (isWeekKey(bucket)) {
    const [, w] = bucket.split("-W");
    return `u${w}`;
  }
  if (bucket.length === 7) {
    return NO_DATE_FMT_SHORT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_SHORT_DAY.format(new Date(bucket + "T00:00:00Z"));
}
