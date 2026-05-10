// app/api/v1/headline/route.ts — single-row headline snapshot.
import { sb, type SnapshotHeadline } from "@/lib/supabase";
import { json } from "../_response";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sb<SnapshotHeadline[]>(
    "/snapshot_headline?order=computed_for.desc&limit=1",
  );
  return json(rows[0] ?? null);
}
