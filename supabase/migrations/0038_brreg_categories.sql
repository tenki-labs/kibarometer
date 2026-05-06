-- 0038_brreg_categories.sql
-- Operator-editable AI-startup taxonomy for brreg Tier 2 categorization.
-- Modeled on media_categories (0029_media.sql); kept separate from
-- nace_categories because NACE is a structural/industry collapse while
-- brreg_categories is a semantic AI-domain taxonomy chosen by the
-- operator and substituted into the brreg_tier2 prompt as
-- {{categories_block}}.
--
-- Idempotent. Seed inserts use on conflict do nothing so operator edits
-- via /admin/startups/categories survive re-runs.

create table if not exists public.brreg_categories (
  slug text primary key,
  label_no text not null,
  label_en text,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

alter table public.brreg_categories enable row level security;

drop policy if exists brreg_categories_public_read on public.brreg_categories;
create policy brreg_categories_public_read on public.brreg_categories
  for select using (is_active = true);

drop policy if exists brreg_categories_staff_read on public.brreg_categories;
create policy brreg_categories_staff_read on public.brreg_categories
  for select using (public.is_staff());

drop policy if exists brreg_categories_admin_write on public.brreg_categories;
create policy brreg_categories_admin_write on public.brreg_categories
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed defaults. Operator can edit / retire these via the UI; on conflict
-- do nothing so a re-run of the migration doesn't clobber edits.
insert into public.brreg_categories (slug, label_no, label_en, description, sort_order) values
  ('developer-tools',  'Utviklerverktøy',     'Developer tools',
   'Selskaper som lager AI-verktøy for utviklere: kodegenerering, IDE-integrasjoner, agent-rammeverk, evals.', 10),
  ('vertical-saas',    'Vertikal SaaS',       'Vertical SaaS',
   'Bransjespesifikk programvare som bruker AI som kjerne-funksjon (helse, jus, finans, utdanning, eiendom, etc.).', 20),
  ('infrastructure',   'Infrastruktur',       'Infrastructure',
   'Modell-serving, vector-databaser, ML-plattformer, GPU-utleie og annen lavnivå AI-infrastruktur.', 30),
  ('research',         'Forskning / R&D',     'Research / R&D',
   'Forskningsbaserte oppstart, spinoffs fra universiteter, foundation-model labs.', 40),
  ('applied-ai',       'Applied AI',          'Applied AI',
   'Anvendt AI for konkrete brukstilfeller utenfor klassisk SaaS — konsulenttjenester, integratorer, system-bygging.', 50),
  ('data-services',    'Data og analyse',     'Data services',
   'Datainnsamling, annotering, syntetisk data, analyse, observability for ML-systemer.', 60)
on conflict (slug) do nothing;
