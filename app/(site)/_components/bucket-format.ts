// Shared bucket-key formatters for the chart components. Buckets are either
// YYYY-MM-DD (daily) or YYYY-MM (monthly) — formatBucket detects the length
// and renders accordingly.

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

export function formatBucket(bucket: string): string {
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

export function formatBucketShort(bucket: string): string {
  if (bucket.length === 7) {
    return NO_DATE_FMT_SHORT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_SHORT_DAY.format(new Date(bucket + "T00:00:00Z"));
}
