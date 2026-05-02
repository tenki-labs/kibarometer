// app/api/v1/keywords/route.ts — top keywords (last 30 days, ranked).
import { sb, type SnapshotKeyword } from "@/lib/supabase";
import { json } from "../_response";

export const revalidate = 60;

export async function GET() {
  const rows = await sb<SnapshotKeyword[]>(
    "/snapshot_keywords?order=rank.asc",
  );
  return json(rows);
}
