-- =============================================================================
-- WINNERS TEAM — starter set of approved service-update sources (RSS/Atom)
-- Paste into Supabase → SQL Editor → + New query → Run. Safe to run again.
-- Each source is linked to a service category; members receive items for the
-- categories of the services in their profile.
-- After running: Settings → Service update sources → "Fetch all now".
-- Any feed that fails shows its error there and can be edited or deactivated.
-- =============================================================================
insert into public.service_update_sources (name, feed_url, homepage_url, category_id)
select v.name, v.feed_url, v.homepage_url, c.id
from (values
  -- Website Development
  ('Smashing Magazine',          'https://www.smashingmagazine.com/feed/',        'https://www.smashingmagazine.com', 'web-development'),
  ('CSS-Tricks',                 'https://css-tricks.com/feed/',                  'https://css-tricks.com',           'web-development'),
  ('WordPress News',             'https://wordpress.org/news/feed/',              'https://wordpress.org/news/',      'web-development'),
  -- Digital Marketing
  ('Search Engine Land',         'https://searchengineland.com/feed',             'https://searchengineland.com',     'digital-marketing'),
  ('Search Engine Journal',      'https://www.searchenginejournal.com/feed/',     'https://www.searchenginejournal.com', 'digital-marketing'),
  ('HubSpot Marketing Blog',     'https://blog.hubspot.com/marketing/rss.xml',    'https://blog.hubspot.com/marketing', 'digital-marketing'),
  ('Social Media Examiner',      'https://www.socialmediaexaminer.com/feed/',     'https://www.socialmediaexaminer.com', 'digital-marketing'),
  -- Academic Publishing
  ('The Scholarly Kitchen',      'https://scholarlykitchen.sspnet.org/feed/',     'https://scholarlykitchen.sspnet.org', 'academic-publishing'),
  ('Retraction Watch',           'https://retractionwatch.com/feed/',             'https://retractionwatch.com',      'academic-publishing'),
  -- Graphic Design & Branding
  ('Creative Bloq',              'https://www.creativebloq.com/feeds/all',        'https://www.creativebloq.com',     'graphic-design'),
  -- Financial Consulting
  ('Nairametrics',               'https://nairametrics.com/feed/',                'https://nairametrics.com',         'financial-consulting'),
  ('CNBC Finance',               'https://www.cnbc.com/id/10000664/device/rss/rss.html', 'https://www.cnbc.com/finance/', 'financial-consulting'),
  -- Business Consulting
  ('Harvard Business Review',    'https://feeds.hbr.org/harvardbusiness',         'https://hbr.org',                  'business-consulting'),
  ('TechCabal',                  'https://techcabal.com/feed/',                   'https://techcabal.com',            'business-consulting'),
  -- Software Development
  ('The GitHub Blog',            'https://github.blog/feed/',                     'https://github.blog',              'software-development'),
  ('Stack Overflow Blog',        'https://stackoverflow.blog/feed/',              'https://stackoverflow.blog',       'software-development'),
  -- Content & Copywriting
  ('Copyblogger',                'https://copyblogger.com/feed/',                 'https://copyblogger.com',          'content-writing'),
  -- Training & Coaching
  ('eLearning Industry',         'https://elearningindustry.com/feed',            'https://elearningindustry.com',    'training-coaching')
) as v(name, feed_url, homepage_url, slug)
join public.service_categories c on c.slug = v.slug
on conflict (feed_url) do nothing;

select c.name as category, count(s.id) as sources
from public.service_categories c left join public.service_update_sources s on s.category_id = c.id and s.active
group by c.name order by c.name;
