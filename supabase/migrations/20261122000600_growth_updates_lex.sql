-- =============================================================================
-- WINNERS TEAM — 0006 Profile services, service updates, personal development,
-- motivational quotes and the LEX knowledge base.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Service categories & profile services (part of the single unified profile)
-- -----------------------------------------------------------------------------
create table public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null check (char_length(name) between 1 and 80),
  keywords   text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profile_services (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null default auth.uid() references public.profiles (id),
  category_id     uuid references public.service_categories (id) on delete set null,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  description     text check (description is null or char_length(description) <= 2000),
  key_benefits    text[] not null default '{}' check (cardinality(key_benefits) <= 10),
  target_audience text check (target_audience is null or char_length(target_audience) <= 500),
  portfolio_url   text check (portfolio_url is null or portfolio_url ~* '^https?://'),
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profile_services_profile_idx on public.profile_services (profile_id, position);
create index profile_services_category_idx on public.profile_services (category_id);

create or replace function private.profile_services_track()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_pid uuid := coalesce(new.profile_id, old.profile_id); v_name text; v_admin uuid; v_change jsonb; v_status public.account_status;
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  v_change := jsonb_build_object('action', lower(tg_op), 'service', coalesce(new.name, old.name),
    'old', case when tg_op <> 'INSERT' then to_jsonb(old) - 'created_at' - 'updated_at' end,
    'new', case when tg_op <> 'DELETE' then to_jsonb(new) - 'created_at' - 'updated_at' end);
  insert into public.profile_change_log (profile_id, changed_by, section, changes) values (v_pid, (select auth.uid()), 'services', v_change);
  perform private.audit('profile.service_' || lower(tg_op), 'profile_service', coalesce(new.id, old.id)::text, v_pid,
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  select full_name, status into v_name, v_status from public.profiles where id = v_pid;
  if v_status = 'approved' then
    v_admin := private.current_admin_of(v_pid);
    if v_admin is not null and v_admin is distinct from (select auth.uid()) then
      perform private.notify(v_admin, 'profile', 'profile.modified', v_name || ' updated their services',
        initcap(lower(tg_op)) || 'd service: ' || coalesce(new.name, old.name), '/team/' || v_pid);
    end if;
    if (select role from public.profiles where id = v_pid) <> 'super_admin' then
      perform private.notify_super_admins('profile', 'profile.modified', v_name || ' updated their services',
        initcap(lower(tg_op)) || 'd service: ' || coalesce(new.name, old.name), '/team/' || v_pid);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger profile_services_track before insert or update or delete on public.profile_services
  for each row execute function private.profile_services_track();

-- -----------------------------------------------------------------------------
-- Professional service updates
-- -----------------------------------------------------------------------------
create table public.service_update_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 120),
  feed_url        text not null unique check (feed_url ~* '^https://'),
  homepage_url    text check (homepage_url is null or homepage_url ~* '^https?://'),
  category_id     uuid not null references public.service_categories (id),
  source_type     text not null default 'rss' check (source_type in ('rss', 'atom')),
  active          boolean not null default true,
  last_fetched_at timestamptz,
  last_status     text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

create table public.service_updates (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references public.service_update_sources (id),
  category_id        uuid not null references public.service_categories (id),
  title              text not null,
  url                text not null unique check (url ~* '^https?://'),
  published_at       timestamptz,
  excerpt            text,
  ai_summary         text,
  relevance_note     text,
  recommended_action text,
  summary_model      text,
  fetched_at         timestamptz not null default now()
);
create index service_updates_category_idx on public.service_updates (category_id, published_at desc nulls last);

create table public.user_service_updates (
  user_id      uuid not null references public.profiles (id),
  update_id    uuid not null references public.service_updates (id) on delete cascade,
  reason       text,
  delivered_at timestamptz not null default now(),
  read_at      timestamptz,
  saved_at     timestamptz,
  primary key (user_id, update_id)
);
create index user_service_updates_user_idx on public.user_service_updates (user_id, delivered_at desc);

-- Match stored updates to users whose profile services fall in that category.
create or replace function private.match_service_updates(p_since timestamptz default now() - interval '2 days')
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; r record;
begin
  for r in
    insert into public.user_service_updates (user_id, update_id, reason)
    select distinct on (ps.profile_id, u.id) ps.profile_id, u.id,
           'Matches your "' || ps.name || '" service (' || c.name || ')'
      from public.service_updates u
      join public.service_categories c on c.id = u.category_id
      join public.profile_services ps on ps.category_id = u.category_id
      join public.profiles p on p.id = ps.profile_id and p.status = 'approved'
     where u.fetched_at >= p_since
    on conflict do nothing
    returning user_id, update_id
  loop
    v_count := v_count + 1;
  end loop;
  -- One digest notification per user per day.
  insert into public.notifications (user_id, category, type, title, body, link, dedupe_key, email_status, push_status)
  select x.user_id, 'service_updates', 'service_updates.digest', 'New professional service updates',
         x.n || ' new update(s) relevant to your services.', '/service-updates',
         'service-digest:' || private.org_today(), 'skipped', 'skipped'
    from (select user_id, count(*) n from public.user_service_updates where delivered_at > now() - interval '10 minutes' group by user_id) x
  on conflict (user_id, dedupe_key) do nothing;
  return v_count;
end $$;
revoke execute on function private.match_service_updates(timestamptz) from public, authenticated;

create or replace function public.cron_match_service_updates()
returns int language sql security definer set search_path = '' as $$ select private.match_service_updates(); $$;
revoke execute on function public.cron_match_service_updates() from public, anon, authenticated;
grant execute on function public.cron_match_service_updates() to service_role;

-- Members mark read / save via column-limited updates.
create or replace function public.mark_service_update(p_update uuid, p_read boolean default null, p_saved boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_active_user(), 'Not authorised');
  update public.user_service_updates
     set read_at = case when p_read is null then read_at when p_read then coalesce(read_at, now()) else null end,
         saved_at = case when p_saved is null then saved_at when p_saved then coalesce(saved_at, now()) else null end
   where user_id = (select auth.uid()) and update_id = p_update;
end $$;

-- Audit source management
create or replace function private.service_sources_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit('service_updates.source_deleted', 'service_update_source', old.id::text, null, to_jsonb(old), null);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.last_fetched_at is distinct from old.last_fetched_at
     and (to_jsonb(new) - 'last_fetched_at' - 'last_status') = (to_jsonb(old) - 'last_fetched_at' - 'last_status') then
    return new; -- fetch bookkeeping only
  end if;
  perform private.audit('service_updates.source_' || case when tg_op = 'INSERT' then 'created' else 'updated' end,
    'service_update_source', new.id::text, null, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger service_update_sources_audit before insert or update or delete on public.service_update_sources
  for each row execute function private.service_sources_audit();

-- -----------------------------------------------------------------------------
-- Personal development & books
-- -----------------------------------------------------------------------------
create table public.learning_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null
);

create table public.books (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (char_length(title) between 1 and 200),
  author            text not null check (char_length(author) between 1 and 200),
  category          text not null references public.learning_categories (slug),
  improvement_area  text not null check (char_length(improvement_area) between 1 and 120),
  description       text check (description is null or char_length(description) <= 2000),
  cover_url         text check (cover_url is null or cover_url ~* '^https://'),
  reading_url       text check (reading_url is null or reading_url ~* '^https://'),
  free_download_url text check (free_download_url is null or free_download_url ~* '^https://'),
  license           text not null check (license in ('public_domain', 'open_access', 'commercial')),
  active            boolean not null default true,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  -- Copyright guard: a free download link is only allowed for legally free works.
  constraint books_free_download_license check (free_download_url is null or license in ('public_domain', 'open_access'))
);
create index books_category_idx on public.books (category) where active;

create table public.book_recommendations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  book_id      uuid not null references public.books (id),
  weakness     text not null,
  reason       text not null,
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz,
  constraint book_recommendations_unique unique (user_id, book_id)
);
create index book_recommendations_user_idx on public.book_recommendations (user_id, created_at desc);

