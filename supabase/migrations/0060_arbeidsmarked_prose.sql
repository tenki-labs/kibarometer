-- 0059_arbeidsmarked_prose.sql
-- Rewrite "jobbmarked" → "arbeidsmarked" in user-visible site_content prose so
-- the live /docs/arbeidsmarked page and the /docs index card no longer point
-- visitors at the (now-404) /jobbmarked URL. Idempotent via WHERE: re-running
-- matches nothing once text is replaced, so operator edits to other parts of
-- the prose are preserved.
--
-- The DB slug `docs-jobbmarked` is intentionally NOT renamed — it's an
-- internal identifier still referenced by app/admin/(app)/content/* and by
-- migration 0054. Only `title` and `body_md` change.

update public.site_content
   set title   = replace(title,   'jobbmarked', 'arbeidsmarked'),
       body_md = replace(body_md, 'jobbmarked', 'arbeidsmarked')
 where title like '%jobbmarked%'
    or body_md like '%jobbmarked%';
