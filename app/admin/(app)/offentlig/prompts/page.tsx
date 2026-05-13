import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import {
  PromptList,
  type PromptRevision,
} from "@/app/admin/_components/prompt-list";
import { sbFetch } from "@/lib/admin/sb";
import { setActiveAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLES = ["offentlig_storting_tier1", "offentlig_storting_tier2"];

const ROLE_TITLES: Record<string, string> = {
  offentlig_storting_tier1: "Tier 1 — AI-frase-ekstraksjon",
  offentlig_storting_tier2: "Tier 2 — Kategorisering",
};

const ROLE_BLURBS: Record<string, string> = {
  offentlig_storting_tier1:
    "Henter verbatim AI-relaterte uttrykk fra Stortingets saker. Lest av lib/admin/llm-storting-tier1.ts ved hvert cron-tikk. Forward-only på ingest_mode='live'.",
  offentlig_storting_tier2:
    "Tildeler kategori-slugs fra storting_categories. Må inneholde {{categories_block}} — erstattes ved kjøretid. Gates på is_ai_relevant, ikke på Tier 1-fullføring, så backfill-rader får også kategorier.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OffentligPromptsPage({ searchParams }: Props) {
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
        eyebrow="Offentlig sektor"
        title="Systemprompt"
        description={
          <>
            Versjonerte system-prompts for /offentlig-pipelinen. Hver lagring
            lager en ny rad — historikken er uforanderlig. Én aktiv prompt per
            rolle — leses av{" "}
            <code className="font-mono">lib/admin/llm-storting-tier1.ts</code>{" "}
            og{" "}
            <code className="font-mono">lib/admin/llm-storting-tier2.ts</code>{" "}
            uten redeploy.{" "}
            <em>
              Doffin-rollene (offentlig_doffin_tier1/tier2) lander når DFØ-tilgang
              er sikret.
            </em>
          </>
        }
      />
      <PromptList
        rows={rows}
        roles={ROLES}
        roleTitles={ROLE_TITLES}
        roleBlurbs={ROLE_BLURBS}
        basePath="/admin/offentlig/prompts"
        setActiveAction={setActiveAction}
        emptyStateMigration="0067"
      />
    </>
  );
}