create table public.reading_progress (
  user_id      uuid not null default auth.uid() references public.profiles (id),
  book_id      uuid not null references public.books (id),
  status       text not null default 'want_to_read' check (status in ('want_to_read', 'reading', 'completed')),
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  started_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table public.reading_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id),
  book_id    uuid not null references public.books (id),
  note       text not null check (char_length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index reading_notes_user_book_idx on public.reading_notes (user_id, book_id, created_at desc);

create or replace function private.reading_progress_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'reading' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'completed' then new.progress_pct := 100; new.completed_at := coalesce(new.completed_at, now());
  else new.completed_at := null; end if;
  return new;
end $$;
create trigger reading_progress_touch before insert or update on public.reading_progress
  for each row execute function private.reading_progress_touch();

-- Weakness identification from HISTORICAL patterns (not a single miss):
-- uses the last 28 days of recorded daily snapshots and last 8 weekly / 3
-- monthly snapshots. A weakness requires ≥ 3 qualifying periods averaging < 70%.
create or replace function private.identify_weaknesses(p_user uuid)
returns table (weakness text, category text, avg_score numeric, periods bigint, explanation text)
language sql stable security definer set search_path = '' as $$
  with scores as (
    select s.period_type, c.category, c.capped_pct
      from public.performance_snapshots s
      join public.performance_category_scores c on c.snapshot_id = s.id and c.applicable
     where s.user_id = p_user and s.is_current
       and ((s.period_type = 'daily' and s.period_start >= private.org_today() - 28)
         or (s.period_type = 'weekly' and s.period_start >= private.org_today() - 56)
         or (s.period_type = 'monthly' and s.period_start >= private.org_today() - 93))),
  agg as (
    select category, period_type, avg(capped_pct) a, count(*) n from scores group by category, period_type)
  select * from (
    select 'Time management & execution', 'time-management', round(a, 1), n,
           'Daily to-do lists averaged ' || round(a) || '% across ' || n || ' recorded days.'
      from agg where category = 'daily_todo' and period_type = 'daily' and n >= 3 and a < 70
    union all
    select 'Sales, communication & lead generation', 'sales', round(a, 1), n,
           'Prospecting targets averaged ' || round(a) || '% across ' || n || ' recorded ' || period_type || ' periods.'
      from agg where category = 'prospecting' and period_type in ('daily') and n >= 3 and a < 70
    union all
    select 'Discipline & prioritisation', 'discipline', round(a, 1), n,
           'Weekly goals averaged ' || round(a) || '% across ' || n || ' recorded weeks.'
      from agg where category = 'weekly_goals' and period_type = 'weekly' and n >= 2 and a < 70
    union all
    select 'Strategic planning & goal setting', 'strategic-planning', round(a, 1), n,
           'Monthly goals averaged ' || round(a) || '% across ' || n || ' recorded months.'
      from agg where category = 'monthly_goals' and period_type = 'monthly' and n >= 1 and a < 70
    union all
    select 'Productivity & follow-through', 'productivity', round(a, 1), n,
           'Additional tasks averaged ' || round(a) || '% across ' || n || ' recorded days.'
      from agg where category = 'additional_tasks' and period_type = 'daily' and n >= 3 and a < 70
  ) w;
$$;
revoke execute on function private.identify_weaknesses(uuid) from public, authenticated;

create or replace function public.my_weaknesses(p_user uuid default null)
returns table (weakness text, category text, avg_score numeric, periods bigint, explanation text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := coalesce(p_user, (select auth.uid()));
begin
  perform private.require(private.can_view_user(v_user), 'Not authorised');
  return query select * from private.identify_weaknesses(v_user);
end $$;

-- Related learning categories per weakness category.
create or replace function private.related_learning(p_cat text)
returns text[] language sql immutable as $$
  select case p_cat
    when 'time-management'    then array['time-management', 'productivity']
    when 'sales'              then array['sales', 'communication', 'business-development', 'marketing']
    when 'discipline'         then array['discipline', 'personal-development']
    when 'strategic-planning' then array['strategic-planning', 'leadership', 'entrepreneurship']
    when 'productivity'       then array['productivity', 'time-management']
    else array[p_cat] end;
$$;

create or replace function private.generate_recommendations(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare w record; v_count int := 0; v_n int;
begin
  for w in select * from private.identify_weaknesses(p_user) loop
    with picked as (
      select b.id from public.books b
       where b.active and b.category = any (private.related_learning(w.category))
         and not exists (select 1 from public.book_recommendations r where r.user_id = p_user and r.book_id = b.id)
         and not exists (select 1 from public.reading_progress rp where rp.user_id = p_user and rp.book_id = b.id and rp.status = 'completed')
       order by (b.license <> 'commercial') desc, array_position(private.related_learning(w.category), b.category), b.title
       limit 2)
    insert into public.book_recommendations (user_id, book_id, weakness, reason)
    select p_user, id, w.weakness, w.explanation from picked
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  if v_count > 0 then
    perform private.notify(p_user, 'performance', 'books.recommended', 'New reading recommendations',
      v_count || ' book(s) recommended based on your recent performance patterns.', '/books', '{}',
      'books:' || private.org_today());
  end if;
  return v_count;
end $$;
revoke execute on function private.generate_recommendations(uuid) from public, authenticated;

create or replace function public.refresh_my_recommendations()
returns int language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_active_user(), 'Not authorised');
  return private.generate_recommendations((select auth.uid()));
end $$;

-- -----------------------------------------------------------------------------
-- Motivational quotes
-- -----------------------------------------------------------------------------
create table public.motivational_quotes (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (char_length(btrim(text)) between 5 and 500),
  author     text not null check (char_length(btrim(author)) between 1 and 120),
  source     text check (source is null or char_length(source) <= 200),
  category   text not null check (category in ('discipline', 'consistency', 'success', 'business', 'leadership', 'excellence', 'personal_growth', 'productivity')),
  active     boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index motivational_quotes_text_key on public.motivational_quotes (lower(text));

create table public.quote_display_history (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles (id),
  quote_id  uuid not null references public.motivational_quotes (id) on delete cascade,
  shown_at  timestamptz not null default now()
);
create index quote_display_history_user_idx on public.quote_display_history (user_id, shown_at desc);

-- Pick the login quote, avoiding the user's last N quotes.
create or replace function public.next_login_quote()
returns table (id uuid, text text, author text, source text, category text)
language plpgsql security definer set search_path = '' as $$
declare v_window int; v_q public.motivational_quotes;
begin
  perform private.require((select auth.uid()) is not null, 'Not signed in');
  select coalesce((value #>> '{}')::int, 10) into v_window from public.system_settings where key = 'quotes.no_repeat_window';
  select q.* into v_q from public.motivational_quotes q
   where q.active and q.id not in (
     select h.quote_id from public.quote_display_history h where h.user_id = (select auth.uid())
      order by h.shown_at desc limit coalesce(v_window, 10))
   order by private.secure_random_int(1000000) limit 1;
  if not found then
    select q.* into v_q from public.motivational_quotes q where q.active order by private.secure_random_int(1000000) limit 1;
  end if;
  if v_q.id is null then return; end if;
  insert into public.quote_display_history (user_id, quote_id) values ((select auth.uid()), v_q.id);
  return query select v_q.id, v_q.text, v_q.author, v_q.source, v_q.category;
end $$;

-- Today's quote without recording a display (dashboards).
create or replace function public.latest_quote()
returns table (id uuid, text text, author text, source text, category text)
language sql stable security definer set search_path = '' as $$
  select q.id, q.text, q.author, q.source, q.category
    from public.quote_display_history h join public.motivational_quotes q on q.id = h.quote_id
   where h.user_id = (select auth.uid()) order by h.shown_at desc limit 1;
$$;

create or replace function private.quotes_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit('quotes.deleted', 'motivational_quote', old.id::text, null, to_jsonb(old), null); return old;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  perform private.audit('quotes.' || case when tg_op = 'INSERT' then 'created' else 'updated' end, 'motivational_quote',
    new.id::text, null, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger motivational_quotes_audit before insert or update or delete on public.motivational_quotes
  for each row execute function private.quotes_audit();

create or replace function private.books_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit('books.deleted', 'book', old.id::text, null, to_jsonb(old), null); return old;
  end if;
  perform private.audit('books.' || case when tg_op = 'INSERT' then 'created' else 'updated' end, 'book',
    new.id::text, null, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger books_audit before insert or update or delete on public.books
  for each row execute function private.books_audit();

-- -----------------------------------------------------------------------------
-- LEX knowledge base & conversations
-- -----------------------------------------------------------------------------
create table public.knowledge_base_documents (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title      text not null check (char_length(title) between 1 and 200),
  content    text not null check (char_length(content) between 1 and 20000),
  audience   public.app_role[] not null default '{team_member,administrator,super_admin}',
  link       text,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  search     tsvector generated always as (to_tsvector('english', title || ' ' || content)) stored
);
create index knowledge_base_search_idx on public.knowledge_base_documents using gin (search);

create table public.lex_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id),
  title      text not null default 'New conversation' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lex_conversations_user_idx on public.lex_conversations (user_id, updated_at desc);

create table public.lex_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lex_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) between 1 and 12000),
  sources         jsonb not null default '[]',
  mode            text check (mode in ('ai', 'knowledge_base')),
  created_at      timestamptz not null default now()
);
create index lex_messages_conversation_idx on public.lex_messages (conversation_id, created_at);

-- Role-filtered knowledge-base search used by LEX (runs as the caller).
create or replace function public.search_knowledge_base(p_query text, p_limit int default 4)
returns table (slug text, title text, content text, link text, rank real)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role := private.current_role();
begin
  perform private.require(v_role is not null, 'Not authorised');
  return query
    select d.slug, d.title, d.content, d.link,
           ts_rank(d.search, websearch_to_tsquery('english', p_query)) +
           ts_rank(d.search, to_tsquery('english', coalesce(nullif(regexp_replace(
             (select string_agg(w, ' | ') from regexp_split_to_table(lower(regexp_replace(p_query, '[^a-zA-Z0-9 ]', ' ', 'g')), '\s+') w
               where char_length(w) > 3), '^\s*$', ''), ''), 'x'))) as rank
      from public.knowledge_base_documents d
     where d.active and v_role = any (d.audience)
     order by rank desc, d.title
     limit least(greatest(p_limit, 1), 8);
end $$;

create or replace function private.kb_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit('lex.kb_deleted', 'knowledge_base_document', old.id::text, null, jsonb_build_object('slug', old.slug), null); return old;
  end if;
  new.updated_at := now(); new.updated_by := (select auth.uid());
  perform private.audit('lex.kb_' || case when tg_op = 'INSERT' then 'created' else 'updated' end, 'knowledge_base_document',
    new.id::text, null, null, jsonb_build_object('slug', new.slug, 'title', new.title));
  return new;
end $$;
create trigger knowledge_base_touch before insert or update or delete on public.knowledge_base_documents
  for each row execute function private.kb_touch();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.service_categories enable row level security;
alter table public.profile_services enable row level security;
alter table public.service_update_sources enable row level security;
alter table public.service_updates enable row level security;
alter table public.user_service_updates enable row level security;
alter table public.learning_categories enable row level security;
alter table public.books enable row level security;
alter table public.book_recommendations enable row level security;
alter table public.reading_progress enable row level security;
alter table public.reading_notes enable row level security;
alter table public.motivational_quotes enable row level security;
alter table public.quote_display_history enable row level security;
alter table public.knowledge_base_documents enable row level security;
alter table public.lex_conversations enable row level security;
alter table public.lex_messages enable row level security;

-- Reference data: read by active users (and pending users for categories used
-- on the registration/pending screens), managed by the Super Admin.
create policy service_categories_read on public.service_categories for select to authenticated using (true);
create policy service_categories_write on public.service_categories for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
create policy learning_categories_read on public.learning_categories for select to authenticated using (private.is_active_user());
create policy learning_categories_write on public.learning_categories for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
create policy books_read on public.books for select to authenticated using (private.is_active_user() and (active or private.is_super_admin()));
create policy books_write on public.books for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());
create policy quotes_read on public.motivational_quotes for select to authenticated using ((select auth.uid()) is not null);
create policy quotes_write on public.motivational_quotes for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin());
create policy service_sources_read on public.service_update_sources for select to authenticated using (private.is_staff());
create policy service_sources_write on public.service_update_sources for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
create policy kb_read on public.knowledge_base_documents for select to authenticated
  using (private.is_super_admin() or (active and private.current_role() = any (audience)));
create policy kb_write on public.knowledge_base_documents for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- Profile services: part of the profile → same visibility as the profile.
create policy profile_services_read on public.profile_services for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_super_admin() or private.is_assigned_admin_of(profile_id));
create policy profile_services_write on public.profile_services for all to authenticated
  using (profile_id = (select auth.uid()) and private.is_active_user())
  with check (profile_id = (select auth.uid()) and private.is_active_user());

