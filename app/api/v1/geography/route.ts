// app/api/v1/geography/route.ts — county-level breakdown (last 30 days).
import { sb, type SnapshotGeography } from "@/lib/supabase";
import { json } from "../_response";

export const revalidate = 60;

export async function GET() {
  const rows = await sb<SnapshotGeography[]>(
    "/snapshot_geography?order=ai_count_30d.desc",
  );
  return json(rows);
}
