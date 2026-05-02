// app/embed/trend/page.tsx — minimal embeddable trend chart.
import { TrendChart } from "@/app/_components/charts";
import { sb, type SnapshotMonthly } from "@/lib/supabase";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata = {
  title: "Trend i AI-stillinger — Kibarometeret",
};

export default async function EmbedTrend({
  searchParams,
}: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const mode = (Array.isArray(sp.mode) ? sp.mode[0] : sp.mode) === "share" ? "share" : "absolute";
  const monthly = await sb<SnapshotMonthly[]>("/snapshot_monthly?order=posted_month.asc");
  return (
    <main className="embed-wrap">
      <TrendChart monthly={monthly} mode={mode} height={280} />
    </main>
  );
}
