-- 0006_keywords.sql
-- Keyword inclusion list for tagging NAV postings as AI-related.
-- The methodology page renders this table directly so it can never drift
-- from what's actually applied at ingestion.
--
-- Match types:
--   word       — \b<term>\b regex on lowercased title+occupation+description.
--                Default. Avoids matching inside unrelated tokens.
--   substring  — naive lowercased contains(). Use for multi-word phrases or
--                hyphenated forms where word-boundary semantics get awkward.
--
-- Bare acronyms (AI, KI, ML) are seeded as match_type=word; monitor FP rate
-- in week 1 — if too noisy, narrow them via a future match_scope column.
--
-- Idempotent.

create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  term_norm text generated always as (lower(term)) stored,
  language text not null check (language in ('no', 'en', 'any')),
  category text not null check (category in ('tool', 'role', 'concept')),
  match_type text not null default 'word'
    check (match_type in ('word', 'substring')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_norm, language)
);

create index if not exists keywords_active_category_idx
  on public.keywords (category, term_norm) where is_active;

drop trigger if exists keywords_updated_at on public.keywords;
create trigger keywords_updated_at before update on public.keywords
  for each row execute function public.trigger_set_updated_at();

alter table public.keywords enable row level security;

-- Public read of active keywords so the marketing site (anon role) can
-- render the methodology page directly from the database.
--
-- Wrapped in a DO block so this re-runs cleanly after 0015 has dropped
-- is_active in favour of status. When is_active is gone, 0015's status-based
-- policy is the authoritative one and we leave it alone.
do $public_read$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'keywords'
      and column_name = 'is_active'
  ) then
    drop policy if exists keywords_public_read on public.keywords;
    execute 'create policy keywords_public_read on public.keywords for select using (is_active = true)';
  end if;
end
$public_read$;

-- Staff see soft-deleted entries too.
drop policy if exists keywords_staff_read on public.keywords;
create policy keywords_staff_read on public.keywords
  for select using (public.is_staff());

-- Admin/super can write.
drop policy if exists keywords_admin_write on public.keywords;
create policy keywords_admin_write on public.keywords
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed: initial inclusion list. on conflict do nothing so re-runs are no-ops
-- and admin edits via the UI survive subsequent deploys.
insert into public.keywords (term, language, category, match_type, notes) values
  -- TOOLS (language: any — tool names match across languages)
  ('PyTorch',           'any', 'tool',    'word',      null),
  ('TensorFlow',        'any', 'tool',    'word',      null),
  ('JAX',               'any', 'tool',    'word',      null),
  ('scikit-learn',      'any', 'tool',    'word',      null),
  ('Hugging Face',      'any', 'tool',    'substring', null),
  ('LangChain',         'any', 'tool',    'word',      null),
  ('LlamaIndex',        'any', 'tool',    'word',      null),
  ('OpenAI',            'any', 'tool',    'word',      null),
  ('Claude',            'any', 'tool',    'word',      'Anthropic. Word-boundary to avoid surnames.'),
  ('GPT-4',             'any', 'tool',    'substring', null),
  ('Gemini',            'any', 'tool',    'word',      null),
  ('Mistral',           'any', 'tool',    'word',      null),
  ('Llama',             'any', 'tool',    'word',      null),
  ('Stable Diffusion',  'any', 'tool',    'substring', null),
  ('MLflow',            'any', 'tool',    'word',      null),
  ('Vertex AI',         'any', 'tool',    'substring', null),
  ('Azure ML',          'any', 'tool',    'substring', null),
  ('SageMaker',         'any', 'tool',    'word',      null),
  ('Bedrock',           'any', 'tool',    'word',      'AWS Bedrock.'),
  ('Pinecone',          'any', 'tool',    'word',      null),
  ('Weaviate',          'any', 'tool',    'word',      null),
  ('Chroma',            'any', 'tool',    'word',      null),
  -- ROLES — English
  ('ML Engineer',                'en', 'role',    'word', null),
  ('AI Engineer',                'en', 'role',    'word', null),
  ('Machine Learning Engineer',  'en', 'role',    'word', null),
  ('Data Scientist',             'en', 'role',    'word', null),
  ('MLOps Engineer',             'en', 'role',    'word', null),
  ('AI Researcher',              'en', 'role',    'word', null),
  ('AI Product Manager',         'en', 'role',    'word', null),
  ('Prompt Engineer',            'en', 'role',    'word', null),
  ('Applied Scientist',          'en', 'role',    'word', null),
  -- ROLES — Norwegian
  ('Maskinlæringsingeniør',      'no', 'role',    'word', null),
  ('AI-ingeniør',                'no', 'role',    'word', null),
  ('KI-ingeniør',                'no', 'role',    'word', null),
  ('Dataforsker',                'no', 'role',    'word', null),
  ('AI-forsker',                 'no', 'role',    'word', null),
  ('KI-forsker',                 'no', 'role',    'word', null),
  ('MLOps-ingeniør',             'no', 'role',    'word', null),
  ('AI-arkitekt',                'no', 'role',    'word', null),
  ('KI-arkitekt',                'no', 'role',    'word', null),
  -- CONCEPTS — English
  ('machine learning',            'en', 'concept', 'substring', null),
  ('artificial intelligence',     'en', 'concept', 'substring', null),
  ('deep learning',               'en', 'concept', 'substring', null),
  ('neural network',              'en', 'concept', 'substring', null),
  ('natural language processing', 'en', 'concept', 'substring', null),
  ('NLP',                         'en', 'concept', 'word',      'Risk: also "Neuro-Linguistic Programming". Monitor false positives.'),
  ('computer vision',             'en', 'concept', 'substring', null),
  ('large language model',        'en', 'concept', 'substring', null),
  ('LLM',                         'en', 'concept', 'word',      null),
  ('generative AI',               'en', 'concept', 'substring', null),
  ('transformer',                 'en', 'concept', 'word',      'Risk: power transformers. Review FPs after first week.'),
  ('fine-tuning',                 'en', 'concept', 'substring', null),
  ('foundation model',            'en', 'concept', 'substring', null),
  ('prompt engineering',          'en', 'concept', 'substring', null),
  ('reinforcement learning',      'en', 'concept', 'substring', null),
  ('RAG',                         'en', 'concept', 'word',      'Retrieval-Augmented Generation.'),
  ('AI',                          'en', 'concept', 'word',      'Bare acronym. Word-boundary essential. Monitor FP rate weekly.'),
  ('ML',                          'en', 'concept', 'word',      'Bare acronym for machine learning. Also abbreviates milliliter, mailing list. Monitor.'),
  -- CONCEPTS — Norwegian
  ('KI',                          'no', 'concept', 'word',      'Norsk forkortelse for kunstig intelligens. Word-boundary essential.'),
  ('maskinlæring',                'no', 'concept', 'substring', null),
  ('kunstig intelligens',         'no', 'concept', 'substring', null),
  ('dyp læring',                  'no', 'concept', 'substring', null),
  ('nevralt nettverk',            'no', 'concept', 'substring', null),
  ('språkmodell',                 'no', 'concept', 'substring', null),
  ('store språkmodeller',         'no', 'concept', 'substring', null),
  ('generativ AI',                'no', 'concept', 'substring', null),
  ('generativ KI',                'no', 'concept', 'substring', null),
  ('forsterkende læring',         'no', 'concept', 'substring', null)
on conflict (term_norm, language) do nothing;