-- Service updates: a user sees updates delivered to them; staff see all items.
create policy service_updates_read on public.service_updates for select to authenticated
  using (private.is_staff() or exists (select 1 from public.user_service_updates x where x.update_id = service_updates.id and x.user_id = (select auth.uid())));
create policy user_service_updates_read on public.user_service_updates for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());

-- Personal development
create policy book_recommendations_read on public.book_recommendations for select to authenticated using (private.can_view_user(user_id));
create policy book_recommendations_dismiss on public.book_recommendations for update to authenticated
  using (private.is_owner_active(user_id)) with check (private.is_owner_active(user_id));
revoke update on public.book_recommendations from authenticated;
grant update (dismissed_at) on public.book_recommendations to authenticated;
create policy reading_progress_read on public.reading_progress for select to authenticated using (private.can_view_user(user_id));
create policy reading_progress_write on public.reading_progress for all to authenticated
  using (private.is_owner_active(user_id)) with check (private.is_owner_active(user_id));
create policy reading_notes_read on public.reading_notes for select to authenticated using (user_id = (select auth.uid()));
create policy reading_notes_write on public.reading_notes for all to authenticated
  using (private.is_owner_active(user_id)) with check (private.is_owner_active(user_id));

create policy quote_history_read on public.quote_display_history for select to authenticated using (user_id = (select auth.uid()));

-- LEX conversations are private to their owner.
create policy lex_conversations_own on public.lex_conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.is_active_user());
create policy lex_messages_own on public.lex_messages for select to authenticated
  using (exists (select 1 from public.lex_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
create policy lex_messages_insert on public.lex_messages for insert to authenticated
  with check (exists (select 1 from public.lex_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
