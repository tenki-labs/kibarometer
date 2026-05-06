-- 0035_more_media_sources.sql
--
-- Expand the seeded media-sources catalogue from 14 outlets (the 0029
-- seed) to 32, covering four outlet categories the admin uses to
-- structure coverage: mainstream daily/weekly press, tech/IT press,
-- business/finance press, and policy/specialist outlets.
--
-- All new rows start is_active=false so the operator activates each
-- after seeding its search_config and observing a dry-run — same
-- pattern as the inactive rows in 0029_media.sql.
--
-- RSS URLs are included where they're publicly documented and stable.
-- Where the publisher's RSS situation is unclear (Aftenposten and
-- several Schibsted regionals only expose section-feeds, not a full
-- firehose; some specialist outlets have no RSS at all) the column is
-- left null and the source will rely on site_search backfill once
-- search_config is configured. The daily discover-cron skips sources
-- with null rss_url, so leaving null doesn't break anything.
--
-- Idempotent. Re-running on a DB that already has these rows is a
-- no-op (`on conflict (domain) do nothing`).

-- ── Mainstream daily/weekly press (8) ───────────────────────────────────────
-- Bigger publications, paywalled or partially paywalled. Higher
-- crawl_delay_ms (2000) for politeness; many use Schibsted infra
-- which is sensitive to bursts.
insert into public.media_sources
  (name, domain, rss_url, backfill_method, crawl_delay_ms, is_active, notes)
values
  ('Aftenposten',          'aftenposten.no',         'https://www.aftenposten.no/rss',                   'site_search', 2000, false, 'Mainstream — Schibsted, paywalled. JSON-LD extraction expected to win on most articles.'),
  ('Bergens Tidende',      'bt.no',                  'https://www.bt.no/rss',                            'site_search', 2000, false, 'Mainstream — regional (Bergen), Schibsted, paywalled.'),
  ('Adresseavisen',        'adressa.no',             null,                                               'site_search', 2000, false, 'Mainstream — regional (Trondheim), paywalled.'),
  ('Stavanger Aftenblad',  'aftenbladet.no',         'https://www.aftenbladet.no/rss',                   'site_search', 2000, false, 'Mainstream — regional (Stavanger), Schibsted, paywalled.'),
  ('Klassekampen',         'klassekampen.no',        null,                                               'site_search', 2000, false, 'Mainstream — left-wing daily, paywalled.'),
  ('Dagsavisen',           'dagsavisen.no',          null,                                               'site_search', 2000, false, 'Mainstream — center-left daily.'),
  ('Vårt Land',            'vl.no',                  null,                                               'site_search', 2000, false, 'Mainstream — Christian daily, partial paywall.'),
  ('Morgenbladet',         'morgenbladet.no',        null,                                               'site_search', 2000, false, 'Mainstream — weekly, intellectual/policy slant, paywalled.')
on conflict (domain) do nothing;

-- ── Tech/IT press (4) ───────────────────────────────────────────────────────
-- Niche publications, mostly open access. Lower crawl_delay (1500)
-- since these are smaller sites that handle modest crawl rates fine.
insert into public.media_sources
  (name, domain, rss_url, backfill_method, crawl_delay_ms, is_active, notes)
values
  ('Computerworld Norge',  'computerworld.no',       null,                                               'site_search', 1500, false, 'Tech/IT — enterprise IT focus, complements Digi.no/Kode24.'),
  ('Inside Telecom',       'inside-telecom.no',      null,                                               'site_search', 1500, false, 'Tech/IT — telco/networking specialist.'),
  ('Medier24',             'medier24.no',            'https://www.medier24.no/rss',                      'site_search', 1500, false, 'Tech/IT — media-industry trade press, AI-policy heavy.'),
  ('Journalisten',         'journalisten.no',        null,                                               'site_search', 1500, false, 'Tech/IT — journalism trade press; AI-in-newsroom coverage.')
on conflict (domain) do nothing;

-- ── Business/finance (2) ────────────────────────────────────────────────────
-- Paywalled financial press. Use 2000ms delay matching DN/Finansavisen.
insert into public.media_sources
  (name, domain, rss_url, backfill_method, crawl_delay_ms, is_active, notes)
values
  ('Kapital',              'kapital.no',             null,                                               'site_search', 2000, false, 'Business — paywalled monthly business mag.'),
  ('Hegnar',               'hegnar.no',              null,                                               'site_search', 2000, false, 'Business — finansavisen.no sister site, market-focused.')
on conflict (domain) do nothing;

-- ── Policy/specialist (4) ───────────────────────────────────────────────────
-- Mix of explainers, fact-checking, climate/energy specialist, and
-- academic press. Open access; lower crawl_delay.
insert into public.media_sources
  (name, domain, rss_url, backfill_method, crawl_delay_ms, is_active, notes)
values
  ('Filter Nyheter',       'filternyheter.no',       null,                                               'site_search', 1500, false, 'Policy — investigative/explainer press, AI-policy coverage.'),
  ('Energi og Klima',      'energiogklima.no',       'https://energiogklima.no/feed/',                   'site_search', 1500, false, 'Policy — climate/energy specialist, AI-in-grid coverage.'),
  ('Faktisk.no',           'faktisk.no',             'https://www.faktisk.no/rss',                       'site_search', 1500, false, 'Policy — fact-checking; AI-disinformation coverage.'),
  ('Universitetsavisa',    'universitetsavisa.no',   null,                                               'site_search', 1500, false, 'Policy — NTNU faculty paper, complements Khrono.')
on conflict (domain) do nothing;
