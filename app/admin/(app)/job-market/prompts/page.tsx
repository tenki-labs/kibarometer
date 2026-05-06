import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import {
  PromptList,
  type PromptRevision,
} from "@/app/admin/_components/prompt-list";
import { sbFetch } from "@/lib/admin/sb";
import { setActiveAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLES = ["tier1", "tier2"];

const ROLE_TITLES: Record<string, string> = {
  tier1: "Tier 1 — Discovery",
  tier2: "Tier 2 — Klassifisering",
};

const ROLE_BLURBS: Record<string, string> = {
  tier1:
    "Verbatim AI-frase-uttrekk fra alle nye stillinger. Lest av lib/admin/llm-discover.ts på hvert cron-tikk.",
  tier2:
    "Klassifiserer AI-positive stillinger inn i taksonomi-kategoriene. Må inneholde {{categories_block}} — erstattes ved kjøretid.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NavPromptsListPage({ searchParams }: Props) {
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
        eyebrow="Jobbmarked"
        title="Systemprompt"
        description={
          <>
            Versjonerte system-prompts for NAV-pipelinen. Hver lagring lager en
            ny rad — historikken er uforanderlig. Én aktiv prompt per rolle —
            den blir lest av{" "}
            <code className="font-mono">lib/admin/llm-discover.ts</code> og{" "}
            <code className="font-mono">lib/admin/llm-classify.ts</code> uten
            redeploy.
          </>
        }
      />
      <PromptList
        rows={rows}
        roles={ROLES}
        roleTitles={ROLE_TITLES}
        roleBlurbs={ROLE_BLURBS}
        basePath="/admin/job-market/prompts"
        setActiveAction={setActiveAction}
        emptyStateMigration="0018"
      />
    </>
  );
}
