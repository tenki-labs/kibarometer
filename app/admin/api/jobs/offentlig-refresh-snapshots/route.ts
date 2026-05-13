// POST /admin/api/jobs/offentlig-refresh-snapshots — bearer-authed cron
// entry. Calls public.refresh_all_offentlig_snapshots() which truncates +
// rebuilds the seven offentlig_snapshot_* tables.
//
// Cron tick: 0 5 * * * (offset 30 min after media's 04:30 refresh and
// 15 min after brreg's 04:45 refresh, so the four snapshot RPCs never
// contend for Postgres locks at once).
//
// Currently the underlying SQL function only populates the storting half
// + headline (doffin sub-functions ship in a later migration once
// doffin_notices exists).

export const runtime = "nodejs";

import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

const JOB_NAME = "offentlig_refresh_snapshots";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  let jobId: string | null = null;
  try {
    const [job] = await sbFetch<{ id: string }[]>(`/jobs`, {
      service: true,
      method: "POST",
      body: { name: JOB_NAME, trigger: "cron" },
      prefer: "return=representation",
    });
    jobId = job.id;

    await sbFetch(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      service: true,
      method: "PATCH",
      body: {
        last_heartbeat: new Date().toISOString(),
        current_step: "calling refresh_all_offentlig_snapshots()",
      },
      prefer: "return=minimal",
    });

    await sbFetch(`/rpc/refresh_all_offentlig_snapshots`, {
      service: true,
      method: "POST",
      body: {},
    });

    // Pull the freshly-written headline row so smoke callers can assert
    // non-null and the admin UI can flash it on the refresh action.
    const headlineRows = await sbFetch<unknown[]>(
      `/offentlig_snapshot_headline?order=computed_for.desc&limit=1`,
      { service: true },
    );
    const headline = headlineRows?.[0] ?? null;

    await sbFetch(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        progress_pct: 100,
        metadata: { headline },
      },
      prefer: "return=minimal",
    });

    return Response.json({ status: "success", job_id: jobId, headline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) {
      try {
        await sbFetch(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
          service: true,
          method: "PATCH",
          body: {
            finished_at: new Date().toISOString(),
            status: "failed",
            error: msg.slice(0, 1000),
          },
          prefer: "return=minimal",
        });
      } catch (e2) {
        console.error(
          "offentlig-refresh-snapshots: failed to mark job failed:",
          e2 instanceof Error ? e2.message : String(e2),
        );
      }
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
