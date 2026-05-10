// app/api/v1/trend/route.ts — monthly trend (full retained history).
import { sb, type SnapshotMonthly } from "@/lib/supabase";
import { json } from "../_response";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sb<SnapshotMonthly[]>(
    "/snapshot_monthly?order=posted_month.asc",
  );
  return json(rows);
}
