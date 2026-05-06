import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import {
  PromptList,
  type PromptRevision,
} from "@/app/admin/_components/prompt-list";
import { sbFetch } from "@/lib/admin/sb";
import { setActiveAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLES = ["brreg_tier1", "brreg_tier2"];

const ROLE_TITLES: Record<string, string> = {
  brreg_tier1: "Tier 1 — Deteksjon",
  brreg_tier2: "Tier 2 — Kategorisering",
};

const ROLE_BLURBS: Record<string, string> = {
  brreg_tier1:
    "Bekrefter at et selskap er AI-relatert basert på aktivitetsteksten og henter ut verbatim AI-fraser. Lest av lib/admin/llm-brreg-tier1.ts på hvert cron-tikk.",
  brreg_tier2:
    "Klassifiserer AI-relevante selskaper inn i brreg_categories-slugs. Må inneholde {{categories_block}} — erstattes ved kjøretid.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrregPromptsListPage({ searchParams }: Props) {
  const sp = await searchParams;

  const rows = await sbFetch<PromptRevision[]>(
    `/llm_prompts?role=in.(${ROLES.join(",")})` +
      "&select=id,role,body,active,created_at,created_by" +
      "&order=role.asc,created_at.desc",
    { service: true },
  ).catch(() => [] as PromptRevision[]);

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Oppstart"
        title="Systemprompt"
        description={
          <>
            Versjonerte system-prompts for brreg-pipelinen. Hver lagring lager
            en ny rad — historikken er uforanderlig. Én aktiv prompt per
            rolle — den blir lest av{" "}
            <code className="font-mono">lib/admin/llm-brreg-tier1.ts</code> og{" "}
            <code className="font-mono">lib/admin/llm-brreg-tier2.ts</code>{" "}
            uten redeploy.
          </>
        }
      />
      <PromptList
        rows={rows}
        roles={ROLES}
        roleTitles={ROLE_TITLES}
        roleBlurbs={ROLE_BLURBS}
        basePath="/admin/startups/prompts"
        setActiveAction={setActiveAction}
        emptyStateMigration="0039"
      />
    </>
  );
}
