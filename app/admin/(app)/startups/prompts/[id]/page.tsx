import { Flash } from "@/app/admin/_components/flash";
import {
  PromptRevisionEditor,
  PromptRevisionNotFound,
  type PromptRevisionFull,
} from "@/app/admin/_components/prompt-revision-editor";
import { sbFetch } from "@/lib/admin/sb";
import { createRevisionAction, setActiveAction } from "../actions";

export const dynamic = "force-dynamic";

const ROLES = ["brreg_tier1", "brreg_tier2"] as const;
type Role = (typeof ROLES)[number];

const ROLE_TITLES: Record<Role, string> = {
  brreg_tier1: "Tier 1 — Deteksjon",
  brreg_tier2: "Tier 2 — Kategorisering",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isValidRole(s: string): s is Role {
  return ROLES.includes(s as Role);
}

export default async function BrregPromptRevisionPage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const sp = await searchParams;

  if (!isUuid(id)) {
    return (
      <>
        <Flash searchParams={sp} />
        <PromptRevisionNotFound
          eyebrow="Oppstart"
          basePath="/admin/startups/prompts"
        />
      </>
    );
  }

  const rows = await sbFetch<PromptRevisionFull[]>(
    `/llm_prompts?id=eq.${encodeURIComponent(id)}` +
      `&select=id,role,body,examples,active,created_at,created_by`,
    { service: true },
  ).catch(() => [] as PromptRevisionFull[]);
  const rev = rows[0];

  if (!rev || !isValidRole(rev.role)) {
    return (
      <>
        <Flash searchParams={sp} />
        <PromptRevisionNotFound
          eyebrow="Oppstart"
          basePath="/admin/startups/prompts"
        />
      </>
    );
  }

  const create = createRevisionAction.bind(null, rev.role);
  const setActive = setActiveAction.bind(null, rev.id, rev.role);

  return (
    <>
      <Flash searchParams={sp} />
      <PromptRevisionEditor
        rev={rev}
        title={ROLE_TITLES[rev.role]}
        eyebrow="Oppstart"
        basePath="/admin/startups/prompts"
        createRevision={create}
        setActive={setActive}
        requiresCategoriesBlock={rev.role === "brreg_tier2"}
      />
    </>
  );
}
