// app/embed/headline/page.tsx — minimal embeddable headline strip.
import { Sparkline } from "@/app/_components/charts";
import { sb, type SnapshotDaily, type SnapshotHeadline } from "@/lib/supabase";

export const metadata = {
  title: "AI-stillinger denne uken — Kibarometeret",
};

export default async function EmbedHeadline() {
  const [headlineRows, daily] = await Promise.all([
    sb<SnapshotHeadline[]>("/snapshot_headline?order=computed_for.desc&limit=1"),
    sb<SnapshotDaily[]>("/snapshot_daily?order=posted_on.desc&limit=30"),
  ]);
  const h = headlineRows[0];
  const sparkValues = [...daily].reverse().map((d) => d.ai_count);

  if (!h) {
    return <main className="embed-wrap"><p>Ingen data ennå.</p></main>;
  }

  return (
    <main className="embed-wrap">
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "end", gap: "1.25rem" }}>
        <div>
          <div className="headline-number">{h.ai_count_7d.toLocaleString("nb-NO")}</div>
          <div className="headline-number-label">AI-stillinger siste 7 dager</div>
        </div>
        <div style={{ justifySelf: "end" }}>
          <Sparkline values={sparkValues} width={220} height={60} />
        </div>
      </div>
    </main>
  );
}
