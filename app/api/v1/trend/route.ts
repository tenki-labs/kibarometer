// app/api/v1/trend/route.ts — monthly AI-vs-total posting trend, floored at
// JOBBMARKED_DATA_CUTOFF so the public JSON matches the /arbeidsmarked chart
// exactly. Derived from snapshot_daily via lib/public-data/jobs — never reads
// the unfloored snapshot_monthly (see that module's header + the CI guard).
import { getJobsTrendMonthly } from "@/lib/public-data/jobs";
import { json } from "../_response";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getJobsTrendMonthly());
}
