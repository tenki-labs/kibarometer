import { LOW_SAMPLE_THRESHOLD } from "@/app/_components/charts";
import type { SnapshotKeyword } from "@/lib/supabase";

export function KeywordList({ rows }: { rows: SnapshotKeyword[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Ingen nøkkelord-treff i siste 30 dager ennå.
      </div>
    );
  }
  return (
    <table className="kw-table">
      <thead>
        <tr>
          <th>Nøkkelord</th>
          <th>Kategori</th>
          <th className="num">Antall</th>
          <th className="num">YoY</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => {
          const lowSample = k.ai_count_30d < LOW_SAMPLE_THRESHOLD;
          const yoy =
            k.yoy_growth_pct === null
              ? "ny"
              : `${k.yoy_growth_pct > 0 ? "+" : ""}${k.yoy_growth_pct
                  .toFixed(1)
                  .replace(".", ",")} %`;
          return (
            <tr key={k.keyword} className={lowSample ? "low-sample" : undefined}>
              <td>
                <a href={`/metode#kw-${encodeURIComponent(k.keyword)}`}>
                  {k.keyword}
                </a>
              </td>
              <td>{k.category && <span className="kw-cat">{k.category}</span>}</td>
              <td className="num">{k.ai_count_30d.toLocaleString("nb-NO")}</td>
              <td className="num">{yoy}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
