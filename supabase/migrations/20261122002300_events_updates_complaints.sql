-- =============================================================================
-- WINNERS TEAM — 0023 Events, the updates box and complaints
--  * Events: the Super Admin posts an event; everyone gets a notice (optionally by
--    e-mail), a reminder every day at 08:00 until the day, and one an hour before.
--    People answer "I'll attend" / "Can't attend".
--  * Updates box: members and administrators suggest a service or platform update;
--    the Super Admin edits and publishes it to everyone (credited to the sender).
--  * Complaints: members and administrators lodge a complaint that ONLY the Super
--    Admin can read. Anonymous complaints are stored without any link to the sender;
--    they follow up with a private reference code.
-- =============================================================================

alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'reminders', 'deadlines', 'performance', 'accountability', 'registration', 'assignment', 'profile',
  'service_updates', 'announcements', 'system', 'feedback', 'events'));

-- Shared files for events and updates (any signed-in active user may view).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('posts', 'posts', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('complaint-files', 'complaint-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy posts_read on storage.objects for select to authenticated
  using (bucket_id = 'posts' and private.is_active_user());
create policy posts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and private.storage_owner(name) = (select auth.uid()) and private.is_active_user());
create policy complaint_files_read on storage.objects for select to authenticated
  using (bucket_id = 'complaint-files' and private.is_super_admin());
-- (complaint files are uploaded by the app server only, so they carry no uploader.)

-- -----------------------------------------------------------------------------
-- Events
-- -----------------------------------------------------------------------------
create table public.events (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles (id),
  title            text not null check (char_length(btrim(title)) between 2 and 160),
  description      text check (description is null or char_length(description) <= 4000),
  location         text check (location is null or char_length(location) <= 300),
  starts_at        timestamptz not null,
  audience         text not null default 'everyone' check (audience in ('everyone', 'admins')),
  image_path       text,
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  last_reminder_on date,
  hour_reminded    boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index events_starts_idx on public.events (starts_at);

create table public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  response   text not null check (response in ('going', 'not_going')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function private.event_audience(p_audience text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles
   where status = 'approved' and (p_audience = 'everyone' or role in ('administrator', 'super_admin'));
$$;

create or replace function private.can_see_event(e public.events)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and (e.audience = 'everyone' or private.is_staff());
$$;

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
create policy events_read on public.events for select to authenticated using (private.can_see_event(events));
create policy event_rsvps_read on public.event_rsvps for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_super_admin()));
revoke all on public.events, public.event_rsvps from anon, authenticated;
grant select on public.events, public.event_rsvps to authenticated;
grant all on public.events, public.event_rsvps to service_role;

create or replace function private.event_when(p_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select to_char(p_at at time zone private.org_tz(), 'Dy FMDD Mon, FMHH12:MI AM');
$$;

create or replace function private.notify_event(e public.events, p_type text, p_title text, p_body text, p_dedupe text, p_email boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from private.event_audience(e.audience) as id where id <> e.created_by or p_type = 'event.reminder' loop
    perform private.notify(r.id, 'events', p_type, p_title, p_body, '/events?id=' || e.id,
      jsonb_build_object('event_id', e.id, 'email', p_email), p_dedupe || ':' || e.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- p_starts_at is a local date-time in the organisation's time zone.
create or replace function public.save_event(p_id uuid, p_title text, p_description text, p_location text, p_starts_at timestamp,
                                             p_audience text default 'everyone', p_image_path text default null, p_email boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz; e public.events; v_id uuid; v_old public.events; v_changes text[] := '{}';
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can post events');
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 2 and 160, 'Give the event a title');
  perform private.require(p_starts_at is not null, 'Choose the date and time');
  perform private.require(p_audience in ('everyone', 'admins'), 'Choose who should get it');
  perform private.require(p_description is null or char_length(p_description) <= 4000, 'The description is too long');
  v_at := p_starts_at at time zone private.org_tz();
  perform private.require(v_at > now(), 'Choose a date and time in the future');
  if p_id is null then
    insert into public.events (created_by, title, description, location, starts_at, audience, image_path)
    values ((select auth.uid()), btrim(p_title), nullif(btrim(p_description), ''), nullif(btrim(p_location), ''), v_at, p_audience, p_image_path)
    returning * into e;
    perform private.notify_event(e, 'event.new', 'New event: ' || e.title, private.event_when(e.starts_at) || coalesce(' · ' || e.location, '') ||
      coalesce(E'\n' || left(e.description, 300), ''), 'event-new', p_email);
    perform private.audit('event.created', 'event', e.id::text, null, null, jsonb_build_object('title', e.title, 'starts_at', e.starts_at, 'audience', e.audience));
    return e.id;
  end if;
  select * into v_old from public.events where id = p_id for update;
  perform private.require(found and v_old.status = 'scheduled', 'Event not found');
  update public.events set title = btrim(p_title), description = nullif(btrim(p_description), ''), location = nullif(btrim(p_location), ''),
         starts_at = v_at, audience = p_audience, image_path = coalesce(p_image_path, image_path), updated_at = now(),
         hour_reminded = case when v_at <> v_old.starts_at then false else hour_reminded end
   where id = p_id returning * into e;
  if v_at <> v_old.starts_at then v_changes := v_changes || ('now ' || private.event_when(v_at)); end if;
  if coalesce(e.location, '') <> coalesce(v_old.location, '') then v_changes := v_changes || ('place: ' || coalesce(e.location, 'to be confirmed')); end if;
  if cardinality(v_changes) > 0 then
    perform private.notify_event(e, 'event.changed', 'Changed: ' || e.title, initcap(array_to_string(v_changes, ' · ')),
      'event-changed:' || extract(epoch from now())::bigint);
  end if;
  perform private.audit('event.updated', 'event', e.id::text, null, to_jsonb(v_old), to_jsonb(e));
  return e.id;
end $$;

create or replace function public.cancel_event(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can cancel events');
  update public.events set status = 'cancelled', updated_at = now() where id = p_id and status = 'scheduled' returning * into e;
  perform private.require(e.id is not null, 'Event not found');
  if e.starts_at > now() then
    perform private.notify_event(e, 'event.cancelled', 'Cancelled: ' || e.title,
      'This event (' || private.event_when(e.starts_at) || ') has been cancelled.' || coalesce(' ' || nullif(btrim(p_reason), ''), ''), 'event-cancelled');
  end if;
  perform private.audit('event.cancelled', 'event', e.id::text, null, null, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.rsvp_event(p_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_id;
  perform private.require(found and private.can_see_event(e) and e.status = 'scheduled', 'Event not found');
  perform private.require(e.starts_at > now(), 'This event has already started');
  perform private.require(p_response in ('going', 'not_going'), 'Choose going or not going');
  insert into public.event_rsvps (event_id, user_id, response) values (p_id, (select auth.uid()), p_response)
  on conflict (event_id, user_id) do update set response = excluded.response, updated_at = now();
end $$;

-- Daily reminder at 08:00 (organisation time) until the event, and one an hour before.
create or replace function private.run_event_reminders(p_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz(); v_now timestamp := coalesce(p_at, now()) at time zone v_tz; v_today date := v_now::date;
  e public.events; v_days int;
begin
  if v_now::time >= '08:00' then
    for e in select * from public.events where status = 'scheduled' and starts_at > now()
               and (starts_at at time zone v_tz)::date >= v_today
               and (last_reminder_on is null or last_reminder_on < v_today) for update skip locked loop
      v_days := (e.starts_at at time zone v_tz)::date - v_today;
      -- skip the reminder on the day the event was posted (they just got the notice)
      if not ((e.created_at at time zone v_tz)::date = v_today and v_days > 0) then
        perform private.notify_event(e, 'event.reminder',
          case when v_days = 0 then 'Today: ' || e.title || ' at ' || to_char(e.starts_at at time zone v_tz, 'FMHH12:MI AM')
               when v_days = 1 then 'Tomorrow: ' || e.title
               else 'Reminder: ' || e.title || ' in ' || v_days || ' days' end,
          private.event_when(e.starts_at) || coalesce(' · ' || e.location, ''), 'event-day:' || v_today);
      end if;
      update public.events set last_reminder_on = v_today where id = e.id;
    end loop;
  end if;
  for e in select * from public.events where status = 'scheduled' and not hour_reminded
             and starts_at > now() and starts_at <= now() + interval '60 minutes' for update skip locked loop
    perform private.notify_event(e, 'event.reminder', 'Starting soon: ' || e.title,
      'Starts at ' || to_char(e.starts_at at time zone v_tz, 'FMHH12:MI AM') || coalesce(' · ' || e.location, ''), 'event-hour');
    update public.events set hour_reminded = true where id = e.id;
  end loop;
end $$;
revoke execute on function private.run_event_reminders(timestamptz) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Updates box
-- -----------------------------------------------------------------------------
create table public.update_posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references public.profiles (id),
  kind            text not null check (kind in ('service', 'platform')),
  title           text not null check (char_length(btrim(title)) between 2 and 160),
  body            text not null check (char_length(btrim(body)) between 3 and 4000),
  link            text check (link is null or (char_length(link) <= 500 and link ~* '^https?://')),
  attachment_path text,
  status          text not null default 'pending' check (status in ('pending', 'published', 'declined')),
  review_note     text check (review_note is null or char_length(review_note) <= 500),
  audience        text check (audience is null or audience in ('everyone', 'admins')),
  reviewed_by     uuid references public.profiles (id),
  reviewed_at     timestamptz,
  published_at    timestamptz,
  recipients      int,
  created_at      timestamptz not null default now()
);
create index update_posts_status_idx on public.update_posts (status, created_at desc);
alter table public.update_posts enable row level security;
create policy update_posts_read on public.update_posts for select to authenticated using (
  author_id = (select auth.uid()) or (select private.is_super_admin())
  or (status = 'published' and private.is_active_user() and (audience = 'everyone' or private.is_staff())));
revoke all on public.update_posts from anon, authenticated;
grant select on public.update_posts to authenticated;
grant all on public.update_posts to service_role;

create or replace function public.submit_update(p_kind text, p_title text, p_body text, p_link text default null, p_attachment_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  perform private.require(private.is_active_user() and not private.is_super_admin(), 'Not authorised');
  perform private.require(p_kind in ('service', 'platform'), 'Choose the type of update');
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 2 and 160, 'Give it a short title');
  perform private.require(char_length(btrim(coalesce(p_body, ''))) between 3 and 4000, 'Describe the update');
  perform private.require(nullif(btrim(p_link), '') is null or btrim(p_link) ~* '^https?://', 'The link must start with http:// or https://');
  perform private.require(p_attachment_path is null or p_attachment_path like (select auth.uid())::text || '/%', 'Invalid attachment');
  perform private.require((select count(*) from public.update_posts where author_id = (select auth.uid()) and created_at > now() - interval '1 day') < 10,
    'You have shared a lot of updates today. Please try again tomorrow.');
  insert into public.update_posts (author_id, kind, title, body, link, attachment_path)
  values ((select auth.uid()), p_kind, btrim(p_title), btrim(p_body), nullif(btrim(p_link), ''), p_attachment_path) returning id into v_id;
  select full_name into v_name from public.profiles where id = (select auth.uid());
  perform private.notify_super_admins('feedback', 'update.submitted', 'New update to review from ' || v_name,
    btrim(p_title), '/updates?tab=inbox', jsonb_build_object('update_id', v_id), 'update-submitted:' || v_id);
  return v_id;
end $$;

create or replace function public.review_update(p_id uuid, p_publish boolean, p_title text default null, p_body text default null,
                                                p_audience text default 'everyone', p_email boolean default true, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare u public.update_posts; r record; n int := 0; v_name text;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can publish updates');
  select * into u from public.update_posts where id = p_id for update;
  perform private.require(found and u.status = 'pending', 'This update has already been reviewed');
  select full_name into v_name from public.profiles where id = u.author_id;
  if not p_publish then
    update public.update_posts set status = 'declined', review_note = nullif(btrim(p_note), ''), reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_id;
    perform private.notify(u.author_id, 'announcements', 'update.declined', 'Your update "' || left(u.title, 80) || '" was not published',
      coalesce(nullif(btrim(p_note), ''), 'Thank you for sharing it.'), '/updates', jsonb_build_object('update_id', p_id), 'update-declined:' || p_id);
    return 0;
  end if;
  perform private.require(p_audience in ('everyone', 'admins'), 'Choose who should get it');
  perform private.require(p_title is null or char_length(btrim(p_title)) between 2 and 160, 'The title must be 2–160 characters');
  perform private.require(p_body is null or char_length(btrim(p_body)) between 3 and 4000, 'The text must be 3–4000 characters');
  update public.update_posts set status = 'published', title = coalesce(nullif(btrim(p_title), ''), title), body = coalesce(nullif(btrim(p_body), ''), body),
         audience = p_audience, review_note = nullif(btrim(p_note), ''), reviewed_by = (select auth.uid()), reviewed_at = now(), published_at = now()
   where id = p_id returning * into u;
  for r in select id from private.event_audience(p_audience) as id where id <> (select auth.uid()) loop
    perform private.notify(r.id, 'announcements', 'update.published',
      case u.kind when 'service' then 'Service update: ' else 'Platform update: ' end || u.title,
      left(u.body, 400) || E'\nShared by ' || v_name, '/updates?id=' || u.id,
      jsonb_build_object('update_id', u.id, 'email', p_email), 'update-published:' || u.id);
    n := n + 1;
  end loop;
  update public.update_posts set recipients = n where id = p_id;
  perform private.audit('update.published', 'update_post', p_id::text, u.author_id, null, jsonb_build_object('title', u.title, 'recipients', n, 'email', p_email));
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Complaints (Super Admin only)
-- -----------------------------------------------------------------------------
create table public.complaints (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null,              -- rounded to the hour for anonymous complaints
  user_id        uuid references public.profiles (id),  -- null when anonymous
  anonymous      boolean not null,
  category       text not null check (category in ('unfair_treatment', 'manipulation', 'harassment', 'payment', 'other')),
  body           text not null check (char_length(btrim(body)) between 10 and 6000),
  attachment_path text,
  code_hash      text not null unique,
  status         text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  private_notes  text check (private_notes is null or char_length(private_notes) <= 6000),
  reply          text check (reply is null or char_length(reply) <= 4000),
  replied_at     timestamptz,
  updated_at     timestamptz not null default now(),
  constraint complaints_anonymous check (not anonymous or user_id is null)
);
create index complaints_created_idx on public.complaints (created_at desc);
alter table public.complaints enable row level security;
create policy complaints_super_read on public.complaints for select to authenticated using ((select private.is_super_admin()));
revoke all on public.complaints from anon, authenticated;
grant select on public.complaints to authenticated;
grant all on public.complaints to service_role;

-- Daily limit per person without linking a person to a complaint (only a hashed counter).
create table private.complaint_limits (key text primary key, n int not null default 0);

create or replace function private.complaint_code_hash(p_code text)
returns text language sql immutable as $$
  select encode(extensions.digest('wt-complaint:' || upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

create or replace function public.submit_complaint(p_category text, p_body text, p_anonymous boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; v_id uuid; v_key text; v_n int; v_name text;
begin
  perform private.require(private.is_active_user() and not private.is_super_admin(), 'Not authorised');
  perform private.require(p_category in ('unfair_treatment', 'manipulation', 'harassment', 'payment', 'other'), 'Choose a category');
  perform private.require(char_length(btrim(coalesce(p_body, ''))) between 10 and 6000, 'Please describe the complaint (at least 10 characters)');
  v_key := encode(extensions.digest((select auth.uid())::text || ':' || private.org_today()::text || ':wt-limit', 'sha256'), 'hex');
  insert into private.complaint_limits (key, n) values (v_key, 1) on conflict (key) do update set n = complaint_limits.n + 1 returning n into v_n;
  perform private.require(v_n <= 5, 'You have lodged several complaints today. Please try again tomorrow.');
  v_code := 'WT-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4)) || '-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4));
  insert into public.complaints (created_at, user_id, anonymous, category, body, code_hash)
  values (case when p_anonymous then date_trunc('hour', now()) else now() end,
          case when p_anonymous then null else (select auth.uid()) end, p_anonymous, p_category, btrim(p_body), private.complaint_code_hash(v_code))
  returning id into v_id;
  if not p_anonymous then select full_name into v_name from public.profiles where id = (select auth.uid()); end if;
  perform private.notify_super_admins('feedback', 'complaint.new', 'New complaint' || case when p_anonymous then ' (anonymous)' else ' from ' || v_name end,
    'Open Complaints to read it.', '/super-admin/complaints', jsonb_build_object('complaint_id', v_id), 'complaint:' || v_id);
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- What a sender may see: status and the Super Admin's reply (never the private notes).
create or replace function public.complaint_status(p_code text)
returns table (category text, status text, reply text, replied_at timestamptz, lodged date)
language sql stable security definer set search_path = '' as $$
  select c.category, c.status, c.reply, c.replied_at, c.created_at::date from public.complaints c
   where c.code_hash = private.complaint_code_hash(p_code) and private.is_active_user();
$$;
create or replace function public.my_complaints()
returns table (id uuid, category text, status text, reply text, replied_at timestamptz, created_at timestamptz, body text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.category, c.status, c.reply, c.replied_at, c.created_at, c.body from public.complaints c
   where c.user_id = (select auth.uid()) order by c.created_at desc;
$$;

create or replace function public.manage_complaint(p_id uuid, p_status text, p_notes text default null, p_reply text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.complaints; v_new_reply boolean;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can manage complaints');
  perform private.require(p_status in ('new', 'reviewing', 'resolved'), 'Invalid status');
  select * into c from public.complaints where id = p_id for update;
  perform private.require(found, 'Complaint not found');
  v_new_reply := nullif(btrim(p_reply), '') is not null and nullif(btrim(p_reply), '') is distinct from c.reply;
  update public.complaints set status = p_status, private_notes = nullif(btrim(p_notes), ''),
         reply = coalesce(nullif(btrim(p_reply), ''), reply), replied_at = case when v_new_reply then now() else replied_at end, updated_at = now()
   where id = p_id;
  if c.user_id is not null and (v_new_reply or p_status <> c.status) then
    perform private.notify(c.user_id, 'feedback', 'complaint.updated', 'Update on your complaint',
      case when v_new_reply then 'The Super Admin replied. Open Complaints to read it.' else 'Status: ' || replace(p_status, 'reviewing', 'under review') end,
      '/complaints', jsonb_build_object('complaint_id', p_id), 'complaint-upd:' || p_id || ':' || extract(epoch from now())::bigint);
  end if;
end $$;

-- -----------------------------------------------------------------------------
create or replace function private.notify(
  p_user uuid, p_category text, p_type text, p_title text, p_body text default null,
  p_link text default null, p_data jsonb default '{}', p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pref public.notification_preferences;
  v_ch jsonb;
  v_in_app boolean := true; v_email boolean := true; v_push boolean := true;
  v_id uuid;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from public.profiles where id = p_user and status in ('approved', 'pending', 'rejected')) then
    return null;
  end if;
  select * into v_pref from public.notification_preferences where user_id = p_user;
  if found then
    v_ch := v_pref.channels -> p_category;
    if v_ch is not null then
      v_in_app := coalesce((v_ch ->> 'in_app')::boolean, true);
      v_email  := coalesce((v_ch ->> 'email')::boolean, true);
      v_push   := coalesce((v_ch ->> 'push')::boolean, true);
    end if;
    v_email := v_email and v_pref.email_enabled;
    v_push  := v_push and v_pref.push_enabled;
  else
    v_push := false;
  end if;
  -- E-mail quota: routine reminders, deadlines and daily summaries are delivered in the
  -- app and by push only. Monthly-goal reminders and deadlines still go by e-mail.
  if (p_category in ('reminders', 'deadlines') or p_type = 'performance.daily_summary')
     and p_type not in ('reminder.monthly_goals', 'reminder.monthly_progress', 'reminder.monthly_goal_deadlines') then
    v_email := false;
  end if;
  -- Feedback alerts for the Super Admin: in the app and by push only.
  if p_category = 'feedback' then v_email := false; end if;
  -- Weekly and monthly summaries: in the app and by push only.
  if p_type like 'summary.%' then v_email := false; end if;
  -- Book recommendations: in the app and by push only (saves the e-mail quota).
  if p_type = 'books.recommended' then v_email := false; end if;
  -- Events and published updates: e-mail only for the first notice, and only when the
  -- Super Admin ticked "Also send by e-mail". Reminders and changes: app and push only.
  if p_type like 'event.%' or p_type like 'update.%' then
    v_email := v_email and p_type in ('event.new', 'update.published') and coalesce(p_data ->> 'email', 'false') = 'true';
  end if;
  -- Accountability e-mails only for monthly checklists; everything else is in the app and by push.
  if p_category = 'accountability' and coalesce(p_data ->> 'kind', '') <> 'monthly' then
    v_email := false;
  end if;
  -- Account lifecycle messages are always delivered in-app and by email.
  if p_category in ('registration', 'system') then v_in_app := true; v_email := true; end if;
  if not (v_in_app or v_email or v_push) then return null; end if;

  insert into public.notifications (user_id, category, type, title, body, link, data, dedupe_key, hidden, email_status, push_status)
  values (p_user, p_category, p_type, left(p_title, 200), left(p_body, 2000), p_link, coalesce(p_data, '{}'), p_dedupe,
          not v_in_app,
          case when v_email then 'pending' else 'skipped' end,
          case when v_push then 'pending' else 'skipped' end)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.notify(uuid, text, text, text, text, text, jsonb, text) from public, authenticated;

create or replace function private.sweep_checklists(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_closed int := 0; v_draws int := 0; v_tz text := private.org_tz(); v_left int;
begin
  for r in select id from public.checklists
            where status = 'open' and deleted_at is null and deadline <= now() and (p_user is null or owner_id = p_user)
            order by deadline for update skip locked loop
    perform private.close_checklist(r.id, 'deadline');
    v_closed := v_closed + 1;
  end loop;

  -- Heads-up 30 minutes before a deadline (once per checklist, only if something is unfinished).
  for r in select c.* from public.checklists c
            where c.status = 'open' and c.deleted_at is null and c.deadline > now() and c.deadline <= now() + interval '30 minutes'
              and (p_user is null or c.owner_id = p_user) loop
    select count(*) into v_left from public.checklist_items i where i.checklist_id = r.id and i.progress < 100;
    if v_left > 0 then
      perform private.notify(r.owner_id, 'deadlines', 'reminder.checklist_due_soon',
        'Your ' || private.checklist_label(r.title, r.kind) || ' closes at ' || to_char(r.deadline at time zone v_tz, 'FMHH12:MI AM'),
        v_left || ' item(s) are not at 100% yet. Update them or press Submit now.',
        '/' || case r.kind when 'todo' then 'tasks' when 'weekly' then 'weekly-goals' when 'monthly' then 'monthly-goals' else 'prospecting' end,
        jsonb_build_object('checklist_id', r.id, 'kind', r.kind), 'due-soon:' || r.id);
    end if;
  end loop;

  for r in select e.id from public.accountability_events e
             join public.profiles p on p.id = e.user_id and p.status = 'approved'
            where e.auto_draw_at is not null and e.auto_draw_at <= now()
              and (p_user is null or e.user_id = p_user)
              and not exists (select 1 from public.accountability_ledger l where l.event_id = e.id) loop
    begin
      perform private.draw_for_event(r.id, 'system_auto');
      v_draws := v_draws + 1;
    exception when others then
      perform private.audit('accountability.auto_draw_failed', 'accountability_event', r.id::text, null, null, null, 'failure',
        jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if p_user is null then perform private.run_event_reminders(); end if;
  return jsonb_build_object('closed', v_closed, 'auto_draws', v_draws);
end $$;
revoke execute on function private.sweep_checklists(uuid) from public, authenticated;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.save_event(uuid, text, text, text, timestamp, text, text, boolean), public.cancel_event(uuid, text),
  public.rsvp_event(uuid, text), public.submit_update(text, text, text, text, text),
  public.review_update(uuid, boolean, text, text, text, boolean, text), public.submit_complaint(text, text, boolean),
  public.complaint_status(text), public.my_complaints(), public.manage_complaint(uuid, text, text, text) to authenticated;
