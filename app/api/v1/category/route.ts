// app/api/v1/category/route.ts — yrkeskategori breakdown (last 30 days).
import { sb, type SnapshotCategory } from "@/lib/supabase";
import { json } from "../_response";

export const revalidate = 60;

export async function GET() {
  const rows = await sb<SnapshotCategory[]>(
    "/snapshot_category?order=ai_count_30d.desc",
  );
  return json(rows);
}
