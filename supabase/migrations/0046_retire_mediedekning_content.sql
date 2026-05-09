-- 0046_retire_mediedekning_content.sql
-- Retires the /mediedekning page. PR #87 merged the page's content into
-- /media (one page per kibarometer) and added a 308 redirect, then deleted
-- app/(site)/mediedekning/page.tsx. This migration removes the matching row
-- from public.site_content so the editable copy stops appearing in
-- /admin/content.
--
-- 0032_site_content_mediedekning.sql still seeds the row on fresh installs,
-- but this migration runs after 0032 in the deploy loop, so the net result
-- is correct.
--
-- Idempotent: the DELETE is a no-op if the row is already gone.

delete from public.site_content where slug = 'mediedekning';
