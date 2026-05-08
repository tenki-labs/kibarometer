"use client";

import type {
  MediaCategory,
  MediaSnapshotCategoryDaily,
} from "@/lib/supabase";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  /** Reference "now" anchored to the latest published_on across rows — keeps
   * the rendered weeks deterministic regardless of exactly when the page
   * is requested. */
  nowMs: number;
};

const WEEKS = 12;

function tempColor(t: number | null): string {
  // -1 → red, 0 → grey, +1 → green. Same OKLCH treatment as the legacy
  // /mediedekning heatmap so the design stays consistent.
  if (t == null) return "oklch(0.92 0 0)";
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped >= 0) {
    const l = 0.92 - 0.18 * clamped;
    const c = 0.16 * clamped;
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 145)`;
  }
  const a = -clamped;
  const l = 0.92 - 0.18 * a;
  const c = 0.16 * a;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 25)`;
}

// Cheap ISO-week (YYYY-Www) — same impl as the legacy /mediedekning page.
function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = Math.round(
    1 +
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function CategoryHeatmap({ rows, categories, nowMs }: Props) {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.temperature == null) continue;
    const wk = isoWeek(r.published_on);
    const key = `${r.category_slug}|${wk}`;
    const cur = buckets.get(key) ?? { sum: 0, n: 0 };
    cur.sum += r.temperature;
    cur.n += 1;
    buckets.set(key, cur);
  }

  const recentWeeks: string[] = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const d = new Date(nowMs - i * 7 * 24 * 60 * 60 * 1000);
    recentWeeks.push(isoWeek(d.toISOString().slice(0, 10)));
  }

  if (categories.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kategori-data ennå.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-mono text-[0.6rem] font-normal uppercase tracking-[0.16em] text-muted-foreground">
              Kategori
            </th>
            {recentWeeks.map((w) => (
              <th
                key={w}
                className="px-1 py-1 text-center font-mono text-[0.6rem] font-normal text-muted-foreground"
              >
                W{w.split("-W")[1]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.slug}>
              <td className="whitespace-nowrap px-2 py-1 text-sm">
                {c.label_no}
              </td>
              {recentWeeks.map((w) => {
                const b = buckets.get(`${c.slug}|${w}`);
                const t = b && b.n > 0 ? b.sum / b.n : null;
                return (
                  <td
                    key={w}
                    className="h-6 w-6 border border-white/40"
                    style={{ background: tempColor(t) }}
                    title={
                      t != null
                        ? `${c.label_no} · ${w} · temp ${t.toFixed(2)}`
                        : `${c.label_no} · ${w} · ingen data`
                    }
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
