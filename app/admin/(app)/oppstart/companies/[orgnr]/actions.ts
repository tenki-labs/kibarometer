"use server";

import { redirect } from "next/navigation";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";
import { getStaffClaims } from "@/lib/admin/auth";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// GDPR-style hard-delete on operator request. Drops the brreg_companies
// row (and its roles via FK cascade), then writes an audit row to
// `jobs` with the actor + orgnr in metadata so a follow-up can prove
// that the deletion happened and who triggered it.
//
// Use case: a person reaches out asking us to remove their data, OR an
// operator notices a row that shouldn't be in the system. Soft-delete
// would leak through the snapshot tables on next refresh; hard-delete
// is the cleanest privacy posture.
export async function forgetCompanyAction(formData: FormData) {
  const orgnr = String(formData.get("orgnr") || "").trim();
  if (!orgnr) {
    redirect(`/admin/oppstart${flashQs({ error: "Manglende orgnr" })}`);
  }

  const claims = await getStaffClaims();
  const actor = claims?.email || claims?.sub || "unknown";

  try {
    // Audit row first — if delete fails downstream we still have a record
    // that someone requested it. trigger='manual' as a sentinel.
    await sbFetch(`/jobs`, {
      service: true,
      method: "POST",
      body: {
        name: "brreg_company_forgotten",
        trigger: "manual",
        status: "running",
        metadata: { orgnr, actor },
      },
      prefer: "return=minimal",
    });

    // FK cascade on brreg_roles + brreg_url_queue means deleting the
    // brreg_companies row drops their personal data and queue entry too.
    await sbFetch(
      `/brreg_companies?orgnr=eq.${encodeURIComponent(orgnr)}`,
      {
        service: true,
        method: "DELETE",
        prefer: "return=minimal",
      },
    );

    // Mark the audit row terminal.
    await sbFetch(
      `/jobs?name=eq.brreg_company_forgotten&metadata->>orgnr=eq.${encodeURIComponent(orgnr)}&status=eq.running`,
      {
        service: true,
        method: "PATCH",
        body: {
          status: "success",
          finished_at: new Date().toISOString(),
        },
        prefer: "return=minimal",
      },
    );

    redirect(
      `/admin/oppstart${flashQs({
        ok: `Foretak ${orgnr} hard-slettet (inkl. roller og kø).`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/oppstart/companies/${encodeURIComponent(orgnr)}${flashQs({
        error: `Hard-sletting feilet: ${msg(err)}`,
      })}`,
    );
  }
}
