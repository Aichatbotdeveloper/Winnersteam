-- =============================================================================
-- WINNERS TEAM — one-step production database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It applies all migrations in supabase/migrations (generated from them; do not edit).
-- Run it ONCE on a NEW, empty project. It is wrapped in a transaction: if anything
-- fails, nothing is applied. Then run supabase/sql/schedule_pg_cron.sql for scheduling.
-- =============================================================================
begin;

-- >>> 20261122000100_core_identity.sql
-- =============================================================================
-- WINNERS TEAM — 0001 Core identity, hierarchy, settings, audit, notifications
-- =============================================================================
-- Conventions
--   * public schema  : tables + RPCs callable through the Supabase API. Every
--                      public SECURITY DEFINER function checks permissions itself.
--   * private schema : helpers used by RLS policies and internal routines. It is
--                      NOT exposed through the API, so nothing here is callable
--                      from a browser.
--   * All sensitive tables have RLS enabled. Writes that need elevated rights
--     go through audited SECURITY DEFINER functions.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'administrator', 'team_member');
create type public.account_status as enum ('pending', 'approved', 'rejected', 'deactivated', 'removed');

-- -----------------------------------------------------------------------------
-- System settings (key/value, no secrets are ever stored here)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.system_settings (key, value, description) values
  ('org.name',            '"Winners Team"',     'Organisation display name'),
  ('org.timezone',        '"Africa/Lagos"',     'IANA timezone used for daily/weekly/monthly reporting periods'),
  ('org.currency',        '"NGN"',              'Currency for financial accountability (fixed to NGN)'),
  ('registration.open',   'true',               'Whether the public team-member registration form accepts submissions'),
  ('lex.enabled',         'true',               'Whether the LEX assistant is available'),
  ('lex.welcome_message', '"Hi, I''m LEX — your Winners Team platform assistant. Ask me how anything in the workspace works."', 'LEX greeting'),
  ('lex.max_history',     '12',                 'Number of previous messages LEX keeps as conversation context'),
  ('service_updates.max_items_per_source', '20', 'Maximum items ingested per source per run'),
  ('quotes.no_repeat_window', '10',             'A user will not see the same quote again within this many logins');

-- Timezone helpers -------------------------------------------------------------
create or replace function private.org_tz()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.system_settings where key = 'org.timezone'), 'Africa/Lagos');
$$;

create or replace function private.org_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone private.org_tz())::date;
$$;

-- Public wrapper so the app can align with the server's notion of "today".
create or replace function public.org_today()
returns date language sql stable security definer set search_path = '' as $$
  select private.org_today();
$$;

-- -----------------------------------------------------------------------------
-- Profiles (one unified profile per account)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete restrict,
  email                  text not null,
  full_name              text not null check (char_length(full_name) between 1 and 120),
  phone                  text check (phone is null or char_length(phone) <= 40),
  avatar_path            text check (avatar_path is null or char_length(avatar_path) <= 300),
  job_title              text check (job_title is null or char_length(job_title) <= 120),
  team_name              text check (team_name is null or char_length(team_name) <= 120),
  team_leader_name       text check (team_leader_name is null or char_length(team_leader_name) <= 120),
  -- professional information
  specialisations        text[] not null default '{}',
  skills                 text[] not null default '{}',
  business_interests     text[] not null default '{}',
  target_audience        text check (target_audience is null or char_length(target_audience) <= 1000),
  portfolio_links        text[] not null default '{}',
  -- governance
  role                   public.app_role not null default 'team_member',
  status                 public.account_status not null default 'pending',
  physical_accommodation boolean not null default false,
  email_verified_at      timestamptz,
  approved_at            timestamptz,
  approved_by            uuid references public.profiles (id),
  deactivated_at         timestamptz,
  removed_at             timestamptz,
  removed_by             uuid references public.profiles (id),
  status_reason          text check (status_reason is null or char_length(status_reason) <= 1000),
  last_seen_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint profiles_array_limits check (
    cardinality(specialisations) <= 20 and cardinality(skills) <= 40
    and cardinality(business_interests) <= 20 and cardinality(portfolio_links) <= 10)
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_status_idx on public.profiles (role, status);
create index profiles_name_trgm_idx on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Administrator ⇄ team-member assignment (one active admin per member)
-- -----------------------------------------------------------------------------
create table public.admin_assignments (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.profiles (id),
  administrator_id uuid not null references public.profiles (id),
  assigned_by      uuid references public.profiles (id),
  reason           text check (reason is null or char_length(reason) <= 500),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  ended_by         uuid references public.profiles (id),
  constraint admin_assignments_distinct check (member_id <> administrator_id),
  constraint admin_assignments_dates check (ended_at is null or ended_at >= started_at)
);
create unique index admin_assignments_one_active on public.admin_assignments (member_id) where ended_at is null;
create index admin_assignments_admin_active on public.admin_assignments (administrator_id) where ended_at is null;
create index admin_assignments_member_hist on public.admin_assignments (member_id, started_at desc);

-- -----------------------------------------------------------------------------
-- RLS helper functions (private, SECURITY DEFINER to avoid policy recursion)
-- -----------------------------------------------------------------------------
create or replace function private.current_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'approved';
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'approved');
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() = 'super_admin', false);
$$;

create or replace function private.is_administrator()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() = 'administrator', false);
$$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() in ('administrator', 'super_admin'), false);
$$;

-- TRUE when the caller is the *currently* assigned, active administrator of p_member.
create or replace function private.is_assigned_admin_of(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.admin_assignments a
    join public.profiles p on p.id = a.administrator_id
    where a.member_id = p_member
      and a.administrator_id = (select auth.uid())
      and a.ended_at is null
      and p.role = 'administrator' and p.status = 'approved');
$$;

-- Read access to another user's private workspace data.
create or replace function private.can_view_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (p_user = (select auth.uid()) and private.is_active_user())
      or private.is_super_admin()
      or private.is_assigned_admin_of(p_user);
$$;

-- Owner write access to their own workspace data.
create or replace function private.is_owner_active(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid()) and private.is_active_user();
$$;

create or replace function private.current_admin_of(p_member uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select administrator_id from public.admin_assignments where member_id = p_member and ended_at is null;
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid references public.profiles (id),
  actor_role     public.app_role,
  action         text not null check (action ~ '^[a-z_]+\.[a-z_.]+$'),
  entity_type    text not null,
  entity_id      text,
  target_user_id uuid references public.profiles (id),
  old_value      jsonb,
  new_value      jsonb,
  outcome        text not null default 'success' check (outcome in ('success', 'failure', 'denied')),
  metadata       jsonb not null default '{}'
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_user_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

create or replace function private.audit_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

create or replace function private.audit(
  p_action text, p_entity_type text, p_entity_id text default null, p_target uuid default null,
  p_old jsonb default null, p_new jsonb default null, p_outcome text default 'success', p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, target_user_id, old_value, new_value, outcome, metadata)
  values (
    case when exists (select 1 from public.profiles where id = v_actor) then v_actor end,
    (select role from public.profiles where id = v_actor),
    p_action, p_entity_type, p_entity_id, p_target, p_old, p_new, p_outcome, coalesce(p_metadata, '{}'));
end $$;
revoke execute on function private.audit(text, text, text, uuid, jsonb, jsonb, text, jsonb) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
create table public.notification_preferences (
  user_id             uuid primary key references public.profiles (id),
  -- per category channel toggles, e.g. {"reminders": {"in_app": true, "email": true, "push": false}}
  channels            jsonb not null default '{}',
  email_enabled       boolean not null default true,
  push_enabled        boolean not null default false,
  updated_at          timestamptz not null default now()
);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  category     text not null check (category in (
                 'reminders', 'deadlines', 'performance', 'accountability', 'registration',
                 'assignment', 'profile', 'service_updates', 'announcements', 'system')),
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  data         jsonb not null default '{}',
  dedupe_key   text,
  hidden       boolean not null default false,
  read_at      timestamptz,
  email_status text not null default 'skipped' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  push_status  text not null default 'skipped' check (push_status in ('pending', 'sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  created_at   timestamptz not null default now(),
  constraint notifications_dedupe unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc) where not hidden;
create index notifications_unread_idx on public.notifications (user_id) where read_at is null and not hidden;
create index notifications_email_pending_idx on public.notifications (created_at) where email_status = 'pending';
create index notifications_push_pending_idx on public.notifications (created_at) where push_status = 'pending';

create table public.notification_delivery_logs (
  id              bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel         text not null check (channel in ('email', 'push')),
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index notification_delivery_logs_notif_idx on public.notification_delivery_logs (notification_id);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) default auth.uid(),
  endpoint   text not null unique check (endpoint ~ '^https://'),
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Create a notification honouring the user's channel preferences.
-- Idempotent when p_dedupe is supplied (prevents duplicate reminders).
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

create or replace function private.notify_super_admins(
  p_category text, p_type text, p_title text, p_body text default null, p_link text default null,
  p_data jsonb default '{}', p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'super_admin' and status = 'approved' loop
    perform private.notify(r.id, p_category, p_type, p_title, p_body, p_link, p_data, p_dedupe);
  end loop;
end $$;
revoke execute on function private.notify_super_admins(text, text, text, text, text, jsonb, text) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Registration requests & administrator invitations
-- -----------------------------------------------------------------------------
create table public.registration_requests (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null unique references public.profiles (id),
  requested_specialisation text check (requested_specialisation is null or char_length(requested_specialisation) <= 200),
  message                  text check (message is null or char_length(message) <= 1000),
  submitted_at             timestamptz not null default now(),
  decision                 text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decided_by               uuid references public.profiles (id),
  decided_at               timestamptz,
  decision_reason          text check (decision_reason is null or char_length(decision_reason) <= 1000),
  assigned_admin_id        uuid references public.profiles (id)
);
create index registration_requests_pending_idx on public.registration_requests (submitted_at) where decision = 'pending';

create table public.administrator_invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name   text not null check (char_length(full_name) between 1 and 120),
  job_title   text check (job_title is null or char_length(job_title) <= 120),
  invited_by  uuid not null references public.profiles (id),
  profile_id  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create unique index administrator_invitations_open on public.administrator_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

-- -----------------------------------------------------------------------------
-- New auth user → profile. Role is NEVER taken from client-supplied metadata:
-- an account becomes an administrator only if a Super Admin created an open
-- invitation for that e-mail address.
-- -----------------------------------------------------------------------------
create or replace function private.clean_text(p jsonb, k text, max_len int)
returns text language sql immutable as $$
  select nullif(left(btrim(p ->> k), max_len), '');
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_inv  public.administrator_invitations;
  v_name text;
begin
  select * into v_inv from public.administrator_invitations
   where lower(email) = lower(new.email) and accepted_at is null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;

  if found then
    insert into public.profiles (id, email, full_name, job_title, role, status, approved_at, approved_by, email_verified_at)
    values (new.id, lower(new.email), v_inv.full_name, v_inv.job_title, 'administrator', 'approved', now(), v_inv.invited_by, new.email_confirmed_at);
    update public.administrator_invitations set profile_id = new.id where id = v_inv.id;
    insert into public.notification_preferences (user_id) values (new.id);
    perform private.audit('administrator.account_created', 'profile', new.id::text, new.id, null,
      jsonb_build_object('email', lower(new.email), 'invitation_id', v_inv.id));
  else
    v_name := coalesce(private.clean_text(v_meta, 'full_name', 120), split_part(new.email, '@', 1));
    insert into public.profiles (id, email, full_name, phone, job_title, team_name, team_leader_name, role, status, email_verified_at)
    values (new.id, lower(new.email), v_name,
            private.clean_text(v_meta, 'phone', 40), private.clean_text(v_meta, 'job_title', 120),
            private.clean_text(v_meta, 'team_name', 120), private.clean_text(v_meta, 'team_leader_name', 120),
            'team_member', 'pending', new.email_confirmed_at);
    insert into public.registration_requests (profile_id, requested_specialisation, message)
    values (new.id, private.clean_text(v_meta, 'requested_specialisation', 200), private.clean_text(v_meta, 'message', 1000));
    insert into public.notification_preferences (user_id) values (new.id);
    perform private.audit('registration.submitted', 'profile', new.id::text, new.id, null,
      jsonb_build_object('email', lower(new.email), 'full_name', v_name));
    perform private.notify_super_admins('registration', 'registration.pending',
      'New registration awaiting approval', v_name || ' (' || lower(new.email) || ') has registered and needs review.',
      '/super-admin/registrations', jsonb_build_object('profile_id', new.id), 'registration:' || new.id);
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Email verification is tracked separately from Super Admin approval.
create or replace function private.handle_user_email_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is distinct from old.email_confirmed_at then
    update public.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
    if new.email_confirmed_at is not null then
      update public.administrator_invitations set accepted_at = coalesce(accepted_at, now())
       where profile_id = new.id and accepted_at is null;
    end if;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_confirmed after update of email_confirmed_at on auth.users
  for each row execute function private.handle_user_email_confirmed();

-- -----------------------------------------------------------------------------
-- Profile protection, change history & notifications
-- -----------------------------------------------------------------------------
create table public.profile_change_log (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id),
  changed_by  uuid references public.profiles (id),
  section     text not null check (section in ('basic', 'professional', 'services', 'accommodation')),
  changes     jsonb not null,
  created_at  timestamptz not null default now()
);
create index profile_change_log_profile_idx on public.profile_change_log (profile_id, created_at desc);

-- SECURITY INVOKER on purpose: current_user must reflect the API caller.
create or replace function private.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Direct API updates run as role "authenticated". Privileged changes must go
  -- through audited RPCs (which run as the function owner) or the Super Admin.
  if current_user = 'authenticated' then
    if not private.is_super_admin() and (
         new.role is distinct from old.role or new.status is distinct from old.status
      or new.email is distinct from old.email or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by or new.deactivated_at is distinct from old.deactivated_at
      or new.removed_at is distinct from old.removed_at or new.removed_by is distinct from old.removed_by
      or new.status_reason is distinct from old.status_reason or new.email_verified_at is distinct from old.email_verified_at
      or new.physical_accommodation is distinct from old.physical_accommodation
      or new.created_at is distinct from old.created_at or new.id is distinct from old.id) then
      raise exception 'Protected account fields can only be changed by an authorised workflow' using errcode = '42501';
    end if;
    if private.is_super_admin() and (new.id is distinct from old.id or new.email is distinct from old.email
        or new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'Use the account management workflow to change role, status or e-mail' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

create or replace function private.profiles_track_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_basic jsonb := '{}'; v_prof jsonb := '{}'; v_all jsonb; v_admin uuid; k text;
  basic_cols text[] := array['full_name', 'phone', 'avatar_path', 'job_title', 'team_name', 'team_leader_name'];
  prof_cols  text[] := array['specialisations', 'skills', 'business_interests', 'target_audience', 'portfolio_links'];
  o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  foreach k in array basic_cols loop
    if (o -> k) is distinct from (n -> k) then v_basic := v_basic || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k)); end if;
  end loop;
  foreach k in array prof_cols loop
    if (o -> k) is distinct from (n -> k) then v_prof := v_prof || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k)); end if;
  end loop;
  if v_basic = '{}' and v_prof = '{}' then return new; end if;

  if v_basic <> '{}' then
    insert into public.profile_change_log (profile_id, changed_by, section, changes) values (new.id, (select auth.uid()), 'basic', v_basic);
  end if;
  if v_prof <> '{}' then
    insert into public.profile_change_log (profile_id, changed_by, section, changes) values (new.id, (select auth.uid()), 'professional', v_prof);
  end if;
  v_all := v_basic || v_prof;
  perform private.audit('profile.modified', 'profile', new.id::text, new.id,
    (select jsonb_object_agg(key, value -> 'old') from jsonb_each(v_all)),
    (select jsonb_object_agg(key, value -> 'new') from jsonb_each(v_all)));

  if new.status = 'approved' then
    v_admin := private.current_admin_of(new.id);
    if v_admin is not null and v_admin is distinct from (select auth.uid()) then
      perform private.notify(v_admin, 'profile', 'profile.modified', new.full_name || ' updated their profile',
        'Changed: ' || (select string_agg(replace(key, '_', ' '), ', ') from jsonb_object_keys(v_all) key),
        '/team/' || new.id, jsonb_build_object('profile_id', new.id));
    end if;
    if new.role <> 'super_admin' then
      perform private.notify_super_admins('profile', 'profile.modified', new.full_name || ' updated their profile',
        'Changed: ' || (select string_agg(replace(key, '_', ' '), ', ') from jsonb_object_keys(v_all) key),
        '/team/' || new.id, jsonb_build_object('profile_id', new.id));
    end if;
  end if;
  return new;
end $$;
create trigger profiles_track_changes after update on public.profiles
  for each row execute function private.profiles_track_changes();

-- -----------------------------------------------------------------------------
-- Announcements
-- -----------------------------------------------------------------------------
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id),
  scope      text not null check (scope in ('team', 'organisation')),
  title      text not null check (char_length(title) between 1 and 160),
  body       text not null check (char_length(body) between 1 and 4000),
  recipients int not null default 0,
  created_at timestamptz not null default now()
);
create index announcements_author_idx on public.announcements (author_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Generic updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function private.touch_updated_at();

create or replace function private.system_settings_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  perform private.audit('settings.updated', 'system_setting', new.key, null,
    case when tg_op = 'UPDATE' then jsonb_build_object('value', old.value) end, jsonb_build_object('value', new.value));
  return new;
end $$;
create trigger system_settings_audit before insert or update on public.system_settings
  for each row execute function private.system_settings_audit();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.system_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_assignments enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_delivery_logs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.registration_requests enable row level security;
alter table public.administrator_invitations enable row level security;
alter table public.profile_change_log enable row level security;
alter table public.announcements enable row level security;

-- system_settings: readable by any signed-in active user, writable by Super Admin.
create policy system_settings_read on public.system_settings for select to authenticated
  using (private.is_active_user());
create policy system_settings_write on public.system_settings for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check (private.is_super_admin());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_super_admin() or private.is_assigned_admin_of(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and status in ('approved', 'pending'))
  with check (id = (select auth.uid()));
create policy profiles_update_super on public.profiles for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- admin_assignments: visible to super admin, the member, and the *current* admin.
create policy admin_assignments_select on public.admin_assignments for select to authenticated
  using (private.is_super_admin() or member_id = (select auth.uid())
         or (administrator_id = (select auth.uid()) and ended_at is null and private.is_administrator()));

-- audit_logs: super admin sees all, administrators see their own actions and
-- records about their currently assigned members.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.is_super_admin()
         or (private.is_administrator() and (actor_id = (select auth.uid()) or private.is_assigned_admin_of(target_user_id))));

-- notifications
create policy notification_prefs_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_prefs_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_prefs_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and not hidden);
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;
revoke insert, delete on public.notifications from authenticated, anon;

create policy notification_delivery_logs_select on public.notification_delivery_logs for select to authenticated
  using (private.is_super_admin());

create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.is_active_user());

-- registration requests: Super Admin sees all, applicant sees own.
create policy registration_requests_select on public.registration_requests for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_super_admin());

create policy administrator_invitations_select on public.administrator_invitations for select to authenticated
  using (private.is_super_admin());

-- profile change log: super admin all, assigned admin, and the owner.
create policy profile_change_log_select on public.profile_change_log for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_super_admin() or private.is_assigned_admin_of(profile_id));

-- announcements
create policy announcements_select on public.announcements for select to authenticated
  using (private.is_active_user() and (
    author_id = (select auth.uid()) or private.is_super_admin() or scope = 'organisation'
    or (scope = 'team' and private.current_admin_of((select auth.uid())) = author_id)));

-- Tighten default table privileges: no anonymous access to anything.
revoke all on all tables in schema public from anon;

-- >>> 20261122000200_governance_workflows.sql
-- =============================================================================
-- WINNERS TEAM — 0002 Governance workflows (approval, assignment, removal)
-- All functions validate the caller's role from the database, never from the
-- client, and write an audit record.
-- =============================================================================

create or replace function private.require(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_message using errcode = '42501';
  end if;
end $$;

-- Internal: (re)assign a member to an administrator, preserving history.
create or replace function private.assign_member(p_member uuid, p_admin uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid; v_id uuid;
  v_member public.profiles; v_admin public.profiles;
begin
  select * into v_member from public.profiles where id = p_member for update;
  select * into v_admin from public.profiles where id = p_admin;
  perform private.require(v_member.role = 'team_member', 'Only team members can be assigned to an administrator');
  perform private.require(v_member.status in ('approved', 'pending'), 'Member account is not active');
  perform private.require(v_admin.role = 'administrator' and v_admin.status = 'approved', 'Target administrator is not active');

  v_old := private.current_admin_of(p_member);
  if v_old = p_admin then return null; end if;

  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid())
   where member_id = p_member and ended_at is null;
  insert into public.admin_assignments (member_id, administrator_id, assigned_by, reason)
  values (p_member, p_admin, (select auth.uid()), p_reason) returning id into v_id;

  perform private.audit(case when v_old is null then 'assignment.created' else 'assignment.transferred' end,
    'admin_assignment', v_id::text, p_member,
    case when v_old is not null then jsonb_build_object('administrator_id', v_old) end,
    jsonb_build_object('administrator_id', p_admin), 'success', jsonb_build_object('reason', p_reason));

  perform private.notify(p_admin, 'assignment', 'assignment.added', v_member.full_name || ' joined your team',
    'You are now the assigned administrator for ' || v_member.full_name || '.', '/team/' || p_member,
    jsonb_build_object('member_id', p_member));
  if v_old is not null then
    perform private.notify(v_old, 'assignment', 'assignment.removed', v_member.full_name || ' was transferred',
      v_member.full_name || ' has been reassigned to another administrator.', '/admin',
      jsonb_build_object('member_id', p_member));
    perform private.notify(p_member, 'assignment', 'assignment.changed', 'Your administrator has changed',
      'You now report to ' || v_admin.full_name || '.', '/profile', jsonb_build_object('administrator_id', p_admin));
  end if;
  return v_id;
end $$;
revoke execute on function private.assign_member(uuid, uuid, text) from public, authenticated;

-- Super Admin: approve a pending registration and assign an administrator.
create or replace function public.approve_registration(p_member uuid, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles; v_admin_name text;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can approve registrations');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found and v_member.status = 'pending' and v_member.role = 'team_member', 'Registration is not pending');

  update public.profiles set status = 'approved', approved_at = now(), approved_by = (select auth.uid()), status_reason = null
   where id = p_member;
  perform private.assign_member(p_member, p_admin, 'Registration approval');
  update public.registration_requests set decision = 'approved', decided_by = (select auth.uid()), decided_at = now(),
         assigned_admin_id = p_admin where profile_id = p_member;
  select full_name into v_admin_name from public.profiles where id = p_admin;

  perform private.audit('registration.approved', 'profile', p_member::text, p_member,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'approved', 'administrator_id', p_admin));
  perform private.notify(p_member, 'registration', 'registration.approved', 'Your Winners Team account is approved',
    'Welcome aboard! You have been assigned to ' || v_admin_name || '. You can now sign in to your workspace.',
    '/dashboard', '{}', 'registration-approved:' || p_member);
end $$;

create or replace function public.reject_registration(p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can reject registrations');
  perform private.require(char_length(coalesce(p_reason, '')) between 3 and 1000, 'A rejection reason (3–1000 characters) is required');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found and v_member.status = 'pending', 'Registration is not pending');

  update public.profiles set status = 'rejected', status_reason = p_reason where id = p_member;
  update public.registration_requests set decision = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
         decision_reason = p_reason where profile_id = p_member;
  perform private.audit('registration.rejected', 'profile', p_member::text, p_member,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected'), 'success', jsonb_build_object('reason', p_reason));
  perform private.notify(p_member, 'registration', 'registration.rejected', 'Your registration was not approved',
    p_reason, '/pending-approval', '{}', 'registration-rejected:' || p_member);
end $$;

-- Super Admin only: transfer a member to another administrator.
create or replace function public.transfer_member(p_member uuid, p_admin uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can transfer team members');
  perform private.require((select status from public.profiles where id = p_member) = 'approved', 'Member account is not active');
  perform private.assign_member(p_member, p_admin, left(p_reason, 500));
end $$;

-- Administrators AND the Super Admin may remove ANY team-member account.
-- Narrow privileged operation: it returns nothing about the member and never
-- grants read access to the member's private records.
create or replace function public.remove_team_member(p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles;
begin
  perform private.require(private.is_staff(), 'Only administrators and the Super Admin can remove team members');
  perform private.require(char_length(coalesce(p_reason, '')) between 3 and 1000, 'A removal reason (3–1000 characters) is required');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found, 'Account not found');
  perform private.require(v_member.role = 'team_member', 'Only team-member accounts can be removed with this action');
  perform private.require(v_member.status <> 'removed', 'Account has already been removed');

  update public.profiles set status = 'removed', removed_at = now(), removed_by = (select auth.uid()), status_reason = p_reason
   where id = p_member;
  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid())
   where member_id = p_member and ended_at is null;
  perform private.audit('account.removed', 'profile', p_member::text, p_member,
    jsonb_build_object('status', v_member.status), jsonb_build_object('status', 'removed'), 'success',
    jsonb_build_object('reason', p_reason));
  perform private.notify_super_admins('system', 'account.removed', v_member.full_name || ' was removed',
    'Team member account removed. Reason: ' || p_reason, '/super-admin/users', jsonb_build_object('profile_id', p_member));
end $$;

-- Super Admin: deactivate / reactivate any non-Super-Admin account.
create or replace function public.set_account_active(p_user uuid, p_active boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user public.profiles; v_new public.account_status;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can deactivate or reactivate accounts');
  select * into v_user from public.profiles where id = p_user for update;
  perform private.require(found and v_user.role <> 'super_admin', 'This account cannot be changed');
  perform private.require(v_user.status in ('approved', 'deactivated', 'removed'), 'Account is not in a state that can be changed');
  v_new := case when p_active then 'approved' else 'deactivated' end;
  if v_user.status = v_new then return; end if;

  update public.profiles set status = v_new,
         deactivated_at = case when p_active then null else now() end,
         removed_at = case when p_active then null else removed_at end,
         removed_by = case when p_active then null else removed_by end,
         status_reason = p_reason
   where id = p_user;
  if not p_active then
    -- Members of a deactivated administrator keep their assignment row so the
    -- Super Admin can reassign them; a deactivated admin no longer passes the
    -- is_assigned_admin_of() check, so access is revoked immediately.
    null;
  end if;
  perform private.audit(case when p_active then 'account.reactivated' else 'account.deactivated' end,
    'profile', p_user::text, p_user, jsonb_build_object('status', v_user.status), jsonb_build_object('status', v_new),
    'success', jsonb_build_object('reason', p_reason));
end $$;

-- Super Admin records an administrator invitation (the app then sends the
-- Supabase Auth invite e-mail using the service role on the server).
create or replace function public.create_admin_invitation(p_email text, p_full_name text, p_job_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can invite administrators');
  perform private.require(p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'A valid e-mail address is required');
  perform private.require(not exists (select 1 from public.profiles where lower(email) = lower(p_email)), 'An account with this e-mail already exists');
  update public.administrator_invitations set revoked_at = now()
   where lower(email) = lower(p_email) and accepted_at is null and revoked_at is null;
  insert into public.administrator_invitations (email, full_name, job_title, invited_by)
  values (lower(btrim(p_email)), btrim(p_full_name), nullif(btrim(p_job_title), ''), (select auth.uid()))
  returning id into v_id;
  perform private.audit('administrator.invited', 'administrator_invitation', v_id::text, null, null,
    jsonb_build_object('email', lower(p_email), 'full_name', p_full_name));
  return v_id;
end $$;

create or replace function public.revoke_admin_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can revoke invitations');
  update public.administrator_invitations set revoked_at = now() where id = p_invitation and accepted_at is null and revoked_at is null;
  perform private.audit('administrator.invitation_revoked', 'administrator_invitation', p_invitation::text);
end $$;

-- Administrators can find ANY team member for removal, but only see the
-- minimum needed to identify them (no private workspace data).
create or replace function public.search_removable_members(p_query text, p_limit int default 20)
returns table (id uuid, full_name text, job_title text, team_name text, status public.account_status)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_staff(), 'Not authorised');
  return query
    select p.id, p.full_name, p.job_title, p.team_name, p.status
      from public.profiles p
     where p.role = 'team_member' and p.status in ('approved', 'pending', 'deactivated')
       and (coalesce(p_query, '') = '' or p.full_name ilike '%' || p_query || '%' or p.team_name ilike '%' || p_query || '%')
     order by p.full_name
     limit least(greatest(p_limit, 1), 50);
end $$;

-- A member's own administrator (name only) for "Reporting to …" displays.
create or replace function public.my_administrator()
returns table (id uuid, full_name text, job_title text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.job_title from public.profiles p
   where p.id = private.current_admin_of((select auth.uid()));
$$;

-- Super-Admin-only directory of administrators (used across management UIs).
create or replace function public.list_administrators()
returns table (id uuid, full_name text, email text, job_title text, status public.account_status, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Not authorised');
  return query
    select p.id, p.full_name, p.email, p.job_title, p.status,
           (select count(*) from public.admin_assignments a join public.profiles m on m.id = a.member_id
             where a.administrator_id = p.id and a.ended_at is null and m.status = 'approved'),
           p.created_at
      from public.profiles p where p.role = 'administrator' order by p.full_name;
end $$;

-- Announcements: administrators → their assigned team; Super Admin → anyone.
create or replace function public.send_announcement(p_title text, p_body text, p_scope text default 'team')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count int := 0; r record; v_author text;
begin
  perform private.require(private.is_staff(), 'Only administrators and the Super Admin can send announcements');
  perform private.require(p_scope in ('team', 'organisation'), 'Invalid scope');
  perform private.require(p_scope = 'team' or private.is_super_admin(), 'Only the Super Admin can address the whole organisation');
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 1 and 160 and char_length(btrim(coalesce(p_body, ''))) between 1 and 4000,
    'Title (1–160) and message (1–4000 characters) are required');

  insert into public.announcements (author_id, scope, title, body)
  values ((select auth.uid()), p_scope, btrim(p_title), btrim(p_body)) returning id into v_id;
  select full_name into v_author from public.profiles where id = (select auth.uid());

  for r in
    select p.id from public.profiles p
     where p.status = 'approved' and p.id <> (select auth.uid())
       and (case when p_scope = 'organisation' then true
                 else p.role = 'team_member' and private.current_admin_of(p.id) = (select auth.uid()) end)
  loop
    perform private.notify(r.id, 'announcements', 'announcement', btrim(p_title), left(btrim(p_body), 500),
      '/notifications', jsonb_build_object('announcement_id', v_id, 'author', v_author), 'announcement:' || v_id);
    v_count := v_count + 1;
  end loop;
  update public.announcements set recipients = v_count where id = v_id;
  perform private.audit('announcement.sent', 'announcement', v_id::text, null, null,
    jsonb_build_object('title', p_title, 'scope', p_scope, 'recipients', v_count));
  return v_id;
end $$;

-- Mark all of the caller's notifications read.
create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = (select auth.uid()) and read_at is null;
$$;

-- Update last_seen_at (used for "active" indicators).
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
   where id = (select auth.uid()) and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;

-- Bootstrap: promote an existing auth account to Super Admin. Callable only by
-- the database owner / service role (SQL editor or deployment script).
create or replace function public.bootstrap_super_admin(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.profiles where lower(email) = lower(p_email);
  if v_id is null then raise exception 'No account with e-mail %', p_email; end if;
  update public.profiles set role = 'super_admin', status = 'approved', approved_at = coalesce(approved_at, now()), status_reason = null
   where id = v_id;
  update public.admin_assignments set ended_at = now() where member_id = v_id and ended_at is null;
  update public.registration_requests set decision = 'approved', decided_at = now() where profile_id = v_id and decision = 'pending';
  perform private.audit('account.super_admin_bootstrapped', 'profile', v_id::text, v_id);
end $$;
revoke execute on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;

-- >>> 20261122000300_productivity.sql
-- =============================================================================
-- WINNERS TEAM — 0003 Productivity: daily to-dos, additional tasks, weekly &
-- monthly goals, prospecting targets and activities.
--
-- Integrity rule: once a reporting period has closed, its records are locked
-- for ordinary users (a closed period has already been evaluated). Corrections
-- are made by the Super Admin through the audited performance-correction flow.
-- =============================================================================

create type public.task_kind as enum ('daily', 'additional');
create type public.task_status as enum ('pending', 'in_progress', 'completed');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.prospecting_activity as enum (
  'find_prospects', 'contact_prospects', 'generate_leads', 'send_proposals', 'follow_ups', 'appointments', 'conversions');

-- -----------------------------------------------------------------------------
create table public.task_categories (
  id         uuid primary key default gen_random_uuid(),
  kind       public.task_kind not null,
  name       text not null check (char_length(name) between 1 and 60),
  color      text not null default '#5a45cb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active     boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index task_categories_name_key on public.task_categories (kind, lower(name));

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id),
  kind         public.task_kind not null default 'daily',
  category_id  uuid references public.task_categories (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text check (description is null or char_length(description) <= 2000),
  notes        text check (notes is null or char_length(notes) <= 4000),
  priority     public.task_priority not null default 'normal',
  status       public.task_status not null default 'pending',
  due_date     date not null default private.org_today(),
  due_time     time,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index tasks_owner_due_idx on public.tasks (owner_id, kind, due_date) where deleted_at is null;
create index tasks_due_pending_idx on public.tasks (due_date) where deleted_at is null and status <> 'completed';

create table public.weekly_goals (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  unit        text not null default 'units' check (char_length(unit) between 1 and 30),
  target      numeric(12, 2) not null check (target > 0 and target <= 1000000000),
  achieved    numeric(12, 2) not null default 0 check (achieved >= 0 and achieved <= 1000000000),
  week_start  date not null check (extract(isodow from week_start) = 1),
  deadline    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint weekly_goals_deadline check (deadline between week_start and week_start + 6)
);
create index weekly_goals_owner_idx on public.weekly_goals (owner_id, week_start) where deleted_at is null;

create table public.monthly_goals (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  unit        text not null default 'units' check (char_length(unit) between 1 and 30),
  target      numeric(14, 2) not null check (target > 0 and target <= 1000000000000),
  achieved    numeric(14, 2) not null default 0 check (achieved >= 0 and achieved <= 1000000000000),
  month_start date not null check (extract(day from month_start) = 1),
  deadline    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint monthly_goals_deadline check (deadline between month_start and (month_start + interval '1 month - 1 day')::date)
);
create index monthly_goals_owner_idx on public.monthly_goals (owner_id, month_start) where deleted_at is null;

create table public.prospecting_targets (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id),
  activity     public.prospecting_activity not null,
  period       text not null check (period in ('daily', 'weekly')),
  period_start date not null,
  target       int not null check (target between 1 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint prospecting_targets_unique unique (owner_id, activity, period, period_start),
  constraint prospecting_targets_week check (period = 'daily' or extract(isodow from period_start) = 1)
);
create index prospecting_targets_owner_idx on public.prospecting_targets (owner_id, period, period_start);

create table public.prospecting_activities (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id),
  activity      public.prospecting_activity not null,
  quantity      int not null default 1 check (quantity between 1 and 1000),
  occurred_on   date not null default private.org_today(),
  prospect_name text check (prospect_name is null or char_length(prospect_name) <= 160),
  notes         text check (notes is null or char_length(notes) <= 1000),
  created_at    timestamptz not null default now()
);
create index prospecting_activities_owner_idx on public.prospecting_activities (owner_id, occurred_on);

-- -----------------------------------------------------------------------------
-- Integrity triggers (SECURITY INVOKER so current_user is the API role)
-- -----------------------------------------------------------------------------
create or replace function private.tasks_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := private.org_today();
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' and new.due_date < v_today then
      raise exception 'Tasks cannot be created for a past date' using errcode = '22023';
    end if;
  elsif tg_op = 'UPDATE' then
    if current_user = 'authenticated' then
      if new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
        raise exception 'Task ownership cannot be changed' using errcode = '42501';
      end if;
      if old.due_date < v_today and (
           new.status is distinct from old.status or new.due_date is distinct from old.due_date
        or new.deleted_at is distinct from old.deleted_at or new.kind is distinct from old.kind
        or new.title is distinct from old.title) then
        raise exception 'This task belongs to a closed day and is locked. Ask the Super Admin for a correction.' using errcode = '42501';
      end if;
      if new.due_date < v_today and new.due_date is distinct from old.due_date then
        raise exception 'Tasks cannot be moved to a past date' using errcode = '22023';
      end if;
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger tasks_integrity before insert or update on public.tasks
  for each row execute function private.tasks_integrity();

create or replace function private.goals_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := private.org_today(); v_end_old date; v_end_new date; v_start_new date;
begin
  if tg_table_name = 'weekly_goals' then
    v_start_new := new.week_start; v_end_new := new.week_start + 6;
    if tg_op = 'UPDATE' then v_end_old := old.week_start + 6; end if;
  else
    v_start_new := new.month_start; v_end_new := (new.month_start + interval '1 month - 1 day')::date;
    if tg_op = 'UPDATE' then v_end_old := (old.month_start + interval '1 month - 1 day')::date; end if;
  end if;

  if current_user = 'authenticated' then
    if v_end_new < v_today then
      raise exception 'Goals cannot be created or moved into a closed period' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' then
      if new.owner_id is distinct from old.owner_id then
        raise exception 'Goal ownership cannot be changed' using errcode = '42501';
      end if;
      if v_end_old < v_today then
        raise exception 'This goal belongs to a closed period and is locked' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger weekly_goals_integrity before insert or update on public.weekly_goals
  for each row execute function private.goals_integrity();
create trigger monthly_goals_integrity before insert or update on public.monthly_goals
  for each row execute function private.goals_integrity();

create or replace function private.prospecting_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := private.org_today(); v_end date;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' and tg_table_name = 'prospecting_targets' then new.updated_at := now(); end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'prospecting_activities' then
    if tg_op = 'INSERT' and new.occurred_on <> v_today then
      raise exception 'Prospecting activity can only be logged for today' using errcode = '22023';
    end if;
    if tg_op = 'DELETE' and old.occurred_on <> v_today then
      raise exception 'Activity from a closed day cannot be deleted' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Prospecting activity entries cannot be edited; delete and re-log today''s entry instead' using errcode = '42501';
    end if;
  else
    if tg_op in ('UPDATE', 'DELETE') then
      v_end := case when old.period = 'daily' then old.period_start else old.period_start + 6 end;
      if v_end < v_today then
        raise exception 'Targets for a closed period are locked' using errcode = '42501';
      end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      v_end := case when new.period = 'daily' then new.period_start else new.period_start + 6 end;
      if v_end < v_today then
        raise exception 'Targets cannot be set for a closed period' using errcode = '22023';
      end if;
      if tg_op = 'UPDATE' then
        if new.owner_id is distinct from old.owner_id then raise exception 'Ownership cannot change' using errcode = '42501'; end if;
        new.updated_at := now();
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger prospecting_targets_integrity before insert or update or delete on public.prospecting_targets
  for each row execute function private.prospecting_integrity();
create trigger prospecting_activities_integrity before insert or update or delete on public.prospecting_activities
  for each row execute function private.prospecting_integrity();

-- Audit deletions and status changes of tasks (task modifications).
create or replace function private.tasks_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform private.audit('task.deleted', 'task', new.id::text, new.owner_id,
      jsonb_build_object('title', old.title, 'status', old.status, 'due_date', old.due_date), null);
  elsif new.status is distinct from old.status then
    perform private.audit('task.status_changed', 'task', new.id::text, new.owner_id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'title', new.title));
  end if;
  return null;
end $$;
create trigger tasks_audit after update on public.tasks
  for each row execute function private.tasks_audit();

-- -----------------------------------------------------------------------------
-- RLS: owners write their own records; owners, their *current* administrator
-- and the Super Admin can read them.
-- -----------------------------------------------------------------------------
alter table public.task_categories enable row level security;
alter table public.tasks enable row level security;
alter table public.weekly_goals enable row level security;
alter table public.monthly_goals enable row level security;
alter table public.prospecting_targets enable row level security;
alter table public.prospecting_activities enable row level security;

create policy task_categories_read on public.task_categories for select to authenticated using (private.is_active_user());
create policy task_categories_write on public.task_categories for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

do $$
declare t text;
begin
  foreach t in array array['tasks', 'weekly_goals', 'monthly_goals', 'prospecting_targets', 'prospecting_activities'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.can_view_user(owner_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_owner_active(owner_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_owner_active(owner_id)) with check (private.is_owner_active(owner_id))', t);
  end loop;
end $$;
-- Soft delete only for tasks/goals (history is retained); hard delete for
-- today's prospecting log entries and open-period targets.
create policy prospecting_activities_delete on public.prospecting_activities for delete to authenticated
  using (private.is_owner_active(owner_id));
create policy prospecting_targets_delete on public.prospecting_targets for delete to authenticated
  using (private.is_owner_active(owner_id));

-- >>> 20261122000400_performance.sql
-- =============================================================================
-- WINNERS TEAM — 0004 Performance calculation engine
--
-- Rules (see docs/PERFORMANCE.md):
--  * Task categories:      completed due tasks ÷ total due tasks × 100
--  * Quantity categories:  actual ÷ target × 100 (capped at 100 for scoring,
--                          uncapped "raw" value retained for display)
--  * Goals:                each goal contributes equally (units differ)
--  * Prospecting:          Σ min(actual, target) ÷ Σ target per activity, so
--                          over-delivering one activity cannot hide another
--  * Periods:              daily  → daily to-dos, prospecting, additional tasks
--                          weekly → + weekly goals
--                          monthly→ + weekly goals (weeks starting in month) + monthly goals
--  * Categories with nothing due are "not applicable": excluded, and the
--    remaining weights are normalised proportionally. No division by zero.
-- =============================================================================

create type public.period_type as enum ('daily', 'weekly', 'monthly');
create type public.perf_category as enum ('daily_todo', 'weekly_goals', 'prospecting', 'monthly_goals', 'additional_tasks');

create table public.performance_settings (
  id           boolean primary key default true check (id),
  w_daily      numeric(5, 2) not null default 30 check (w_daily between 0 and 100),
  w_weekly     numeric(5, 2) not null default 20 check (w_weekly between 0 and 100),
  w_prospecting numeric(5, 2) not null default 20 check (w_prospecting between 0 and 100),
  w_monthly    numeric(5, 2) not null default 20 check (w_monthly between 0 and 100),
  w_additional numeric(5, 2) not null default 10 check (w_additional between 0 and 100),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id),
  constraint performance_weights_total check (w_daily + w_weekly + w_prospecting + w_monthly + w_additional = 100)
);
insert into public.performance_settings (id) values (true);

create table public.performance_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id),
  period_type       public.period_type not null,
  period_start      date not null,
  period_end        date not null,
  overall_score     numeric(5, 2) check (overall_score between 0 and 100),
  weights           jsonb not null,
  version           int not null default 1,
  is_current        boolean not null default true,
  computed_at       timestamptz not null default now(),
  computed_by       uuid references public.profiles (id),
  correction_reason text check (correction_reason is null or char_length(correction_reason) <= 1000),
  superseded_at     timestamptz,
  constraint performance_snapshots_period check (period_end >= period_start)
);
create unique index performance_snapshots_current on public.performance_snapshots (user_id, period_type, period_start) where is_current;
create index performance_snapshots_period_idx on public.performance_snapshots (period_type, period_start) where is_current;
create index performance_snapshots_user_idx on public.performance_snapshots (user_id, period_type, period_start desc);

create table public.performance_category_scores (
  snapshot_id      uuid not null references public.performance_snapshots (id) on delete cascade,
  category         public.perf_category not null,
  applicable       boolean not null,
  completed        numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null default 0,
  raw_pct          numeric(9, 2),
  capped_pct       numeric(5, 2),
  weight           numeric(5, 2) not null,
  effective_weight numeric(7, 4) not null default 0,
  primary key (snapshot_id, category)
);

-- -----------------------------------------------------------------------------
create or replace function private.period_bounds(p_type public.period_type, p_date date, out p_start date, out p_end date)
language sql immutable as $$
  select case p_type when 'daily' then p_date
                     when 'weekly' then p_date - (extract(isodow from p_date)::int - 1)
                     else date_trunc('month', p_date)::date end,
         case p_type when 'daily' then p_date
                     when 'weekly' then p_date - (extract(isodow from p_date)::int - 1) + 6
                     else (date_trunc('month', p_date) + interval '1 month - 1 day')::date end;
$$;

create or replace function public.period_bounds(p_type public.period_type, p_date date, out p_start date, out p_end date)
language sql immutable as $$ select * from private.period_bounds(p_type, p_date); $$;

-- Pure calculation, no writes. Returns:
-- { overall, period_type, period_start, period_end, weights, categories: [ {category, applicable, completed, total, raw_pct, capped_pct, weight, effective_weight} ] }
create or replace function private.compute_performance(p_user uuid, p_type public.period_type, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s date; e date;
  w public.performance_settings;
  cats jsonb := '[]';
  v_total numeric; v_done numeric; v_raw numeric; v_cap numeric;
  v_wsum numeric := 0; v_score numeric := 0;
  rec record;
begin
  select b.p_start, b.p_end into s, e from private.period_bounds(p_type, p_date) b;
  select * into w from public.performance_settings where id;

  -- Daily to-do list -----------------------------------------------------------
  select count(*), count(*) filter (where status = 'completed') into v_total, v_done
    from public.tasks where owner_id = p_user and kind = 'daily' and deleted_at is null and due_date between s and e;
  cats := cats || jsonb_build_array(jsonb_build_object('category', 'daily_todo', 'weight', w.w_daily,
            'completed', v_done, 'total', v_total, 'applicable', v_total > 0,
            'raw_pct', case when v_total > 0 then round(v_done / v_total * 100, 2) end,
            'capped_pct', case when v_total > 0 then round(v_done / v_total * 100, 2) end));

  -- Additional tasks ------------------------------------------------------------
  select count(*), count(*) filter (where status = 'completed') into v_total, v_done
    from public.tasks where owner_id = p_user and kind = 'additional' and deleted_at is null and due_date between s and e;
  cats := cats || jsonb_build_array(jsonb_build_object('category', 'additional_tasks', 'weight', w.w_additional,
            'completed', v_done, 'total', v_total, 'applicable', v_total > 0,
            'raw_pct', case when v_total > 0 then round(v_done / v_total * 100, 2) end,
            'capped_pct', case when v_total > 0 then round(v_done / v_total * 100, 2) end));

  -- Weekly goals (weekly + monthly periods) ------------------------------------
  if p_type = 'daily' then
    cats := cats || jsonb_build_array(jsonb_build_object('category', 'weekly_goals', 'weight', w.w_weekly,
              'completed', 0, 'total', 0, 'applicable', false, 'raw_pct', null, 'capped_pct', null));
  else
    select count(*), count(*) filter (where achieved >= target),
           avg(achieved / target) * 100, avg(least(achieved / target, 1)) * 100
      into v_total, v_done, v_raw, v_cap
      from public.weekly_goals where owner_id = p_user and deleted_at is null and week_start between s and e;
    cats := cats || jsonb_build_array(jsonb_build_object('category', 'weekly_goals', 'weight', w.w_weekly,
              'completed', v_done, 'total', v_total, 'applicable', v_total > 0,
              'raw_pct', round(v_raw, 2), 'capped_pct', round(v_cap, 2)));
  end if;

  -- Monthly goals (monthly period only) ----------------------------------------
  if p_type = 'monthly' then
    select count(*), count(*) filter (where achieved >= target),
           avg(achieved / target) * 100, avg(least(achieved / target, 1)) * 100
      into v_total, v_done, v_raw, v_cap
      from public.monthly_goals where owner_id = p_user and deleted_at is null and month_start = s;
    cats := cats || jsonb_build_array(jsonb_build_object('category', 'monthly_goals', 'weight', w.w_monthly,
              'completed', v_done, 'total', v_total, 'applicable', v_total > 0,
              'raw_pct', round(v_raw, 2), 'capped_pct', round(v_cap, 2)));
  else
    cats := cats || jsonb_build_array(jsonb_build_object('category', 'monthly_goals', 'weight', w.w_monthly,
              'completed', 0, 'total', 0, 'applicable', false, 'raw_pct', null, 'capped_pct', null));
  end if;

  -- Prospecting ----------------------------------------------------------------
  -- Target per activity: daily → that day's daily target.
  -- weekly/monthly → for each week starting in range, the weekly target if set,
  -- otherwise the sum of daily targets in that week (never both: no double count).
  with targets as (
    select t.activity, sum(t.target)::numeric as target
      from public.prospecting_targets t
     where t.owner_id = p_user and (
           (p_type = 'daily' and t.period = 'daily' and t.period_start = s)
        or (p_type <> 'daily' and t.period = 'weekly' and t.period_start between s - 6 and e
              and t.period_start + 6 >= s and (p_type = 'weekly' or t.period_start >= s))
        or (p_type <> 'daily' and t.period = 'daily' and t.period_start between s and e
              and not exists (select 1 from public.prospecting_targets wt
                               where wt.owner_id = p_user and wt.activity = t.activity and wt.period = 'weekly'
                                 and wt.period_start = t.period_start - (extract(isodow from t.period_start)::int - 1)
                                 and (p_type = 'weekly' or wt.period_start >= s))))
     group by t.activity),
  actuals as (
    select a.activity, sum(a.quantity)::numeric as actual
      from public.prospecting_activities a
     where a.owner_id = p_user and a.occurred_on between s and e
     group by a.activity)
  select coalesce(sum(t.target), 0), coalesce(sum(least(coalesce(a.actual, 0), t.target)), 0),
         coalesce(sum(coalesce(a.actual, 0)), 0)
    into v_total, v_cap, v_raw
    from targets t left join actuals a using (activity);
  cats := cats || jsonb_build_array(jsonb_build_object('category', 'prospecting', 'weight', w.w_prospecting,
            'completed', v_raw, 'total', v_total, 'applicable', v_total > 0,
            'raw_pct', case when v_total > 0 then round(v_raw / v_total * 100, 2) end,
            'capped_pct', case when v_total > 0 then round(v_cap / v_total * 100, 2) end));

  -- Weighted overall with proportional normalisation ---------------------------
  for rec in select value as c from jsonb_array_elements(cats) loop
    if (rec.c ->> 'applicable')::boolean and (rec.c ->> 'weight')::numeric > 0 then
      v_wsum := v_wsum + (rec.c ->> 'weight')::numeric;
      v_score := v_score + (rec.c ->> 'weight')::numeric * (rec.c ->> 'capped_pct')::numeric;
    end if;
  end loop;

  select jsonb_agg(c || jsonb_build_object('effective_weight',
           case when (c ->> 'applicable')::boolean and v_wsum > 0 then round((c ->> 'weight')::numeric / v_wsum * 100, 4) else 0 end))
    into cats from jsonb_array_elements(cats) c;

  return jsonb_build_object(
    'user_id', p_user, 'period_type', p_type, 'period_start', s, 'period_end', e,
    'overall', case when v_wsum > 0 then round(v_score / v_wsum, 2) end,
    'weights', jsonb_build_object('daily_todo', w.w_daily, 'weekly_goals', w.w_weekly, 'prospecting', w.w_prospecting,
                                  'monthly_goals', w.w_monthly, 'additional_tasks', w.w_additional),
    'categories', cats);
end $$;
revoke execute on function private.compute_performance(uuid, public.period_type, date) from public, authenticated;

-- Live performance for a user the caller is allowed to see.
create or replace function public.get_performance(p_user uuid, p_type public.period_type, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view_user(p_user), 'Not authorised to view this performance record');
  return private.compute_performance(p_user, p_type, coalesce(p_date, private.org_today()));
end $$;

-- Record (or re-record, as a new version) a snapshot. Previous versions are kept.
create or replace function private.record_snapshot(p_user uuid, p_type public.period_type, p_date date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_id uuid; v_prev public.performance_snapshots; c jsonb;
begin
  v := private.compute_performance(p_user, p_type, p_date);
  select * into v_prev from public.performance_snapshots
   where user_id = p_user and period_type = p_type and period_start = (v ->> 'period_start')::date and is_current
   for update;
  if found then
    update public.performance_snapshots set is_current = false, superseded_at = now() where id = v_prev.id;
  end if;
  insert into public.performance_snapshots (user_id, period_type, period_start, period_end, overall_score, weights,
                                            version, computed_by, correction_reason)
  values (p_user, p_type, (v ->> 'period_start')::date, (v ->> 'period_end')::date, (v ->> 'overall')::numeric,
          v -> 'weights', coalesce(v_prev.version, 0) + 1, (select auth.uid()), p_reason)
  returning id into v_id;
  for c in select * from jsonb_array_elements(v -> 'categories') loop
    insert into public.performance_category_scores (snapshot_id, category, applicable, completed, total, raw_pct, capped_pct, weight, effective_weight)
    values (v_id, (c ->> 'category')::public.perf_category, (c ->> 'applicable')::boolean,
            coalesce((c ->> 'completed')::numeric, 0), coalesce((c ->> 'total')::numeric, 0),
            (c ->> 'raw_pct')::numeric, (c ->> 'capped_pct')::numeric, (c ->> 'weight')::numeric,
            coalesce((c ->> 'effective_weight')::numeric, 0));
  end loop;
  return v_id;
end $$;
revoke execute on function private.record_snapshot(uuid, public.period_type, date, text) from public, authenticated;

-- Super Admin: traceable correction — recompute a closed period as a new
-- snapshot version with a mandatory reason.
create or replace function public.correct_performance(p_user uuid, p_type public.period_type, p_date date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_old numeric; v_id uuid; v_new numeric; s date;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can correct performance records');
  perform private.require(char_length(coalesce(p_reason, '')) between 5 and 1000, 'A correction reason (5–1000 characters) is required');
  select b.p_start into s from private.period_bounds(p_type, p_date) b;
  select overall_score into v_old from public.performance_snapshots
   where user_id = p_user and period_type = p_type and period_start = s and is_current;
  v_id := private.record_snapshot(p_user, p_type, p_date, p_reason);
  select overall_score into v_new from public.performance_snapshots where id = v_id;
  perform private.audit('performance.corrected', 'performance_snapshot', v_id::text, p_user,
    jsonb_build_object('overall_score', v_old), jsonb_build_object('overall_score', v_new),
    'success', jsonb_build_object('period_type', p_type, 'period_start', s, 'reason', p_reason));
  return v_id;
end $$;

-- Super Admin: update the weights (validated to total 100 by constraint).
create or replace function public.update_performance_weights(
  p_daily numeric, p_weekly numeric, p_prospecting numeric, p_monthly numeric, p_additional numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can configure performance weights');
  perform private.require(p_daily + p_weekly + p_prospecting + p_monthly + p_additional = 100, 'Weights must total exactly 100%');
  select to_jsonb(s) into v_old from public.performance_settings s where id;
  update public.performance_settings set w_daily = p_daily, w_weekly = p_weekly, w_prospecting = p_prospecting,
         w_monthly = p_monthly, w_additional = p_additional, updated_at = now(), updated_by = (select auth.uid()) where id;
  perform private.audit('settings.performance_weights', 'performance_settings', 'singleton', null, v_old,
    jsonb_build_object('w_daily', p_daily, 'w_weekly', p_weekly, 'w_prospecting', p_prospecting, 'w_monthly', p_monthly, 'w_additional', p_additional));
end $$;

-- Team / organisation performance overview for the caller's visible members.
-- Super Admin: all active team members (optionally one administrator's team);
-- Administrator: only currently assigned members.
create or replace function public.team_performance(p_type public.period_type, p_date date default null, p_admin uuid default null)
returns table (user_id uuid, full_name text, job_title text, administrator_id uuid, administrator_name text,
               overall numeric, categories jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_date date := coalesce(p_date, private.org_today()); v_perf jsonb; r record;
begin
  perform private.require(private.is_staff(), 'Not authorised');
  for r in
    select p.id, p.full_name, p.job_title, a.administrator_id, ap.full_name as admin_name
      from public.profiles p
      left join public.admin_assignments a on a.member_id = p.id and a.ended_at is null
      left join public.profiles ap on ap.id = a.administrator_id
     where p.role = 'team_member' and p.status = 'approved'
       and (case when private.is_super_admin() then (p_admin is null or a.administrator_id = p_admin)
                 else a.administrator_id = (select auth.uid()) end)
     order by p.full_name
  loop
    v_perf := private.compute_performance(r.id, p_type, v_date);
    user_id := r.id; full_name := r.full_name; job_title := r.job_title;
    administrator_id := r.administrator_id; administrator_name := r.admin_name;
    overall := (v_perf ->> 'overall')::numeric; categories := v_perf -> 'categories';
    return next;
  end loop;
end $$;

-- Historical trend for one user from recorded snapshots.
create or replace function public.performance_history(p_user uuid, p_type public.period_type, p_limit int default 12)
returns table (period_start date, period_end date, overall_score numeric, version int, categories jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view_user(p_user), 'Not authorised');
  return query
    select s.period_start, s.period_end, s.overall_score, s.version,
           (select jsonb_object_agg(c.category, c.capped_pct) from public.performance_category_scores c where c.snapshot_id = s.id)
      from public.performance_snapshots s
     where s.user_id = p_user and s.period_type = p_type and s.is_current
     order by s.period_start desc limit least(greatest(p_limit, 1), 104);
end $$;

-- Administrator comparison for the Super Admin (average of recorded snapshots
-- in a range, plus team size).
create or replace function public.administrator_comparison(p_type public.period_type, p_from date, p_to date)
returns table (administrator_id uuid, administrator_name text, members bigint, avg_score numeric, snapshots bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Not authorised');
  return query
    select ap.id, ap.full_name,
           (select count(*) from public.admin_assignments a2 join public.profiles m on m.id = a2.member_id
             where a2.administrator_id = ap.id and a2.ended_at is null and m.status = 'approved'),
           round(avg(s.overall_score), 2), count(s.id)
      from public.profiles ap
      left join public.admin_assignments a on a.administrator_id = ap.id and a.ended_at is null
      left join public.performance_snapshots s on s.user_id = a.member_id and s.is_current
           and s.period_type = p_type and s.period_start between p_from and p_to
     where ap.role = 'administrator' and ap.status = 'approved'
     group by ap.id, ap.full_name order by ap.full_name;
end $$;

-- -----------------------------------------------------------------------------
alter table public.performance_settings enable row level security;
alter table public.performance_snapshots enable row level security;
alter table public.performance_category_scores enable row level security;

create policy performance_settings_read on public.performance_settings for select to authenticated using (private.is_active_user());
create policy performance_snapshots_read on public.performance_snapshots for select to authenticated using (private.can_view_user(user_id));
create policy performance_category_scores_read on public.performance_category_scores for select to authenticated
  using (exists (select 1 from public.performance_snapshots s where s.id = snapshot_id and private.can_view_user(s.user_id)));

-- >>> 20261122000500_accountability.sql
-- =============================================================================
-- WINNERS TEAM — 0005 Accountability & spin-wheel engine
--
-- Business rules enforced in the database:
--  * EXACTLY four consequence categories exist (enum). No fifth category can be
--    created through any UI, including the Super Admin sector editor.
--  * Limits: frog jumps 10–400, leg raising 10–60 min, office signatures 1–10,
--    financial fine ₦200–₦5,000 (currency always NGN).
--  * Selection is done server-side with a cryptographically secure RNG.
--  * One result per accountability event (unique), no rerolls.
--  * The selected consequence is assigned IMMEDIATELY. There is no approval,
--    sign-off or peer-verification gate anywhere in the flow.
--  * Physical accommodation (user-controlled, no approval) excludes frog jumps
--    and leg raising from the eligible pool.
--  * Fines are recorded only — nothing is ever deducted automatically.
-- =============================================================================

create type public.consequence_category as enum ('frog_jumps', 'leg_raising', 'office_signatures', 'financial_fine');
create type public.accountability_level as enum ('none', 'low', 'moderate', 'high');
create type public.ledger_status as enum ('assigned', 'in_progress', 'completed');

create or replace function private.consequence_in_range(p_cat public.consequence_category, p_qty numeric)
returns boolean language sql immutable as $$
  select p_qty = trunc(p_qty) and case p_cat
    when 'frog_jumps'        then p_qty between 10 and 400
    when 'leg_raising'       then p_qty between 10 and 60
    when 'office_signatures' then p_qty between 1 and 10
    when 'financial_fine'    then p_qty between 200 and 5000
  end;
$$;

create or replace function public.consequence_unit(p_cat public.consequence_category)
returns text language sql immutable as $$
  select case p_cat when 'frog_jumps' then 'jumps' when 'leg_raising' then 'minutes'
                    when 'office_signatures' then 'offices' when 'financial_fine' then 'NGN' end;
$$;

create table public.accountability_settings (
  id                    boolean primary key default true check (id),
  enabled               boolean not null default true,
  -- Achievement ≥ threshold_none → no consequence; ≥ threshold_low → low;
  -- ≥ threshold_moderate → moderate; below → high. Strictly ordered: no gaps/overlap.
  threshold_none        numeric(5, 2) not null default 90,
  threshold_low         numeric(5, 2) not null default 75,
  threshold_moderate    numeric(5, 2) not null default 50,
  evaluate_daily        boolean not null default true,
  evaluate_weekly       boolean not null default true,
  evaluate_monthly      boolean not null default true,
  auto_draw_after_hours int not null default 24 check (auto_draw_after_hours between 1 and 168),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id),
  constraint accountability_thresholds_order check (
    0 < threshold_moderate and threshold_moderate < threshold_low and threshold_low < threshold_none and threshold_none <= 100)
);
insert into public.accountability_settings (id) values (true);

create table public.accountability_options (
  id         uuid primary key default gen_random_uuid(),
  category   public.consequence_category not null,
  quantity   numeric(10, 2) not null,
  levels     public.accountability_level[] not null default '{low,moderate,high}',
  applies_to public.perf_category[] not null default '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}',
  weight     int not null default 10 check (weight between 1 and 100),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint accountability_options_range check (private.consequence_in_range(category, quantity)),
  constraint accountability_options_levels check (cardinality(levels) > 0 and not ('none' = any (levels))),
  constraint accountability_options_applies check (cardinality(applies_to) > 0),
  constraint accountability_options_unique unique (category, quantity)
);

create table public.accountability_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id),
  period_type         public.period_type not null,
  period_start        date not null,
  period_end          date not null,
  snapshot_id         uuid references public.performance_snapshots (id),
  performance_pct     numeric(5, 2) not null,
  level               public.accountability_level not null check (level <> 'none'),
  triggering_category public.perf_category not null,
  category_pct        numeric(5, 2),
  created_at          timestamptz not null default now(),
  constraint accountability_events_once unique (user_id, period_type, period_start)
);
create index accountability_events_user_idx on public.accountability_events (user_id, created_at desc);

create table public.accountability_ledger (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null unique references public.accountability_events (id),
  user_id              uuid not null references public.profiles (id),
  option_id            uuid references public.accountability_options (id) on delete set null,
  category             public.consequence_category not null,
  quantity             numeric(10, 2) not null,
  unit                 text not null,
  currency             char(3),
  accommodation_active boolean not null default false,
  pool                 jsonb not null,
  winning_index        int not null,
  selected_by          text not null check (selected_by in ('user_spin', 'system_auto')),
  assigned_at          timestamptz not null default now(),
  revealed_at          timestamptz,
  status               public.ledger_status not null default 'assigned',
  completed_at         timestamptz,
  completion_note      text check (completion_note is null or char_length(completion_note) <= 1000),
  updated_at           timestamptz not null default now(),
  constraint accountability_ledger_range check (private.consequence_in_range(category, quantity)),
  constraint accountability_ledger_currency check (
    (category = 'financial_fine' and currency = 'NGN') or (category <> 'financial_fine' and currency is null)),
  constraint accountability_ledger_accommodation check (
    not accommodation_active or category in ('office_signatures', 'financial_fine'))
);
create index accountability_ledger_user_idx on public.accountability_ledger (user_id, assigned_at desc);
create index accountability_ledger_status_idx on public.accountability_ledger (status, assigned_at desc);

create table public.accommodation_changes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id),
  enabled    boolean not null,
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index accommodation_changes_user_idx on public.accommodation_changes (user_id, created_at desc);

-- -----------------------------------------------------------------------------
create or replace function private.level_for(p_score numeric)
returns public.accountability_level language sql stable security definer set search_path = '' as $$
  select case when p_score is null then 'none'::public.accountability_level
              when p_score >= s.threshold_none then 'none'
              when p_score >= s.threshold_low then 'low'
              when p_score >= s.threshold_moderate then 'moderate'
              else 'high' end
    from public.accountability_settings s where s.id;
$$;

-- Cryptographically secure uniform integer in [0, p_max).
create or replace function private.secure_random_int(p_max bigint)
returns bigint language sql volatile security definer set search_path = '' as $$
  select (('x' || encode(extensions.gen_random_bytes(7), 'hex'))::bit(56)::bigint) % p_max;
$$;

-- Build the eligible pool for an event (respects level, triggering category
-- and the user's CURRENT physical accommodation setting).
create or replace function private.eligible_pool(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ev public.accountability_events; v_acc boolean; v_pool jsonb;
begin
  select * into v_ev from public.accountability_events where id = p_event;
  select physical_accommodation into v_acc from public.profiles where id = v_ev.user_id;

  -- 1st choice: options matching level AND triggering category.
  -- Fallbacks widen the match (never the category list or quantity limits).
  for i in 1..3 loop
    select jsonb_agg(jsonb_build_object('option_id', o.id, 'category', o.category, 'quantity', o.quantity,
                                        'unit', public.consequence_unit(o.category), 'weight', o.weight)
                     order by o.category, o.quantity)
      into v_pool
      from public.accountability_options o
     where o.active
       and (not v_acc or o.category in ('office_signatures', 'financial_fine'))
       and (i = 3 or v_ev.level = any (o.levels))
       and (i >= 2 or v_ev.triggering_category = any (o.applies_to));
    exit when v_pool is not null;
  end loop;
  return jsonb_build_object('accommodation', coalesce(v_acc, false), 'sectors', coalesce(v_pool, '[]'));
end $$;

-- Perform the draw. Idempotent: an existing ledger row is returned unchanged.
create or replace function private.draw_for_event(p_event uuid, p_selected_by text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.accountability_events; v_existing uuid; v_pool jsonb; v_sectors jsonb;
  v_total bigint := 0; v_pick bigint; v_acc bigint := 0; v_idx int := -1; v_choice jsonb; v_id uuid; i int;
  v_admin uuid; v_label text;
begin
  select * into v_ev from public.accountability_events where id = p_event for update;
  if not found then raise exception 'Accountability event not found'; end if;
  select id into v_existing from public.accountability_ledger where event_id = p_event;
  if v_existing is not null then return v_existing; end if;

  v_pool := private.eligible_pool(p_event);
  v_sectors := v_pool -> 'sectors';
  if jsonb_array_length(v_sectors) = 0 then
    perform private.notify_super_admins('accountability', 'accountability.no_options',
      'Accountability wheel has no active options', 'An event could not be drawn because no eligible options are active.',
      '/settings/accountability', jsonb_build_object('event_id', p_event), 'no-options:' || p_event);
    raise exception 'No eligible accountability options are active' using errcode = 'P0001';
  end if;

  select coalesce(sum((s ->> 'weight')::bigint), 0) into v_total from jsonb_array_elements(v_sectors) s;
  v_pick := private.secure_random_int(v_total);
  for i in 0 .. jsonb_array_length(v_sectors) - 1 loop
    v_acc := v_acc + (v_sectors -> i ->> 'weight')::bigint;
    if v_pick < v_acc then v_idx := i; exit; end if;
  end loop;
  v_choice := v_sectors -> v_idx;

  insert into public.accountability_ledger (event_id, user_id, option_id, category, quantity, unit, currency,
                                            accommodation_active, pool, winning_index, selected_by,
                                            revealed_at)
  values (p_event, v_ev.user_id, (v_choice ->> 'option_id')::uuid, (v_choice ->> 'category')::public.consequence_category,
          (v_choice ->> 'quantity')::numeric, v_choice ->> 'unit',
          case when v_choice ->> 'category' = 'financial_fine' then 'NGN' end,
          (v_pool ->> 'accommodation')::boolean, v_sectors, v_idx, p_selected_by,
          case when p_selected_by = 'user_spin' then now() end)
  returning id into v_id;

  v_label := case v_choice ->> 'category'
    when 'frog_jumps' then (v_choice ->> 'quantity')::numeric::int || ' frog jumps'
    when 'leg_raising' then (v_choice ->> 'quantity')::numeric::int || ' minutes of leg raising'
    when 'office_signatures' then 'collect signatures from ' || (v_choice ->> 'quantity')::numeric::int || ' other office(s)'
    else '₦' || to_char((v_choice ->> 'quantity')::numeric, 'FM999,999') || ' financial fine' end;

  perform private.audit('accountability.selected', 'accountability_ledger', v_id::text, v_ev.user_id, null,
    jsonb_build_object('category', v_choice ->> 'category', 'quantity', (v_choice ->> 'quantity')::numeric,
                       'event_id', p_event, 'level', v_ev.level, 'accommodation', (v_pool ->> 'accommodation')::boolean),
    'success', jsonb_build_object('selected_by', p_selected_by, 'pool_size', jsonb_array_length(v_sectors)));

  perform private.notify(v_ev.user_id, 'accountability', 'accountability.assigned',
    'Accountability assigned: ' || v_label,
    'Your ' || v_ev.period_type || ' performance was ' || v_ev.performance_pct || '%. The outcome is active now — open Accountability to track completion.',
    '/accountability', jsonb_build_object('ledger_id', v_id), 'ledger:' || v_id);
  v_admin := private.current_admin_of(v_ev.user_id);
  if v_admin is not null then
    perform private.notify(v_admin, 'accountability', 'accountability.member_assigned',
      (select full_name from public.profiles where id = v_ev.user_id) || ': ' || v_label,
      'Selected automatically for ' || v_ev.period_type || ' performance of ' || v_ev.performance_pct || '%.',
      '/team/' || v_ev.user_id, jsonb_build_object('ledger_id', v_id), 'ledger-admin:' || v_id);
  end if;
  return v_id;
end $$;
revoke execute on function private.draw_for_event(uuid, text) from public, authenticated;

-- Evaluate one user for one closed period: snapshot + (if needed) event.
create or replace function private.evaluate_period(p_user uuid, p_type public.period_type, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_snap uuid; v_score numeric; v_level public.accountability_level; v_trig record; v_event uuid;
  s date; e date; v_set public.accountability_settings;
begin
  select b.p_start, b.p_end into s, e from private.period_bounds(p_type, p_date) b;
  -- Never evaluate an open period.
  if e >= private.org_today() then return null; end if;
  if exists (select 1 from public.accountability_events where user_id = p_user and period_type = p_type and period_start = s) then
    return null;
  end if;

  select id into v_snap from public.performance_snapshots where user_id = p_user and period_type = p_type and period_start = s and is_current;
  if v_snap is null then v_snap := private.record_snapshot(p_user, p_type, p_date, null); end if;
  select overall_score into v_score from public.performance_snapshots where id = v_snap;

  select * into v_set from public.accountability_settings where id;
  if not v_set.enabled
     or (p_type = 'daily' and not v_set.evaluate_daily)
     or (p_type = 'weekly' and not v_set.evaluate_weekly)
     or (p_type = 'monthly' and not v_set.evaluate_monthly) then
    return null;
  end if;

  v_level := private.level_for(v_score);
  if v_level = 'none' then return null; end if;

  -- Triggering category = the applicable category with the lowest score,
  -- daily to-do first on ties (frog jumps are primarily associated with it).
  select category, capped_pct into v_trig from public.performance_category_scores
   where snapshot_id = v_snap and applicable
   order by capped_pct asc, (category = 'daily_todo') desc, effective_weight desc limit 1;

  insert into public.accountability_events (user_id, period_type, period_start, period_end, snapshot_id,
                                            performance_pct, level, triggering_category, category_pct)
  values (p_user, p_type, s, e, v_snap, v_score, v_level, v_trig.category, v_trig.capped_pct)
  on conflict (user_id, period_type, period_start) do nothing
  returning id into v_event;

  if v_event is not null then
    perform private.audit('accountability.triggered', 'accountability_event', v_event::text, p_user, null,
      jsonb_build_object('period_type', p_type, 'period_start', s, 'score', v_score, 'level', v_level, 'trigger', v_trig.category));
    perform private.notify(p_user, 'accountability', 'accountability.triggered',
      'Accountability spin ready (' || p_type || ')',
      'Your ' || p_type || ' achievement was ' || v_score || '% (' || v_level || ' level). Spin the wheel to reveal your outcome.',
      '/accountability', jsonb_build_object('event_id', v_event), 'event:' || v_event);
  end if;
  return v_event;
end $$;
revoke execute on function private.evaluate_period(uuid, public.period_type, date) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- The wheel the user will see before spinning (current eligible pool).
create or replace function public.get_wheel(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid; v_ledger public.accountability_ledger;
begin
  select user_id into v_user from public.accountability_events where id = p_event;
  perform private.require(v_user is not null and private.can_view_user(v_user), 'Not authorised');
  select * into v_ledger from public.accountability_ledger where event_id = p_event;
  if found then
    return jsonb_build_object('drawn', true, 'accommodation', v_ledger.accommodation_active, 'sectors', v_ledger.pool,
                              'winning_index', v_ledger.winning_index, 'ledger_id', v_ledger.id);
  end if;
  return private.eligible_pool(p_event) || jsonb_build_object('drawn', false);
end $$;

-- The owner spins: the backend selects, records and assigns in one transaction.
-- Calling again returns the SAME result (no rerolls).
create or replace function public.spin_accountability(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_id uuid; v_l public.accountability_ledger;
begin
  select user_id into v_user from public.accountability_events where id = p_event;
  perform private.require(v_user is not null and v_user = (select auth.uid()) and private.is_active_user(),
    'Only the team member this event belongs to can spin the wheel');
  v_id := private.draw_for_event(p_event, 'user_spin');
  update public.accountability_ledger set revealed_at = coalesce(revealed_at, now()) where id = v_id;
  select * into v_l from public.accountability_ledger where id = v_id;
  return jsonb_build_object('ledger_id', v_l.id, 'category', v_l.category, 'quantity', v_l.quantity, 'unit', v_l.unit,
                            'currency', v_l.currency, 'winning_index', v_l.winning_index, 'sectors', v_l.pool,
                            'accommodation', v_l.accommodation_active, 'status', v_l.status, 'assigned_at', v_l.assigned_at);
end $$;

-- Completion tracking (owner, their current admin or the Super Admin).
create or replace function public.update_ledger_status(p_ledger uuid, p_status public.ledger_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_l public.accountability_ledger;
begin
  select * into v_l from public.accountability_ledger where id = p_ledger for update;
  perform private.require(found and (private.is_owner_active(v_l.user_id) or private.is_super_admin() or private.is_assigned_admin_of(v_l.user_id)),
    'Not authorised to update this accountability record');
  perform private.require(p_note is null or char_length(p_note) <= 1000, 'Note is too long');
  update public.accountability_ledger set status = p_status, completion_note = coalesce(p_note, completion_note),
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
         updated_at = now()
   where id = p_ledger;
  perform private.audit(case when p_status = 'completed' then 'accountability.completed' else 'accountability.status_changed' end,
    'accountability_ledger', p_ledger::text, v_l.user_id, jsonb_build_object('status', v_l.status),
    jsonb_build_object('status', p_status, 'note', p_note));
end $$;

-- User-controlled physical accommodation (takes effect immediately, no approval).
create or replace function public.set_physical_accommodation(p_enabled boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old boolean;
begin
  perform private.require(private.is_active_user(), 'Not authorised');
  select physical_accommodation into v_old from public.profiles where id = (select auth.uid());
  if v_old = p_enabled then return; end if;
  update public.profiles set physical_accommodation = p_enabled where id = (select auth.uid());
  insert into public.accommodation_changes (user_id, enabled, note) values ((select auth.uid()), p_enabled, left(p_note, 500));
  insert into public.profile_change_log (profile_id, changed_by, section, changes)
  values ((select auth.uid()), (select auth.uid()), 'accommodation',
          jsonb_build_object('physical_accommodation', jsonb_build_object('old', v_old, 'new', p_enabled)));
  perform private.audit('accountability.accommodation_changed', 'profile', (select auth.uid())::text, (select auth.uid()),
    jsonb_build_object('physical_accommodation', v_old), jsonb_build_object('physical_accommodation', p_enabled),
    'success', jsonb_build_object('note', p_note));
end $$;

-- Super Admin: thresholds & cadence.
create or replace function public.update_accountability_settings(
  p_enabled boolean, p_none numeric, p_low numeric, p_moderate numeric,
  p_daily boolean, p_weekly boolean, p_monthly boolean, p_auto_draw_hours int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can configure accountability');
  select to_jsonb(s) into v_old from public.accountability_settings s where id;
  update public.accountability_settings set enabled = p_enabled, threshold_none = p_none, threshold_low = p_low,
         threshold_moderate = p_moderate, evaluate_daily = p_daily, evaluate_weekly = p_weekly, evaluate_monthly = p_monthly,
         auto_draw_after_hours = p_auto_draw_hours, updated_at = now(), updated_by = (select auth.uid())
   where id;
  perform private.audit('settings.accountability', 'accountability_settings', 'singleton', null, v_old,
    (select to_jsonb(s) from public.accountability_settings s where id));
end $$;

-- Audit trail for the sector editor.
create or replace function private.accountability_options_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit('settings.accountability_option_deleted', 'accountability_option', old.id::text, null, to_jsonb(old), null);
    return old;
  end if;
  new.updated_at := now(); new.updated_by := (select auth.uid());
  perform private.audit(case when tg_op = 'INSERT' then 'settings.accountability_option_created' else 'settings.accountability_option_updated' end,
    'accountability_option', new.id::text, null, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger accountability_options_audit before insert or update or delete on public.accountability_options
  for each row execute function private.accountability_options_audit();

-- -----------------------------------------------------------------------------
alter table public.accountability_settings enable row level security;
alter table public.accountability_options enable row level security;
alter table public.accountability_events enable row level security;
alter table public.accountability_ledger enable row level security;
alter table public.accommodation_changes enable row level security;

create policy accountability_settings_read on public.accountability_settings for select to authenticated using (private.is_active_user());
create policy accountability_options_read on public.accountability_options for select to authenticated using (private.is_active_user());
create policy accountability_options_write on public.accountability_options for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
create policy accountability_events_read on public.accountability_events for select to authenticated using (private.can_view_user(user_id));
create policy accountability_ledger_read on public.accountability_ledger for select to authenticated using (private.can_view_user(user_id));
create policy accommodation_changes_read on public.accommodation_changes for select to authenticated using (private.can_view_user(user_id));

-- >>> 20261122000600_growth_updates_lex.sql
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

-- >>> 20261122000700_scheduling_storage.sql
-- =============================================================================
-- WINNERS TEAM — 0007 Scheduled processing (reminders, evaluations, auto-draw)
-- and Supabase Storage buckets/policies.
--
-- Everything is implemented as idempotent SQL functions so it can be driven by
-- Vercel Cron (via the /api/cron/* routes using the service role) OR directly
-- by pg_cron inside Supabase. Duplicate delivery is prevented with dedupe keys.
-- =============================================================================

create table public.reminder_schedules (
  kind        text primary key check (kind in ('daily_plan', 'pending_tasks', 'overdue_tasks', 'weekly_goals',
                                               'weekly_progress', 'prospecting', 'monthly_goals', 'monthly_progress',
                                               'goal_deadlines', 'performance_summary')),
  label       text not null,
  enabled     boolean not null default true,
  local_time  time not null,
  weekday     int check (weekday between 1 and 7),       -- ISO weekday, null = every day
  monthday    int check (monthday between -3 and 28),    -- 1..28, or -1..-3 = days before month end; null = any
  last_run_on date,
  updated_at  timestamptz not null default now()
);

insert into public.reminder_schedules (kind, label, local_time, weekday, monthday) values
  ('performance_summary', 'Yesterday''s performance summary',        '07:30', null, null),
  ('daily_plan',          'Plan your daily to-do list',               '08:00', null, null),
  ('weekly_goals',        'Set this week''s goals (Monday)',          '08:30', 1,    null),
  ('monthly_goals',       'Set this month''s goals (1st)',            '09:00', null, 1),
  ('prospecting',         'Prospecting target check-in',              '11:00', null, null),
  ('pending_tasks',       'Pending tasks reminder',                   '15:00', null, null),
  ('goal_deadlines',      'Approaching goal deadlines',               '16:00', null, null),
  ('overdue_tasks',       'Overdue task alert',                       '17:30', null, null),
  ('weekly_progress',     'Weekly goal progress (Friday)',            '12:00', 5,    null),
  ('monthly_progress',    'Monthly goal progress (3 days to go)',     '12:30', null, -3);

create trigger reminder_schedules_touch before update on public.reminder_schedules
  for each row execute function private.touch_updated_at();

create or replace function private.reminder_due(r public.reminder_schedules, p_now timestamp)
returns boolean language sql immutable as $$
  select r.enabled
     and (r.last_run_on is null or r.last_run_on < p_now::date)
     and p_now::time >= r.local_time
     and (r.weekday is null or extract(isodow from p_now)::int = r.weekday)
     and (r.monthday is null
          or (r.monthday > 0 and extract(day from p_now)::int = r.monthday)
          or (r.monthday < 0 and p_now::date = (date_trunc('month', p_now) + interval '1 month')::date + r.monthday));
$$;

-- Generate due reminders. p_force_kind lets the Super Admin send one now.
create or replace function private.run_reminders(p_force_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone private.org_tz();
  v_today date := v_now::date;
  v_week date := v_today - (extract(isodow from v_today)::int - 1);
  v_month date := date_trunc('month', v_today)::date;
  r public.reminder_schedules; m record; v_sent int; v_out jsonb := '{}'; v_n int; v_perf jsonb;
begin
  for r in select * from public.reminder_schedules order by local_time loop
    if not (r.kind = p_force_kind or (p_force_kind is null and private.reminder_due(r, v_now))) then continue; end if;
    v_sent := 0;
    for m in select p.id, p.full_name from public.profiles p where p.role = 'team_member' and p.status = 'approved' loop
      if r.kind = 'daily_plan' then
        select count(*) into v_n from public.tasks where owner_id = m.id and kind = 'daily' and due_date = v_today and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.daily_plan',
          case when v_n = 0 then 'Plan today''s to-do list' else 'You have ' || v_n || ' task(s) planned today' end,
          case when v_n = 0 then 'You have not added any daily tasks yet. Your daily to-do list carries the largest performance weight.'
               else 'Stay focused — complete them before the end of the day.' end,
          '/tasks', '{}', 'daily_plan:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'pending_tasks' then
        select count(*) into v_n from public.tasks where owner_id = m.id and due_date = v_today and deleted_at is null and status <> 'completed';
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.pending_tasks', v_n || ' task(s) still pending today',
            'Wrap them up before the day closes — closed days are locked for evaluation.', '/tasks', '{}', 'pending_tasks:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'overdue_tasks' then
        select count(*) into v_n from public.tasks where owner_id = m.id and due_date = v_today and due_time is not null
           and due_time < v_now::time and deleted_at is null and status <> 'completed';
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.overdue_tasks', v_n || ' task(s) are past their due time',
            'These tasks are overdue. Complete them today to protect your daily score.', '/tasks?filter=overdue', '{}', 'overdue_tasks:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'weekly_goals' then
        select count(*) into v_n from public.weekly_goals where owner_id = m.id and week_start = v_week and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.weekly_goals',
          case when v_n = 0 then 'Set your weekly goals' else 'New week — review your ' || v_n || ' weekly goal(s)' end,
          'Weekly goals carry 20% of your performance by default.', '/weekly-goals', '{}', 'weekly_goals:' || v_week);
        v_sent := v_sent + 1;
      elsif r.kind = 'weekly_progress' then
        select count(*) into v_n from public.weekly_goals where owner_id = m.id and week_start = v_week and deleted_at is null and achieved < target;
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.weekly_progress', v_n || ' weekly goal(s) not yet achieved',
            'Update your progress before the week closes.', '/weekly-goals', '{}', 'weekly_progress:' || v_week);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'monthly_goals' then
        select count(*) into v_n from public.monthly_goals where owner_id = m.id and month_start = v_month and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.monthly_goals',
          case when v_n = 0 then 'Set your monthly goals' else 'New month — review your monthly goals' end,
          'Define measurable objectives for ' || to_char(v_month, 'FMMonth YYYY') || '.', '/monthly-goals', '{}', 'monthly_goals:' || v_month);
        v_sent := v_sent + 1;
      elsif r.kind = 'monthly_progress' then
        select count(*) into v_n from public.monthly_goals where owner_id = m.id and month_start = v_month and deleted_at is null and achieved < target;
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.monthly_progress', v_n || ' monthly goal(s) still open',
            'The month closes soon. Update your progress.', '/monthly-goals', '{}', 'monthly_progress:' || v_month);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'prospecting' then
        v_perf := private.compute_performance(m.id, 'daily', v_today);
        select count(*) into v_n from public.prospecting_targets where owner_id = m.id and period = 'daily' and period_start = v_today;
        perform private.notify(m.id, 'reminders', 'reminder.prospecting',
          case when v_n = 0 then 'Set today''s prospecting targets' else 'Prospecting check-in' end,
          case when v_n = 0 then 'No prospecting targets are set for today yet.'
               else 'You are at ' || coalesce((select (c ->> 'capped_pct') from jsonb_array_elements(v_perf -> 'categories') c where c ->> 'category' = 'prospecting'), '0') || '% of today''s prospecting target.' end,
          '/prospecting', '{}', 'prospecting:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'goal_deadlines' then
        select count(*) into v_n from (
          select id from public.weekly_goals where owner_id = m.id and deleted_at is null and achieved < target and deadline between v_today and v_today + 1
          union all
          select id from public.monthly_goals where owner_id = m.id and deleted_at is null and achieved < target and deadline between v_today and v_today + 3) x;
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.goal_deadlines', v_n || ' goal deadline(s) approaching',
            'Some goals are due soon and not yet achieved.', '/weekly-goals', '{}', 'goal_deadlines:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'performance_summary' then
        select overall_score into v_n from public.performance_snapshots
         where user_id = m.id and period_type = 'daily' and period_start = v_today - 1 and is_current;
        if found and v_n is not null then
          perform private.notify(m.id, 'performance', 'performance.daily_summary', 'Yesterday''s performance: ' || v_n || '%',
            'Open your performance dashboard to see the category breakdown.', '/performance', '{}', 'perf_summary:' || v_today);
          v_sent := v_sent + 1;
        end if;
      end if;
    end loop;
    if p_force_kind is null then
      update public.reminder_schedules set last_run_on = v_today where kind = r.kind;
    end if;
    v_out := v_out || jsonb_build_object(r.kind, v_sent);
  end loop;
  return v_out;
end $$;
revoke execute on function private.run_reminders(text) from public, authenticated;

-- Evaluate closed periods and auto-draw overdue spins. Idempotent.
create or replace function private.run_evaluations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.org_today(); m record; ev record; v_events int := 0; v_draws int := 0; v_recs int := 0;
  v_hours int; d int;
begin
  for m in select id from public.profiles where role = 'team_member' and status = 'approved' loop
    -- daily: the previous two days (catch-up if a run was missed)
    for d in 1..2 loop
      if private.evaluate_period(m.id, 'daily', v_today - d) is not null then v_events := v_events + 1; end if;
    end loop;
    -- weekly: the most recent closed week
    if private.evaluate_period(m.id, 'weekly', v_today - extract(isodow from v_today)::int) is not null then v_events := v_events + 1; end if;
    -- monthly: the most recent closed month
    if private.evaluate_period(m.id, 'monthly', date_trunc('month', v_today)::date - 1) is not null then v_events := v_events + 1; end if;
    -- weekly book recommendations (Mondays)
    if extract(isodow from v_today) = 1 then v_recs := v_recs + private.generate_recommendations(m.id); end if;
  end loop;

  select auto_draw_after_hours into v_hours from public.accountability_settings where id;
  for ev in
    select e.id from public.accountability_events e
     join public.profiles p on p.id = e.user_id and p.status = 'approved'
     where not exists (select 1 from public.accountability_ledger l where l.event_id = e.id)
       and e.created_at < now() - make_interval(hours => v_hours)
  loop
    begin
      perform private.draw_for_event(ev.id, 'system_auto');
      v_draws := v_draws + 1;
    exception when others then
      perform private.audit('accountability.auto_draw_failed', 'accountability_event', ev.id::text, null, null, null, 'failure',
        jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('events_created', v_events, 'auto_draws', v_draws, 'recommendations', v_recs);
end $$;
revoke execute on function private.run_evaluations() from public, authenticated;

-- Service-role entry points for schedulers (never callable by end users).
create or replace function public.cron_run_evaluations()
returns jsonb language sql security definer set search_path = '' as $$ select private.run_evaluations(); $$;
create or replace function public.cron_run_reminders()
returns jsonb language sql security definer set search_path = '' as $$ select private.run_reminders(null); $$;
revoke execute on function public.cron_run_evaluations() from public, anon, authenticated;
revoke execute on function public.cron_run_reminders() from public, anon, authenticated;
grant execute on function public.cron_run_evaluations() to service_role;
grant execute on function public.cron_run_reminders() to service_role;

-- Super Admin: run a reminder type immediately (deduped per day).
create or replace function public.send_reminder_now(p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can trigger reminders');
  v := private.run_reminders(p_kind);
  perform private.audit('reminders.sent_manually', 'reminder_schedule', p_kind, null, null, v);
  return v;
end $$;

-- Super Admin: run evaluations immediately.
create or replace function public.run_evaluations_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can run evaluations');
  v := private.run_evaluations();
  perform private.audit('accountability.evaluations_run', 'system', null, null, null, v);
  return v;
end $$;

create or replace function private.reminder_schedules_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - 'last_run_on' - 'updated_at') <> (to_jsonb(old) - 'last_run_on' - 'updated_at') then
    perform private.audit('settings.reminder_schedule', 'reminder_schedule', new.kind, null,
      to_jsonb(old) - 'last_run_on', to_jsonb(new) - 'last_run_on');
  end if;
  return new;
end $$;
create trigger reminder_schedules_audit after update on public.reminder_schedules
  for each row execute function private.reminder_schedules_audit();

alter table public.reminder_schedules enable row level security;
create policy reminder_schedules_read on public.reminder_schedules for select to authenticated using (private.is_staff());
create policy reminder_schedules_write on public.reminder_schedules for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
revoke update on public.reminder_schedules from authenticated;
grant update (enabled, local_time, weekday, monthday) on public.reminder_schedules to authenticated;

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('book-covers', 'book-covers', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('learning-resources', 'learning-resources', false, 20971520, array['application/pdf', 'application/epub+zip'])
on conflict (id) do nothing;

create or replace function private.storage_owner(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return ((storage.foldername(p_name))[1])::uuid;
exception when others then
  return null;
end $$;

-- Avatars: stored under "<user_id>/…"; visible to whoever may view the profile.
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (private.storage_owner(name) = (select auth.uid())
         or private.is_super_admin() or private.is_assigned_admin_of(private.storage_owner(name))));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and private.storage_owner(name) = (select auth.uid()));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and private.storage_owner(name) = (select auth.uid()))
  with check (bucket_id = 'avatars' and private.storage_owner(name) = (select auth.uid()));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and private.storage_owner(name) = (select auth.uid()));

-- Book covers (public bucket) and learning resources: managed by Super Admin.
create policy book_covers_write on storage.objects for all to authenticated
  using (bucket_id = 'book-covers' and private.is_super_admin())
  with check (bucket_id = 'book-covers' and private.is_super_admin());
create policy learning_resources_read on storage.objects for select to authenticated
  using (bucket_id = 'learning-resources' and private.is_active_user());
create policy learning_resources_write on storage.objects for all to authenticated
  using (bucket_id = 'learning-resources' and private.is_super_admin())
  with check (bucket_id = 'learning-resources' and private.is_super_admin());

-- >>> 20261122000800_reference_data.sql
-- =============================================================================
-- WINNERS TEAM — 0008 Reference data required in every environment.
-- (Demo users/records are NOT here; see scripts/seed-demo.mjs.)
-- =============================================================================

-- Accountability wheel: ONLY the four permitted categories, within limits.
-- Frog jumps apply primarily to incomplete daily to-do lists.
insert into public.accountability_options (category, quantity, levels, applies_to, weight) values
  ('frog_jumps', 10,  '{low}',            '{daily_todo,additional_tasks}', 20),
  ('frog_jumps', 20,  '{low}',            '{daily_todo,additional_tasks}', 15),
  ('frog_jumps', 25,  '{low,moderate}',   '{daily_todo,additional_tasks}', 15),
  ('frog_jumps', 50,  '{moderate}',       '{daily_todo}', 12),
  ('frog_jumps', 100, '{moderate,high}',  '{daily_todo}', 10),
  ('frog_jumps', 200, '{high}',           '{daily_todo}', 6),
  ('frog_jumps', 400, '{high}',           '{daily_todo}', 2),
  ('leg_raising', 10, '{low}',            '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 12),
  ('leg_raising', 20, '{low,moderate}',   '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 10),
  ('leg_raising', 30, '{moderate}',       '{weekly_goals,prospecting,monthly_goals}', 8),
  ('leg_raising', 45, '{moderate,high}',  '{weekly_goals,prospecting,monthly_goals}', 6),
  ('leg_raising', 60, '{high}',           '{weekly_goals,prospecting,monthly_goals}', 4),
  ('office_signatures', 1,  '{low}',           '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 12),
  ('office_signatures', 2,  '{low,moderate}',  '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 10),
  ('office_signatures', 3,  '{moderate}',      '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 10),
  ('office_signatures', 5,  '{moderate,high}', '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 8),
  ('office_signatures', 10, '{high}',          '{weekly_goals,prospecting,monthly_goals}', 4),
  ('financial_fine', 200,  '{low}',            '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 10),
  ('financial_fine', 500,  '{low,moderate}',   '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 8),
  ('financial_fine', 1000, '{moderate}',       '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 6),
  ('financial_fine', 2500, '{moderate,high}',  '{daily_todo,weekly_goals,prospecting,monthly_goals,additional_tasks}', 4),
  ('financial_fine', 5000, '{high}',           '{monthly_goals,prospecting}', 2);

insert into public.task_categories (kind, name, color) values
  ('daily', 'Client Work', '#5a45cb'), ('daily', 'Prospecting', '#F59E0B'), ('daily', 'Administration', '#0091FF'),
  ('daily', 'Self-Growth', '#10B981'), ('daily', 'Follow-up', '#8B5CF6'),
  ('additional', 'Office Support', '#0091FF'), ('additional', 'Training', '#10B981'),
  ('additional', 'Events', '#F59E0B'), ('additional', 'Special Projects', '#8B5CF6');

insert into public.service_categories (slug, name, keywords) values
  ('web-development', 'Website Development', '{web,website,javascript,css,html,frontend,wordpress,seo}'),
  ('digital-marketing', 'Digital Marketing', '{marketing,social media,ads,seo,content,email marketing,campaign}'),
  ('academic-publishing', 'Academic Publishing', '{journal,publishing,peer review,open access,research,scholarly}'),
  ('graphic-design', 'Graphic Design & Branding', '{design,branding,logo,typography,figma}'),
  ('financial-consulting', 'Financial Consulting', '{finance,accounting,tax,audit,investment}'),
  ('business-consulting', 'Business Consulting', '{strategy,management,operations,consulting}'),
  ('software-development', 'Software Development', '{software,app,api,cloud,devops}'),
  ('content-writing', 'Content & Copywriting', '{copywriting,content,blog,writing,editing}'),
  ('training-coaching', 'Training & Coaching', '{training,coaching,workshop,mentoring}'),
  ('other', 'Other Services', '{}');

insert into public.learning_categories (slug, name) values
  ('time-management', 'Time Management'), ('productivity', 'Productivity'), ('discipline', 'Discipline'),
  ('business-development', 'Business Development'), ('sales', 'Sales'), ('marketing', 'Marketing'),
  ('communication', 'Communication'), ('leadership', 'Leadership'), ('entrepreneurship', 'Entrepreneurship'),
  ('financial-intelligence', 'Financial Intelligence'), ('strategic-planning', 'Strategic Planning'),
  ('personal-development', 'Personal Development');

-- Books: public-domain classics (links go to Project Gutenberg's search for the
-- exact title — no pirated or unverified direct copies) and commercial titles
-- WITHOUT download links. The Super Admin can edit/extend these.
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license) values
  ('How to Live on 24 Hours a Day', 'Arnold Bennett', 'time-management', 'Time management & execution',
   'A short, practical classic on reclaiming the hours outside work and using them deliberately.',
   'https://www.gutenberg.org/ebooks/search/?query=How+to+Live+on+24+Hours+a+Day', 'https://www.gutenberg.org/ebooks/search/?query=How+to+Live+on+24+Hours+a+Day', 'public_domain'),
  ('Self-Help', 'Samuel Smiles', 'discipline', 'Discipline & prioritisation',
   'Victorian-era case studies on perseverance, industry and character.',
   'https://www.gutenberg.org/ebooks/search/?query=Self-Help+Samuel+Smiles', 'https://www.gutenberg.org/ebooks/search/?query=Self-Help+Samuel+Smiles', 'public_domain'),
  ('The Autobiography of Benjamin Franklin', 'Benjamin Franklin', 'personal-development', 'Discipline & self-improvement',
   'Includes Franklin''s famous thirteen-virtue plan and daily schedule.',
   'https://www.gutenberg.org/ebooks/search/?query=Autobiography+of+Benjamin+Franklin', 'https://www.gutenberg.org/ebooks/search/?query=Autobiography+of+Benjamin+Franklin', 'public_domain'),
  ('As a Man Thinketh', 'James Allen', 'personal-development', 'Mindset & personal growth',
   'A brief essay on how thought shapes character and circumstance.',
   'https://www.gutenberg.org/ebooks/search/?query=As+a+Man+Thinketh', 'https://www.gutenberg.org/ebooks/search/?query=As+a+Man+Thinketh', 'public_domain'),
  ('Meditations', 'Marcus Aurelius', 'discipline', 'Discipline & self-mastery',
   'Private notes of a Roman emperor on duty, focus and composure.',
   'https://www.gutenberg.org/ebooks/search/?query=Meditations+Marcus+Aurelius', 'https://www.gutenberg.org/ebooks/search/?query=Meditations+Marcus+Aurelius', 'public_domain'),
  ('The Art of War', 'Sun Tzu', 'strategic-planning', 'Strategic planning & goal setting',
   'Classic text on strategy, preparation and positioning.',
   'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+War+Sun+Tzu', 'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+War+Sun+Tzu', 'public_domain'),
  ('The Art of Public Speaking', 'Dale Carnegie & J. Berg Esenwein', 'communication', 'Sales, communication & lead generation',
   'A 1915 public-domain guide to confident, persuasive speaking.',
   'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+Public+Speaking', 'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+Public+Speaking', 'public_domain'),
  ('The Art of Money Getting', 'P. T. Barnum', 'financial-intelligence', 'Financial intelligence',
   'Barnum''s rules for earning, saving and running a business.',
   'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+Money+Getting', 'https://www.gutenberg.org/ebooks/search/?query=The+Art+of+Money+Getting', 'public_domain'),
  ('Acres of Diamonds', 'Russell H. Conwell', 'entrepreneurship', 'Entrepreneurship & opportunity',
   'The famous lecture on finding opportunity close to home.',
   'https://www.gutenberg.org/ebooks/search/?query=Acres+of+Diamonds', 'https://www.gutenberg.org/ebooks/search/?query=Acres+of+Diamonds', 'public_domain'),
  ('The Prince', 'Niccolò Machiavelli', 'leadership', 'Leadership & influence',
   'A foundational (and debated) treatise on power and leadership.',
   'https://www.gutenberg.org/ebooks/search/?query=The+Prince+Machiavelli', 'https://www.gutenberg.org/ebooks/search/?query=The+Prince+Machiavelli', 'public_domain'),
  ('Principles of Marketing (OpenStax)', 'OpenStax', 'marketing', 'Sales, marketing & lead generation',
   'Free, peer-reviewed open-access textbook (CC BY). Find it in the OpenStax business library.',
   'https://openstax.org/subjects/business', null, 'open_access'),
  ('Entrepreneurship (OpenStax)', 'OpenStax', 'business-development', 'Business development',
   'Free, peer-reviewed open-access textbook (CC BY). Find it in the OpenStax business library.',
   'https://openstax.org/subjects/business', null, 'open_access'),
  ('Principles of Management (OpenStax)', 'OpenStax', 'leadership', 'Leadership & management',
   'Free, peer-reviewed open-access textbook (CC BY). Find it in the OpenStax business library.',
   'https://openstax.org/subjects/business', null, 'open_access'),
  ('Deep Work', 'Cal Newport', 'productivity', 'Focus & productivity', 'Rules for focused success in a distracted world. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('Atomic Habits', 'James Clear', 'discipline', 'Habits & consistency', 'Small changes, remarkable results. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('Eat That Frog!', 'Brian Tracy', 'time-management', 'Time management & procrastination', 'Tackling your most important task first. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('The Psychology of Selling', 'Brian Tracy', 'sales', 'Sales & persuasion', 'Mindset and techniques for professional selling. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('Fanatical Prospecting', 'Jeb Blount', 'sales', 'Prospecting & lead generation', 'Building a consistent prospecting discipline. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('The 4 Disciplines of Execution', 'Chris McChesney, Sean Covey & Jim Huling', 'strategic-planning', 'Execution of strategic goals', 'Achieving wildly important goals. Commercial title — borrow or buy.', null, null, 'commercial'),
  ('Rich Dad Poor Dad', 'Robert T. Kiyosaki', 'financial-intelligence', 'Financial intelligence', 'Personal finance mindset. Commercial title — borrow or buy.', null, null, 'commercial');

-- Quotes with well-established attribution.
insert into public.motivational_quotes (text, author, source, category) values
  ('We are what we repeatedly do. Excellence, then, is not an act, but a habit.', 'Will Durant', 'The Story of Philosophy (1926), summarising Aristotle', 'excellence'),
  ('Well done is better than well said.', 'Benjamin Franklin', 'Poor Richard''s Almanack', 'productivity'),
  ('Energy and persistence conquer all things.', 'Benjamin Franklin', null, 'consistency'),
  ('Lost time is never found again.', 'Benjamin Franklin', 'Poor Richard''s Almanack', 'discipline'),
  ('He that is good for making excuses is seldom good for anything else.', 'Benjamin Franklin', null, 'discipline'),
  ('Efficiency is doing things right; effectiveness is doing the right things.', 'Peter F. Drucker', null, 'business'),
  ('Plans are worthless, but planning is everything.', 'Dwight D. Eisenhower', 'Speech, 1957', 'leadership'),
  ('Leadership is the art of getting someone else to do something you want done because he wants to do it.', 'Dwight D. Eisenhower', null, 'leadership'),
  ('First say to yourself what you would be; and then do what you have to do.', 'Epictetus', 'Discourses', 'personal_growth'),
  ('Waste no more time arguing about what a good man should be. Be one.', 'Marcus Aurelius', 'Meditations', 'personal_growth'),
  ('Knowing is not enough; we must apply. Willing is not enough; we must do.', 'Johann Wolfgang von Goethe', 'Wilhelm Meister''s Journeyman Years', 'success'),
  ('Do what you can, with what you have, where you are.', 'Theodore Roosevelt', 'An Autobiography (1913)', 'consistency'),
  ('Great things are done by a series of small things brought together.', 'Vincent van Gogh', 'Letter to Theo van Gogh, 1882', 'consistency'),
  ('Genius is one per cent inspiration, ninety-nine per cent perspiration.', 'Thomas A. Edison', null, 'success'),
  ('Discipline is the bridge between goals and accomplishment.', 'Jim Rohn', null, 'discipline'),
  ('It is not the mountain we conquer, but ourselves.', 'Sir Edmund Hillary', null, 'personal_growth');

-- LEX knowledge base (approved platform documentation).
insert into public.knowledge_base_documents (slug, title, content, audience, link) values
('daily-tasks', 'Creating and managing your daily to-do list',
 'Open "My Tasks & Daily To-Dos" from the sidebar (or press the "New Task" button in the header). Enter a title, optional description, category, priority and due time, then save. Tick the checkbox to mark a task completed; untick to mark it pending again. Use the filters for Today, Overdue and Completed. Your daily completion percentage is completed tasks divided by total tasks due today. Days are locked once they close (after midnight, Africa/Lagos time) because they have been evaluated; contact the Super Admin if a correction is needed.',
 '{team_member,administrator,super_admin}', '/tasks'),
('additional-tasks', 'Additional tasks',
 'Additional tasks are responsibilities outside your standard to-do list, such as office support, training or events. Create them under "Additional Tasks", choose a category configured by the Super Admin, and mark them completed when done. They count for 10% of performance by default.',
 '{team_member,administrator,super_admin}', '/additional-tasks'),
('weekly-goals', 'Setting and updating weekly goals',
 'Open "Weekly Goals". Create a goal with a measurable target and unit (for example 5 proposals) and a deadline within the current week (Monday to Sunday). Update the achieved value as you progress; the completion percentage is achieved divided by target. Goals for closed weeks are locked.',
 '{team_member,administrator,super_admin}', '/weekly-goals'),
('monthly-goals', 'Setting and updating monthly goals',
 'Open "Monthly Goals". Define measurable monthly objectives with a target and unit, then update your achieved value. The page shows remaining targets and your monthly achievement. Monthly goals count only in the monthly assessment, and never erase incomplete daily tasks.',
 '{team_member,administrator,super_admin}', '/monthly-goals'),
('prospecting', 'Prospecting targets and activity logging',
 'Open "Prospecting". Set daily targets (and optionally a weekly target) for activities such as finding prospects, contacting prospects, generating leads, sending proposals, follow-ups, appointments and conversions. Log activity as it happens — entries are recorded for today. Achievement is the sum of activity (capped at each target) divided by the total target, so over-delivering one activity cannot hide a shortfall in another. If a weekly target exists for an activity it replaces the daily targets for that week, so nothing is counted twice.',
 '{team_member,administrator,super_admin}', '/prospecting'),
('performance-calculation', 'How your performance score is calculated',
 'Your overall score is a weighted average of five categories. Default weights: Daily To-Do List 30%, Weekly Goals 20%, Prospecting 20%, Monthly Goals 20%, Additional Tasks 10%. The Super Admin can change them. Task categories use completed ÷ total due × 100. Goal categories use achieved ÷ target × 100. Each category is capped at 100% for scoring; any overachievement is still displayed. If a category has nothing due in a period it is excluded and the remaining weights are scaled up proportionally. Daily assessments include to-dos, prospecting and additional tasks; weekly adds weekly goals; monthly adds monthly goals. Closed periods are stored as snapshots; any correction creates a new, audited version.',
 '{team_member,administrator,super_admin}', '/performance'),
('accountability-wheel', 'How the accountability wheel works',
 'After each closed period (daily, weekly, monthly — as enabled by the Super Admin) your score is compared with the thresholds: 90–100% no consequence, 75–89% low, 50–74% moderate, below 50% high. If a consequence applies, an accountability spin becomes available on the Accountability page. When you press Spin, the server securely selects the outcome from the eligible options and it is assigned to you immediately — there is no approval step, and the result cannot be re-rolled. If you do not spin within the configured window the system draws automatically. Only four consequence types exist: frog jumps (10–400, mainly for incomplete daily to-do lists), leg raising (10–60 minutes), collecting signatures from other offices (1–10 offices) and a financial fine (₦200–₦5,000). Fines are recorded only; nothing is ever deducted automatically. Update the status to In progress or Completed when you carry it out.',
 '{team_member,administrator,super_admin}', '/accountability'),
('physical-accommodation', 'Physical accommodation override',
 'If you cannot safely perform physical activity, enable "Physical accommodation" on the Accountability page. It takes effect immediately without any approval. While enabled, frog jumps and leg raising are excluded and the wheel only selects from office signatures or a financial fine. The setting change is recorded in your history.',
 '{team_member,administrator,super_admin}', '/accountability'),
('profile', 'Updating your unified profile and services',
 'Open "My Profile". Your single profile has three sections: Basic information (name, phone, photo, job title, team name, team leader), Professional information (specialisations, skills, business interests, target audience, portfolio links) and Services (add as many services as you offer, each with description, category, key benefits, target audience and portfolio link). Saving records the change history and notifies your administrator and the Super Admin. Service categories also personalise your Service Updates feed.',
 '{team_member,administrator,super_admin}', '/profile'),
('books', 'Book recommendations and reading list',
 'Open "Books & Reading". Recommendations are generated from recurring patterns in your performance history (not a single missed task), for example repeatedly incomplete daily lists suggest time-management reading. Add a book to your list, mark it as reading, update your progress percentage, add personal notes and mark it completed. Public-domain and open-access titles include legal free links.',
 '{team_member,administrator,super_admin}', '/books'),
('service-updates', 'Professional service updates',
 'Open "Service Updates" to see items from approved sources that match the categories of the services on your profile. Each item shows the source, publication date, why it is relevant and a link to the original article. AI summaries appear when an AI provider is configured. Mark items read or save them for later.',
 '{team_member,administrator,super_admin}', '/service-updates'),
('notifications', 'Notifications and preferences',
 'The bell in the header opens your notifications. Open "Notifications" to see all of them, mark them read, and change your preferences per category (reminders, deadlines, performance, accountability, announcements, service updates…) for in-app, e-mail and browser push. Browser push requires you to allow notifications in your browser.',
 '{team_member,administrator,super_admin}', '/notifications'),
('admin-team', 'Managing your assigned team (administrators)',
 'Administrators see only the team members currently assigned to them. The Administrator dashboard shows team performance, outstanding tasks, prospecting, goals and accountability outcomes. Open a member to view their profile, tasks, goals and history. Use "Send announcement" to message your team. Administrators can remove any team-member account (soft removal that preserves history) but cannot transfer members, create administrators or view other teams'' records.',
 '{administrator,super_admin}', '/admin'),
('super-admin-governance', 'Super Admin: registrations, administrators and assignments',
 'Pending registrations appear under "Pending Registrations". Approving requires choosing an administrator; rejection requires a reason. Invite administrators from "Administrator Directory" — they receive an e-mail to set their password. Use "Team Assignments" to transfer members between administrators; history is preserved and both administrators are notified. "User Management" lets you deactivate, reactivate or remove accounts. Every action is written to the audit log.',
 '{super_admin}', '/super-admin'),
('super-admin-settings', 'Super Admin: system settings',
 'System Settings contains performance weights (must total 100%), accountability thresholds and cadence, the wheel sector editor (only the four permitted categories with their limits), reminder schedules, service update sources, books, quotes, LEX knowledge base articles and general settings. All changes are audited.',
 '{super_admin}', '/settings'),
('reports', 'Reports and exports',
 'Open "Reports" to view daily, weekly or monthly performance for yourself, your team (administrators) or the organisation (Super Admin). Export to CSV, Excel or PDF. Reports only include records you are authorised to see.',
 '{team_member,administrator,super_admin}', '/reports');

-- >>> 20261122000900_realtime.sql
-- Live notification bell: Realtime respects RLS (users only receive their own rows).
alter publication supabase_realtime add table public.notifications;

-- >>> 20261122001000_backfill.sql
-- Service-role utility: record daily/weekly snapshots for the last N closed days
-- (history for charts and weakness detection). Does NOT create accountability
-- events — those come only from the scheduled evaluation of recent periods.
create or replace function public.cron_backfill_snapshots(p_days int default 14)
returns int language plpgsql security definer set search_path = '' as $$
declare m record; d int; v_today date := private.org_today(); v_n int := 0;
begin
  for m in select id from public.profiles where role = 'team_member' and status = 'approved' loop
    for d in 1..least(greatest(p_days, 1), 120) loop
      if not exists (select 1 from public.performance_snapshots where user_id = m.id and period_type = 'daily' and period_start = v_today - d and is_current) then
        perform private.record_snapshot(m.id, 'daily', v_today - d, null); v_n := v_n + 1;
      end if;
      if extract(isodow from v_today - d) = 7 and not exists (
        select 1 from public.performance_snapshots where user_id = m.id and period_type = 'weekly' and period_start = v_today - d - 6 and is_current) then
        perform private.record_snapshot(m.id, 'weekly', v_today - d, null); v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;
revoke execute on function public.cron_backfill_snapshots(int) from public, anon, authenticated;
grant execute on function public.cron_backfill_snapshots(int) to service_role;

-- >>> 20261122001100_harden_function_grants.sql
-- Defence in depth: no RPC is callable without signing in. Every public
-- function also checks the caller's role itself.
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
-- Service-role-only entry points stay restricted.
revoke execute on function public.cron_run_evaluations() from authenticated;
revoke execute on function public.cron_run_reminders() from authenticated;
revoke execute on function public.cron_match_service_updates() from authenticated;
revoke execute on function public.cron_backfill_snapshots(int) from authenticated;
revoke execute on function public.bootstrap_super_admin(text) from authenticated;

-- >>> 20261122001200_explicit_api_grants.sql
-- =============================================================================
-- WINNERS TEAM — 0012 Explicit Data API privileges
-- Newer Supabase projects no longer grant the API roles access to new tables
-- automatically. Grant them explicitly (RLS still decides which ROWS each user
-- sees), then re-apply every column-level and anonymous restriction.
-- Safe to run more than once.
-- =============================================================================
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Anonymous visitors: no table access at all.
revoke all on all tables in schema public from anon;

-- Column-level restrictions (re-applied after the broad grant above).
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.book_recommendations from authenticated;
grant update (dismissed_at) on public.book_recommendations to authenticated;
revoke update on public.reminder_schedules from authenticated;
grant update (enabled, local_time, weekday, monthday) on public.reminder_schedules to authenticated;

-- Helpers evaluated as the calling user (RLS, CHECK constraints, column
-- defaults, storage policies, invoker SQL functions).
grant usage on schema private to authenticated, service_role;
grant execute on function
  private.org_tz(), private.org_today(), private.current_role(), private.is_active_user(),
  private.is_super_admin(), private.is_administrator(), private.is_staff(),
  private.is_assigned_admin_of(uuid), private.can_view_user(uuid), private.is_owner_active(uuid),
  private.current_admin_of(uuid), private.storage_owner(text),
  private.consequence_in_range(public.consequence_category, numeric),
  private.period_bounds(public.period_type, date)
  to authenticated, service_role;

-- >>> 20261122001300_more_quotes_and_help.sql
-- =============================================================================
-- WINNERS TEAM — 0013 More motivational quotes and help-centre articles
-- Quotes are taken from identifiable original works (attribution + source).
-- Safe to run more than once (duplicates are skipped).
-- =============================================================================
-- Widely attributed to Franklin but not found in his writings: keep it, but inactive.
update public.motivational_quotes set active = false where text = 'Energy and persistence conquer all things.' and author = 'Benjamin Franklin';

insert into public.motivational_quotes (text, author, source, category) values
  ($q$Diligence is the mother of good luck.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'discipline'),
  ($q$One to-day is worth two to-morrows.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'productivity'),
  ($q$Plough deep while sluggards sleep, and you shall have corn to sell and to keep.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'discipline'),
  ($q$Little strokes fell great oaks.$q$, $q$Benjamin Franklin$q$, $q$Poor Richard's Almanack (1750)$q$, 'consistency'),
  ($q$Remember that time is money.$q$, $q$Benjamin Franklin$q$, $q$Advice to a Young Tradesman (1748)$q$, 'business'),
  ($q$He that can have patience can have what he will.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'personal_growth'),
  ($q$There are no gains without pains.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'success'),
  ($q$Sloth, like rust, consumes faster than labour wears, while the used key is always bright.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'discipline'),
  ($q$Dost thou love life? Then do not squander time, for that's the stuff life is made of.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'productivity'),
  ($q$The sleeping fox catches no poultry.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'productivity'),
  ($q$Drive thy business, let not that drive thee.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'business'),
  ($q$Beware of little expenses; a small leak will sink a great ship.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'business'),
  ($q$Constant dropping wears away stones.$q$, $q$Benjamin Franklin$q$, $q$The Way to Wealth (1758)$q$, 'consistency'),
  ($q$Early to bed and early to rise, makes a man healthy, wealthy, and wise.$q$, $q$Benjamin Franklin$q$, $q$Poor Richard's Almanack (1735)$q$, 'discipline'),
  ($q$Search others for their virtues, thy self for thy vices.$q$, $q$Benjamin Franklin$q$, $q$Poor Richard's Almanack (1738)$q$, 'personal_growth'),
  ($q$Hide not your talents, they for use were made. What's a sun-dial in the shade?$q$, $q$Benjamin Franklin$q$, $q$Poor Richard's Almanack (1750)$q$, 'excellence'),
  ($q$Have you somewhat to do to-morrow, do it to-day.$q$, $q$Benjamin Franklin$q$, $q$Poor Richard's Almanack (1742)$q$, 'productivity'),
  ($q$Trust thyself: every heart vibrates to that iron string.$q$, $q$Ralph Waldo Emerson$q$, $q$Self-Reliance (1841)$q$, 'personal_growth'),
  ($q$Insist on yourself; never imitate.$q$, $q$Ralph Waldo Emerson$q$, $q$Self-Reliance (1841)$q$, 'personal_growth'),
  ($q$Nothing great was ever achieved without enthusiasm.$q$, $q$Ralph Waldo Emerson$q$, $q$Circles (1841)$q$, 'success'),
  ($q$The reward of a thing well done is to have done it.$q$, $q$Ralph Waldo Emerson$q$, $q$New England Reformers (1844)$q$, 'excellence'),
  ($q$Shallow men believe in luck. Strong men believe in cause and effect.$q$, $q$Ralph Waldo Emerson$q$, $q$The Conduct of Life (1860)$q$, 'discipline'),
  ($q$Make yourself necessary to somebody.$q$, $q$Ralph Waldo Emerson$q$, $q$The Conduct of Life (1860)$q$, 'leadership'),
  ($q$Do the thing, and you shall have the power.$q$, $q$Ralph Waldo Emerson$q$, $q$Compensation (1841)$q$, 'success'),
  ($q$The only way to have a friend is to be one.$q$, $q$Ralph Waldo Emerson$q$, $q$Friendship (1841)$q$, 'leadership'),
  ($q$If you have built castles in the air, your work need not be lost; that is where they should be. Now put the foundations under them.$q$, $q$Henry David Thoreau$q$, $q$Walden (1854)$q$, 'success'),
  ($q$If one advances confidently in the direction of his dreams, and endeavors to live the life which he has imagined, he will meet with a success unexpected in common hours.$q$, $q$Henry David Thoreau$q$, $q$Walden (1854)$q$, 'success'),
  ($q$Our life is frittered away by detail. Simplify, simplify.$q$, $q$Henry David Thoreau$q$, $q$Walden (1854)$q$, 'productivity'),
  ($q$It is not enough to be busy; so are the ants. The question is: What are we busy about?$q$, $q$Henry David Thoreau$q$, $q$Letter to H. G. O. Blake (1857)$q$, 'productivity'),
  ($q$Our doubts are traitors, and make us lose the good we oft might win, by fearing to attempt.$q$, $q$William Shakespeare$q$, $q$Measure for Measure$q$, 'personal_growth'),
  ($q$We know what we are, but know not what we may be.$q$, $q$William Shakespeare$q$, $q$Hamlet$q$, 'personal_growth'),
  ($q$Things done well and with a care, exempt themselves from fear.$q$, $q$William Shakespeare$q$, $q$Henry VIII$q$, 'excellence'),
  ($q$Action is eloquence.$q$, $q$William Shakespeare$q$, $q$Coriolanus$q$, 'productivity'),
  ($q$The fault, dear Brutus, is not in our stars, but in ourselves.$q$, $q$William Shakespeare$q$, $q$Julius Caesar$q$, 'personal_growth'),
  ($q$There is a tide in the affairs of men, which, taken at the flood, leads on to fortune.$q$, $q$William Shakespeare$q$, $q$Julius Caesar$q$, 'success'),
  ($q$Better three hours too soon than a minute too late.$q$, $q$William Shakespeare$q$, $q$The Merry Wives of Windsor$q$, 'discipline'),
  ($q$Go to the ant, thou sluggard; consider her ways, and be wise.$q$, $q$Proverbs 6:6$q$, $q$The Bible (King James Version)$q$, 'discipline'),
  ($q$Seest thou a man diligent in his business? he shall stand before kings.$q$, $q$Proverbs 22:29$q$, $q$The Bible (King James Version)$q$, 'excellence'),
  ($q$The hand of the diligent shall bear rule: but the slothful shall be under tribute.$q$, $q$Proverbs 12:24$q$, $q$The Bible (King James Version)$q$, 'leadership'),
  ($q$In all labour there is profit: but the talk of the lips tendeth only to penury.$q$, $q$Proverbs 14:23$q$, $q$The Bible (King James Version)$q$, 'productivity'),
  ($q$Where there is no vision, the people perish.$q$, $q$Proverbs 29:18$q$, $q$The Bible (King James Version)$q$, 'leadership'),
  ($q$Iron sharpeneth iron; so a man sharpeneth the countenance of his friend.$q$, $q$Proverbs 27:17$q$, $q$The Bible (King James Version)$q$, 'leadership'),
  ($q$Without counsel purposes are disappointed: but in the multitude of counsellors they are established.$q$, $q$Proverbs 15:22$q$, $q$The Bible (King James Version)$q$, 'leadership'),
  ($q$The thoughts of the diligent tend only to plenteousness.$q$, $q$Proverbs 21:5$q$, $q$The Bible (King James Version)$q$, 'discipline'),
  ($q$Whatsoever thy hand findeth to do, do it with thy might.$q$, $q$Ecclesiastes 9:10$q$, $q$The Bible (King James Version)$q$, 'excellence'),
  ($q$Far and away the best prize that life offers is the chance to work hard at work worth doing.$q$, $q$Theodore Roosevelt$q$, $q$Labor Day address, Syracuse (1903)$q$, 'success'),
  ($q$Always bear in mind that your own resolution to succeed is more important than any other one thing.$q$, $q$Abraham Lincoln$q$, $q$Letter to Isham Reavis (1855)$q$, 'success'),
  ($q$Success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome while trying to succeed.$q$, $q$Booker T. Washington$q$, $q$Up from Slavery (1901)$q$, 'success'),
  ($q$Nothing ever comes to one, that is worth having, except as a result of hard work.$q$, $q$Booker T. Washington$q$, $q$Up from Slavery (1901)$q$, 'discipline'),
  ($q$We become just by doing just acts, temperate by doing temperate acts, brave by doing brave acts.$q$, $q$Aristotle$q$, $q$Nicomachean Ethics, Book II (trans. W. D. Ross)$q$, 'excellence'),
  ($q$While we are postponing, life speeds by.$q$, $q$Seneca$q$, $q$Moral Letters to Lucilius, Letter I (trans. R. M. Gummere)$q$, 'productivity'),
  ($q$Do every act of thy life as if it were the last.$q$, $q$Marcus Aurelius$q$, $q$Meditations, II.5 (trans. George Long)$q$, 'excellence'),
  ($q$The beginning is the most important part of the work.$q$, $q$Plato$q$, $q$The Republic, Book II (trans. B. Jowett)$q$, 'productivity'),
  ($q$A journey of a thousand miles begins with a single step.$q$, $q$Laozi$q$, $q$Tao Te Ching, ch. 64 (common translation)$q$, 'consistency'),
  ($q$If you know the enemy and know yourself, you need not fear the result of a hundred battles.$q$, $q$Sun Tzu$q$, $q$The Art of War, ch. III (trans. Lionel Giles)$q$, 'leadership'),
  ($q$No man is free who is not master of himself.$q$, $q$Epictetus$q$, $q$Fragments (trans.)$q$, 'discipline'),
  ($q$Anyone can hold the helm when the sea is calm.$q$, $q$Publilius Syrus$q$, $q$Sentences (trans.)$q$, 'leadership'),
  ($q$Chance favours only the prepared mind.$q$, $q$Louis Pasteur$q$, $q$Lecture, University of Lille (1854, trans.)$q$, 'success'),
  ($q$If I have seen further it is by standing on the shoulders of giants.$q$, $q$Isaac Newton$q$, $q$Letter to Robert Hooke (1675)$q$, 'personal_growth'),
  ($q$Blessed is he who has found his work; let him ask no other blessedness.$q$, $q$Thomas Carlyle$q$, $q$Past and Present (1843)$q$, 'business'),
  ($q$Do the duty which lies nearest thee.$q$, $q$Thomas Carlyle$q$, $q$Sartor Resartus (1836)$q$, 'discipline'),
  ($q$Progress is impossible without change, and those who cannot change their minds cannot change anything.$q$, $q$George Bernard Shaw$q$, $q$Everybody's Political What's What? (1944)$q$, 'personal_growth'),
  ($q$When a man says yes his chi says yes also.$q$, $q$Chinua Achebe$q$, $q$Things Fall Apart (1958)$q$, 'personal_growth'),
  ($q$The lizard that jumped from the high iroko tree to the ground said he would praise himself if no one else did.$q$, $q$Chinua Achebe$q$, $q$Things Fall Apart (1958)$q$, 'success'),
  ($q$The man dies in all who keep silent in the face of tyranny.$q$, $q$Wole Soyinka$q$, $q$The Man Died (1972)$q$, 'leadership'),
  ($q$Slow and steady wins the race.$q$, $q$Aesop$q$, $q$Moral of The Tortoise and the Hare$q$, 'consistency'),
  ($q$Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.$q$, $q$Helen Keller$q$, $q$Optimism (1903)$q$, 'success'),
  ($q$You must do the thing you think you cannot do.$q$, $q$Eleanor Roosevelt$q$, $q$You Learn by Living (1960)$q$, 'personal_growth'),
  ($q$If you can't fly then run, if you can't run then walk, if you can't walk then crawl, but whatever you do you have to keep moving forward.$q$, $q$Martin Luther King Jr.$q$, $q$Spelman College address (1960)$q$, 'consistency'),
  ($q$Whatever the mind of man can conceive and believe, it can achieve.$q$, $q$Napoleon Hill$q$, $q$Think and Grow Rich (1937)$q$, 'success'),
  ($q$You can make more friends in two months by becoming interested in other people than you can in two years by trying to get other people interested in you.$q$, $q$Dale Carnegie$q$, $q$How to Win Friends and Influence People (1936)$q$, 'leadership'),
  ($q$Effective executives do first things first and they do one thing at a time.$q$, $q$Peter F. Drucker$q$, $q$The Effective Executive (1967)$q$, 'productivity'),
  ($q$There is nothing so useless as doing efficiently that which should not be done at all.$q$, $q$Peter F. Drucker$q$, $q$Managing for Business Effectiveness, Harvard Business Review (1963)$q$, 'business'),
  ($q$Begin with the end in mind.$q$, $q$Stephen R. Covey$q$, $q$The 7 Habits of Highly Effective People (1989)$q$, 'productivity'),
  ($q$Put first things first.$q$, $q$Stephen R. Covey$q$, $q$The 7 Habits of Highly Effective People (1989)$q$, 'productivity'),
  ($q$Seek first to understand, then to be understood.$q$, $q$Stephen R. Covey$q$, $q$The 7 Habits of Highly Effective People (1989)$q$, 'leadership'),
  ($q$A leader is one who knows the way, goes the way, and shows the way.$q$, $q$John C. Maxwell$q$, $q$The 21 Irrefutable Laws of Leadership (1998)$q$, 'leadership'),
  ($q$People don't buy what you do; they buy why you do it.$q$, $q$Simon Sinek$q$, $q$Start With Why (2009)$q$, 'business'),
  ($q$Price is what you pay. Value is what you get.$q$, $q$Warren Buffett$q$, $q$Berkshire Hathaway shareholder letter (2008)$q$, 'business'),
  ($q$Your most unhappy customers are your greatest source of learning.$q$, $q$Bill Gates$q$, $q$Business @ the Speed of Thought (1999)$q$, 'business'),
  ($q$The only way to do great work is to love what you do.$q$, $q$Steve Jobs$q$, $q$Stanford commencement address (2005)$q$, 'excellence'),
  ($q$Your time is limited, so don't waste it living someone else's life.$q$, $q$Steve Jobs$q$, $q$Stanford commencement address (2005)$q$, 'personal_growth'),
  ($q$I've failed over and over and over again in my life. And that is why I succeed.$q$, $q$Michael Jordan$q$, $q$Nike advertisement (1997)$q$, 'success'),
  ($q$Be quick, but don't hurry.$q$, $q$John Wooden$q$, $q$Wooden: A Lifetime of Observations (1997)$q$, 'excellence'),
  ($q$What is important is seldom urgent and what is urgent is seldom important.$q$, $q$Dwight D. Eisenhower$q$, $q$Address, Northwestern University (1954)$q$, 'productivity'),
  ($q$Alone we can do so little; together we can do so much.$q$, $q$Helen Keller$q$, $q$Quoted in Joseph P. Lash, Helen and Teacher (1980)$q$, 'leadership')
on conflict ((lower(text))) do nothing;

insert into public.knowledge_base_documents (slug, title, content, audience, link) values
  ('account-password', $q$Signing in, passwords and account access$q$, $q$To sign in, go to the login page and enter your e-mail and password. Forgot your password? Click "Forgot password?" on the login page, enter your e-mail, and follow the reset link we send you (check spam). Choose a new password of at least 10 characters with letters and numbers. To change your password while signed in, sign out and use "Forgot password?" to set a new one. If your account shows "Registration under review", the Super Admin has not approved it yet. If it says your account is not active, contact the Super Admin.$q$, '{team_member,administrator,super_admin}', $q$/login$q$),
  ('getting-started', $q$Getting started with Winners Team$q$, $q$Welcome to Winners Team! A good first day: 1) Complete your profile under "My Unified Profile" (job title, skills and the services you offer). 2) Add today's tasks under "My Tasks & Daily To-Dos". 3) Set this week's goals under "Weekly Goals" and this month's under "Monthly Goals". 4) Set your prospecting targets under "Prospecting Management". 5) Check your live score on the Dashboard and under "My Performance". 6) Set your notification preferences under "Notifications & Reminders". Ask LEX any time you are unsure how something works.$q$, '{team_member,administrator,super_admin}', $q$/dashboard$q$),
  ('roles-overview', $q$Roles: Team Member, Administrator and Super Admin$q$, $q$Winners Team has three roles. Team Members manage their own tasks, goals, prospecting, profile and reading, and see their own performance and accountability. Administrators manage an assigned team: they monitor members' work, performance and accountability, send team announcements and can remove team-member accounts; they cannot transfer members, create administrators or see other teams. The Super Admin manages the whole organisation: approving registrations, inviting administrators, assigning and transferring members, configuring settings and reviewing audit logs. Your administrator is shown on your dashboard as "Reporting to".$q$, '{team_member,administrator,super_admin}', null),
  ('troubleshooting', $q$Troubleshooting common problems$q$, $q$Can't edit a task or goal? Tasks and goals from closed days, weeks or months are locked because they have already been evaluated — ask the Super Admin for a correction. Verification or reset link says expired or invalid? Open the link in the same browser you used to register, or request a new one. Not receiving e-mails? Check your spam folder and your notification preferences. Score looks wrong? Remember categories with nothing due are excluded and the remaining weights rescale; see "My Performance" for the breakdown. Page not loading? Refresh the page or sign out and back in. If a problem continues, contact your administrator.$q$, '{team_member,administrator,super_admin}', null),
  ('dashboard-overview', $q$Understanding your dashboard$q$, $q$Your dashboard shows a greeting with your administrator, today's motivational quote, your composite performance score (switch between daily, weekly and monthly), the weighted breakdown of your five categories, today's tasks, your prospecting tracker, weekly and monthly goal progress, your current book, the latest service update and your accountability status. The target streak counts consecutive recorded days at 90% or more.$q$, '{team_member}', $q$/dashboard$q$),
  ('quotes-management', $q$Managing motivational quotes (Super Admin)$q$, $q$Under Settings → Quotes the Super Admin can add, edit and deactivate quotes, and import many at once from a CSV file with the columns text, author, source and category. Categories: discipline, consistency, success, business, leadership, excellence, personal_growth, productivity. Every quote must have an accurate author. A different quote is shown at each sign-in, avoiding the user's most recent ones.$q$, '{super_admin}', $q$/settings/quotes$q$)
on conflict (slug) do nothing;

-- >>> 20261122001400_cron_tokens.sql
-- =============================================================================
-- WINNERS TEAM — 0014 One-time tokens for database-scheduled calls (pg_cron)
-- pg_cron (running inside the database) calls the app's /api/cron/* routes
-- with a single-use token that only the database can issue. No shared secret
-- has to be copied into SQL. Tokens expire after 5 minutes and work once.
-- Safe to run more than once.
-- =============================================================================
create table if not exists public.cron_tokens (
  token      text primary key,
  created_at timestamptz not null default now()
);
alter table public.cron_tokens enable row level security;  -- no policies: API users can never read it
revoke all on public.cron_tokens from anon, authenticated;
grant all on public.cron_tokens to service_role;

-- Issued by pg_cron jobs (run as the database owner). Not callable through the API.
create or replace function public.cron_issue_token()
returns text language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.cron_tokens where created_at < now() - interval '1 hour';
  insert into public.cron_tokens (token) values (t);
  return t;
end $$;
revoke execute on function public.cron_issue_token() from public, anon, authenticated, service_role;

-- Checked by the app (service role): valid once, within 5 minutes.
create or replace function public.cron_consume_token(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cron_tokens where token = p_token and created_at > now() - interval '5 minutes';
  return found;
end $$;
revoke execute on function public.cron_consume_token(text) from public, anon, authenticated;
grant execute on function public.cron_consume_token(text) to service_role;

-- >>> 20261122001500_admin_promotion_and_books.sql
-- =============================================================================
-- WINNERS TEAM — 0015 "Make administrator" + verified book links + new titles
-- Safe to run more than once.
-- =============================================================================

-- Super Admin: turn an existing (pending or approved) team-member account into
-- an administrator — e.g. a manager who registered through the public form.
create or replace function public.make_administrator(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can create administrators');
  select * into v from public.profiles where id = p_user for update;
  perform private.require(found and v.role = 'team_member', 'Only a team-member account can be made an administrator');
  perform private.require(v.status in ('pending', 'approved'), 'The account is not active');
  update public.profiles
     set role = 'administrator', status = 'approved', team_leader_name = null,
         approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, (select auth.uid())), status_reason = null
   where id = p_user;
  -- An administrator does not report to another administrator.
  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid()) where member_id = p_user and ended_at is null;
  update public.registration_requests set decision = 'approved', decided_by = (select auth.uid()), decided_at = now()
   where profile_id = p_user and decision = 'pending';
  perform private.audit('account.made_administrator', 'profile', p_user::text, p_user,
    jsonb_build_object('role', v.role, 'status', v.status), jsonb_build_object('role', 'administrator', 'status', 'approved'));
  perform private.notify(p_user, 'registration', 'account.made_administrator', 'You are now a Winners Team administrator',
    'The Super Admin has given you administrator access. Sign in to manage your team.', '/admin', '{}', 'made-admin:' || p_user);
end $$;
revoke execute on function public.make_administrator(uuid) from public, anon;
grant execute on function public.make_administrator(uuid) to authenticated;

-- Public-domain classics: verified free scans on the Internet Archive
-- (Project Gutenberg search links replaced; read online + direct PDF).
update public.books set reading_url = 'https://archive.org/details/howtoliveon24hou00bennuoft', free_download_url = 'https://archive.org/download/howtoliveon24hou00bennuoft/howtoliveon24hou00bennuoft.pdf', license = 'public_domain' where title = $t$How to Live on 24 Hours a Day$t$;
update public.books set reading_url = 'https://archive.org/details/SelfHelp', free_download_url = 'https://archive.org/download/SelfHelp/SelfHelp.pdf', license = 'public_domain' where title = $t$Self-Help$t$;
update public.books set reading_url = 'https://archive.org/details/autobiobenfran00miffrich', free_download_url = 'https://archive.org/download/autobiobenfran00miffrich/autobiobenfran00miffrich.pdf', license = 'public_domain' where title = $t$The Autobiography of Benjamin Franklin$t$;
update public.books set reading_url = 'https://archive.org/details/asmanthinketh00alleiala', free_download_url = 'https://archive.org/download/asmanthinketh00alleiala/asmanthinketh00alleiala.pdf', license = 'public_domain' where title = $t$As a Man Thinketh$t$;
update public.books set reading_url = 'https://archive.org/details/meditationsofmar00marc', free_download_url = 'https://archive.org/download/meditationsofmar00marc/meditationsofmar00marc.pdf', license = 'public_domain' where title = $t$Meditations$t$;
update public.books set reading_url = 'https://archive.org/details/artofwaroldestmi00suntuoft', free_download_url = 'https://archive.org/download/artofwaroldestmi00suntuoft/artofwaroldestmi00suntuoft.pdf', license = 'public_domain' where title = $t$The Art of War$t$;
update public.books set reading_url = 'https://archive.org/details/artofpublicspeak00esen', free_download_url = 'https://archive.org/download/artofpublicspeak00esen/artofpublicspeak00esen.pdf', license = 'public_domain' where title = $t$The Art of Public Speaking$t$;
update public.books set reading_url = 'https://archive.org/details/p-t-barnum_the-art-of-money-getting_202302', free_download_url = 'https://archive.org/download/p-t-barnum_the-art-of-money-getting_202302/p-t-barnum_the-art-of-money-getting.pdf', license = 'public_domain' where title = $t$The Art of Money Getting$t$;
update public.books set reading_url = 'https://archive.org/details/cu31924029452467', free_download_url = 'https://archive.org/download/cu31924029452467/cu31924029452467.pdf', license = 'public_domain' where title = $t$Acres of Diamonds$t$;
update public.books set reading_url = 'https://archive.org/details/princemac00machuoft', free_download_url = 'https://archive.org/download/princemac00machuoft/princemac00machuoft.pdf', license = 'public_domain' where title = $t$The Prince$t$;

-- Commercial titles: official Open Library page (editions, borrowing, purchase). No download links.
update public.books set reading_url = 'https://openlibrary.org/works/OL17713267W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Deep Work$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL17930368W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Atomic Habits$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2392324W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Eat That Frog!$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2392356W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$The Psychology of Selling$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL20015117W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Fanatical Prospecting$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL16465202W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$The 4 Disciplines of Execution$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2010879W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Rich Dad Poor Dad$t$;

-- New commercial titles requested by the Super Admin (no free legal PDF exists).
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$There Is a Place Called Tomorrow$t$, $t$Habu Dawaki$t$, 'personal-development', $t$Vision & personal growth$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$There Is a Place Called Tomorrow$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Power of Decision Making$t$, $t$Manoj Tripath$t$, 'strategic-planning', $t$Decision making$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Power of Decision Making$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Ice Breakers!$t$, $t$Tom "Big Al" Schreiter$t$, 'sales', $t$Prospecting & starting conversations$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL27710826W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Ice Breakers!$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$$100M Offers$t$, $t$Alex Hormozi$t$, 'business-development', $t$Building irresistible offers$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL25037516W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$$100M Offers$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$You Can Win$t$, $t$Shiv Khera$t$, 'personal-development', $t$Attitude & success habits$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL8938318W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$You Can Win$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Go Pro$t$, $t$Eric Worre$t$, 'sales', $t$Network marketing & prospecting$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL17082196W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Go Pro$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Art of Saying No$t$, $t$Damon Zahariades$t$, 'time-management', $t$Boundaries & time management$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL20504357W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Art of Saying No$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Power of Self-Discipline$t$, $t$Peter Hollins$t$, 'discipline', $t$Self-discipline$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL26138830W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Power of Self-Discipline$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Art of Laziness$t$, $t$Library Mindset$t$, 'productivity', $t$Productivity & procrastination$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Art of Laziness$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Master Your Focus$t$, $t$Thibaut Meurisse$t$, 'productivity', $t$Focus & concentration$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL22433530W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Master Your Focus$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Leadership$t$, $t$Brian Tracy$t$, 'leadership', $t$Leadership$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL34323215W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Leadership$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Master Your Mindset$t$, $t$Mindset Reading$t$, 'personal-development', $t$Mindset$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Master Your Mindset$t$));

-- >>> 20261122001600_book_covers.sql
-- =============================================================================
-- WINNERS TEAM — 0016 Real book covers
-- Classics: scanned covers of the exact free editions (Internet Archive).
-- Commercial titles: official Open Library covers (?default=false → 404 if
-- missing, and the app then falls back to its generated cover).
-- Only fills books that have no cover yet. Safe to run more than once.
-- =============================================================================
update public.books set cover_url = 'https://archive.org/services/img/howtoliveon24hou00bennuoft' where cover_url is null and title = $t$How to Live on 24 Hours a Day$t$;
update public.books set cover_url = 'https://archive.org/services/img/SelfHelp' where cover_url is null and title = $t$Self-Help$t$;
update public.books set cover_url = 'https://archive.org/services/img/autobiobenfran00miffrich' where cover_url is null and title = $t$The Autobiography of Benjamin Franklin$t$;
update public.books set cover_url = 'https://archive.org/services/img/asmanthinketh00alleiala' where cover_url is null and title = $t$As a Man Thinketh$t$;
update public.books set cover_url = 'https://archive.org/services/img/meditationsofmar00marc' where cover_url is null and title = $t$Meditations$t$;
update public.books set cover_url = 'https://archive.org/services/img/artofwaroldestmi00suntuoft' where cover_url is null and title = $t$The Art of War$t$;
update public.books set cover_url = 'https://archive.org/services/img/artofpublicspeak00esen' where cover_url is null and title = $t$The Art of Public Speaking$t$;
update public.books set cover_url = 'https://archive.org/services/img/p-t-barnum_the-art-of-money-getting_202302' where cover_url is null and title = $t$The Art of Money Getting$t$;
update public.books set cover_url = 'https://archive.org/services/img/cu31924029452467' where cover_url is null and title = $t$Acres of Diamonds$t$;
update public.books set cover_url = 'https://archive.org/services/img/princemac00machuoft' where cover_url is null and title = $t$The Prince$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/7988607-M.jpg?default=false' where cover_url is null and title = $t$Deep Work$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12539702-M.jpg?default=false' where cover_url is null and title = $t$Atomic Habits$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/847534-M.jpg?default=false' where cover_url is null and title = $t$Eat That Frog!$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/13270498-M.jpg?default=false' where cover_url is null and title = $t$The Psychology of Selling$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12685538-M.jpg?default=false' where cover_url is null and title = $t$Fanatical Prospecting$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/9136687-M.jpg?default=false' where cover_url is null and title = $t$The 4 Disciplines of Execution$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/8315603-M.jpg?default=false' where cover_url is null and title = $t$Rich Dad Poor Dad$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12830137-M.jpg?default=false' where cover_url is null and title = $t$Ice Breakers!$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/11948182-M.jpg?default=false' where cover_url is null and title = $t$$100M Offers$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/6974809-M.jpg?default=false' where cover_url is null and title = $t$You Can Win$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12449352-M.jpg?default=false' where cover_url is null and title = $t$Go Pro$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/9159200-M.jpg?default=false' where cover_url is null and title = $t$The Art of Saying No$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12093579-M.jpg?default=false' where cover_url is null and title = $t$The Power of Self-Discipline$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/10459447-M.jpg?default=false' where cover_url is null and title = $t$Master Your Focus$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/13776386-M.jpg?default=false' where cover_url is null and title = $t$Leadership$t$;

-- >>> 20261122001700_reminder_email_quota.sql
-- =============================================================================
-- WINNERS TEAM — 0017 E-mail quota: reminders and deadlines in the app only
-- Routine reminders, deadline alerts and daily performance summaries are no longer
-- e-mailed (they still appear in the app and by push). Monthly-goal reminders and
-- monthly-goal deadlines are still e-mailed. Weekly and monthly deadline alerts are
-- now separate notifications so that only the monthly one is e-mailed.
-- =============================================================================

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

create or replace function private.run_reminders(p_force_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone private.org_tz();
  v_today date := v_now::date;
  v_week date := v_today - (extract(isodow from v_today)::int - 1);
  v_month date := date_trunc('month', v_today)::date;
  r public.reminder_schedules; m record; v_sent int; v_out jsonb := '{}'; v_n int; v_perf jsonb;
begin
  for r in select * from public.reminder_schedules order by local_time loop
    if not (r.kind = p_force_kind or (p_force_kind is null and private.reminder_due(r, v_now))) then continue; end if;
    v_sent := 0;
    for m in select p.id, p.full_name from public.profiles p where p.role = 'team_member' and p.status = 'approved' loop
      if r.kind = 'daily_plan' then
        select count(*) into v_n from public.tasks where owner_id = m.id and kind = 'daily' and due_date = v_today and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.daily_plan',
          case when v_n = 0 then 'Plan today''s to-do list' else 'You have ' || v_n || ' task(s) planned today' end,
          case when v_n = 0 then 'You have not added any daily tasks yet. Your daily to-do list carries the largest performance weight.'
               else 'Stay focused — complete them before the end of the day.' end,
          '/tasks', '{}', 'daily_plan:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'pending_tasks' then
        select count(*) into v_n from public.tasks where owner_id = m.id and due_date = v_today and deleted_at is null and status <> 'completed';
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.pending_tasks', v_n || ' task(s) still pending today',
            'Wrap them up before the day closes — closed days are locked for evaluation.', '/tasks', '{}', 'pending_tasks:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'overdue_tasks' then
        select count(*) into v_n from public.tasks where owner_id = m.id and due_date = v_today and due_time is not null
           and due_time < v_now::time and deleted_at is null and status <> 'completed';
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.overdue_tasks', v_n || ' task(s) are past their due time',
            'These tasks are overdue. Complete them today to protect your daily score.', '/tasks?filter=overdue', '{}', 'overdue_tasks:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'weekly_goals' then
        select count(*) into v_n from public.weekly_goals where owner_id = m.id and week_start = v_week and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.weekly_goals',
          case when v_n = 0 then 'Set your weekly goals' else 'New week — review your ' || v_n || ' weekly goal(s)' end,
          'Weekly goals carry 20% of your performance by default.', '/weekly-goals', '{}', 'weekly_goals:' || v_week);
        v_sent := v_sent + 1;
      elsif r.kind = 'weekly_progress' then
        select count(*) into v_n from public.weekly_goals where owner_id = m.id and week_start = v_week and deleted_at is null and achieved < target;
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.weekly_progress', v_n || ' weekly goal(s) not yet achieved',
            'Update your progress before the week closes.', '/weekly-goals', '{}', 'weekly_progress:' || v_week);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'monthly_goals' then
        select count(*) into v_n from public.monthly_goals where owner_id = m.id and month_start = v_month and deleted_at is null;
        perform private.notify(m.id, 'reminders', 'reminder.monthly_goals',
          case when v_n = 0 then 'Set your monthly goals' else 'New month — review your monthly goals' end,
          'Define measurable objectives for ' || to_char(v_month, 'FMMonth YYYY') || '.', '/monthly-goals', '{}', 'monthly_goals:' || v_month);
        v_sent := v_sent + 1;
      elsif r.kind = 'monthly_progress' then
        select count(*) into v_n from public.monthly_goals where owner_id = m.id and month_start = v_month and deleted_at is null and achieved < target;
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.monthly_progress', v_n || ' monthly goal(s) still open',
            'The month closes soon. Update your progress.', '/monthly-goals', '{}', 'monthly_progress:' || v_month);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'prospecting' then
        v_perf := private.compute_performance(m.id, 'daily', v_today);
        select count(*) into v_n from public.prospecting_targets where owner_id = m.id and period = 'daily' and period_start = v_today;
        perform private.notify(m.id, 'reminders', 'reminder.prospecting',
          case when v_n = 0 then 'Set today''s prospecting targets' else 'Prospecting check-in' end,
          case when v_n = 0 then 'No prospecting targets are set for today yet.'
               else 'You are at ' || coalesce((select (c ->> 'capped_pct') from jsonb_array_elements(v_perf -> 'categories') c where c ->> 'category' = 'prospecting'), '0') || '% of today''s prospecting target.' end,
          '/prospecting', '{}', 'prospecting:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'goal_deadlines' then
        -- Weekly deadlines: app and push only. Monthly deadlines: also by e-mail.
        select count(*) into v_n from public.weekly_goals
         where owner_id = m.id and deleted_at is null and achieved < target and deadline between v_today and v_today + 1;
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.goal_deadlines', v_n || ' weekly goal deadline(s) approaching',
            'Some weekly goals are due soon and not yet achieved.', '/weekly-goals', '{}', 'goal_deadlines:' || v_today);
          v_sent := v_sent + 1;
        end if;
        select count(*) into v_n from public.monthly_goals
         where owner_id = m.id and deleted_at is null and achieved < target and deadline between v_today and v_today + 3;
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.monthly_goal_deadlines', v_n || ' monthly goal deadline(s) approaching',
            'Some monthly goals are due soon and not yet achieved.', '/monthly-goals', '{}', 'monthly_goal_deadlines:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'performance_summary' then
        select overall_score into v_n from public.performance_snapshots
         where user_id = m.id and period_type = 'daily' and period_start = v_today - 1 and is_current;
        if found and v_n is not null then
          perform private.notify(m.id, 'performance', 'performance.daily_summary', 'Yesterday''s performance: ' || v_n || '%',
            'Open your performance dashboard to see the category breakdown.', '/performance', '{}', 'perf_summary:' || v_today);
          v_sent := v_sent + 1;
        end if;
      end if;
    end loop;
    if p_force_kind is null then
      update public.reminder_schedules set last_run_on = v_today where kind = r.kind;
    end if;
    v_out := v_out || jsonb_build_object(r.kind, v_sent);
  end loop;
  return v_out;
end $$;
revoke execute on function private.run_reminders(text) from public, authenticated;

-- Stop any routine reminder e-mails already queued.
update public.notifications set email_status = 'skipped'
 where email_status = 'pending'
   and (category in ('reminders', 'deadlines') or type = 'performance.daily_summary')
   and type not in ('reminder.monthly_goals', 'reminder.monthly_progress', 'reminder.monthly_goal_deadlines');

-- >>> 20261122001800_checklists.sql
-- =============================================================================
-- WINNERS TEAM — 0018 Checklists
--
-- Replaces the weighted 30/20/20/20/10 score and the "grade everything after
-- midnight" rule with checklists:
--  * A member creates any number of checklists (to-do, weekly goals, monthly
--    goals, prospecting), each with its own title and deadline.
--  * Items are marked 0/25/50/75/100%. Prospecting items have a target and a
--    count, and their percentage is worked out from them.
--  * A checklist's score is the plain average of its items. Each checklist is
--    judged on its own — no weights between lists.
--  * A checklist closes at its deadline or when its owner presses "Submit now".
--    It then locks. Below the pass mark, a spin unlocks immediately; if the
--    member does not spin within the grace period (15 minutes by default) the
--    system spins for them.
--  * Deadlines can be moved earlier, never later. Items can be changed until
--    the deadline.
--  * Old tasks, goals and prospecting records are kept as history.
-- =============================================================================

create type public.checklist_kind as enum ('todo', 'weekly', 'monthly', 'prospecting');

create table public.checklists (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id),
  kind          public.checklist_kind not null default 'todo',
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  deadline      timestamptz not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  closed_at     timestamptz,
  closed_reason text check (closed_reason in ('deadline', 'submitted')),
  score         numeric(5, 2) check (score between 0 and 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint checklists_closed check ((status = 'open') = (closed_at is null))
);
create index checklists_owner_deadline_idx on public.checklists (owner_id, deadline desc) where deleted_at is null;
create index checklists_open_due_idx on public.checklists (deadline) where status = 'open' and deleted_at is null;

create table public.checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  progress     numeric(5, 2) not null default 0 check (progress between 0 and 100),
  target       int check (target is null or target between 1 and 1000000),
  achieved     int not null default 0 check (achieved between 0 and 10000000),
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Ordinary items use the five steps; prospecting items (with a target) are calculated.
  constraint checklist_items_steps check (target is not null or progress in (0, 25, 50, 75, 100))
);
create index checklist_items_checklist_idx on public.checklist_items (checklist_id, position);

alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
-- Same rule as private.can_view_user (owner, Super Admin, or currently assigned
-- administrator), written so the role checks run ONCE per query instead of per row.
create or replace function private.my_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.member_id from public.admin_assignments a
    join public.profiles p on p.id = a.administrator_id
   where a.administrator_id = (select auth.uid()) and a.ended_at is null
     and p.role = 'administrator' and p.status = 'approved';
$$;
revoke execute on function private.my_member_ids() from public, anon;
grant execute on function private.my_member_ids() to authenticated;

create policy checklists_read on public.checklists for select to authenticated
  using (deleted_at is null and (
    (owner_id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_super_admin())
    or owner_id in (select private.my_member_ids())));
create policy checklist_items_read on public.checklist_items for select to authenticated
  using ((owner_id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_super_admin())
    or owner_id in (select private.my_member_ids()));
create index checklists_deadline_idx on public.checklists (deadline) where deleted_at is null;
create index checklist_items_owner_idx on public.checklist_items (owner_id);
-- All writes go through the functions below, which enforce the rules.
revoke insert, update, delete on public.checklists, public.checklist_items from authenticated, anon;
grant select on public.checklists, public.checklist_items to authenticated;
grant all on public.checklists, public.checklist_items to service_role;

-- Accountability: one event per failed checklist, with its own auto-spin time.
alter table public.accountability_events
  add column checklist_id uuid unique references public.checklists (id),
  add column auto_draw_at timestamptz;
alter table public.accountability_events drop constraint accountability_events_once;
create unique index accountability_events_period_once on public.accountability_events (user_id, period_type, period_start)
  where checklist_id is null;
create index accountability_events_auto_draw_idx on public.accountability_events (auto_draw_at) where auto_draw_at is not null;

alter table public.accountability_settings
  add column grace_minutes int not null default 15 check (grace_minutes between 5 and 240);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- "Office to-do list", "Sales weekly goals" … (no doubling if the title already says it).
create or replace function private.checklist_label(p_title text, p_kind public.checklist_kind)
returns text language sql immutable as $$
  select case when lower(btrim(p_title)) like '%' || k then btrim(p_title) else btrim(p_title) || ' ' || k end
    from (select case p_kind when 'todo' then 'to-do list' when 'weekly' then 'weekly goals'
                             when 'monthly' then 'monthly goals' else 'prospecting list' end as k) x;
$$;

-- Current score: final once closed, live average while open. Null when it has no items.
create or replace function private.checklist_current_score(p_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when c.status = 'closed' then c.score
              else (select round(avg(i.progress), 2) from public.checklist_items i where i.checklist_id = c.id) end
    from public.checklists c where c.id = p_id;
$$;

-- Load a checklist the caller owns and may still change.
create or replace function private.editable_checklist(p_id uuid)
returns public.checklists language plpgsql security definer set search_path = '' as $$
declare c public.checklists;
begin
  select * into c from public.checklists where id = p_id and deleted_at is null for update;
  perform private.require(found and c.owner_id = (select auth.uid()) and private.is_active_user(), 'Checklist not found');
  perform private.require(c.status = 'open' and c.deadline > now(),
    'This checklist has closed and can no longer be changed');
  return c;
end $$;

-- Close a checklist, record its final score and, below the pass mark, open a spin.
create or replace function private.close_checklist(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.checklists; v_score numeric; v_role public.app_role; v_set public.accountability_settings;
  v_level public.accountability_level; v_event uuid; v_due timestamptz; v_label text; v_tz text := private.org_tz();
  s date; e date; v_ptype public.period_type; v_cat public.perf_category; v_enabled boolean;
begin
  select * into c from public.checklists where id = p_id for update;
  if not found or c.status <> 'open' then return; end if;
  v_score := (select round(avg(i.progress), 2) from public.checklist_items i where i.checklist_id = p_id);
  update public.checklists set status = 'closed', closed_at = now(), closed_reason = p_reason, score = v_score, updated_at = now()
   where id = p_id;
  perform private.audit('checklist.closed', 'checklist', p_id::text, c.owner_id, null,
    jsonb_build_object('score', v_score, 'reason', p_reason, 'title', c.title, 'kind', c.kind));
  if v_score is null then return; end if;  -- empty checklist: nothing to grade

  v_label := private.checklist_label(c.title, c.kind);
  select role into v_role from public.profiles where id = c.owner_id;
  select * into v_set from public.accountability_settings where id;
  v_level := private.level_for(v_score);
  v_enabled := v_set.enabled and case c.kind when 'weekly' then v_set.evaluate_weekly
                                             when 'monthly' then v_set.evaluate_monthly else v_set.evaluate_daily end;

  if v_role <> 'team_member' or v_level = 'none' or not v_enabled then
    perform private.notify(c.owner_id, 'accountability', 'checklist.graded',
      'Your ' || v_label || ' scored ' || trim_scale(v_score) || '%' ||
        case when v_level = 'none' then '. Well done!' else '.' end,
      case when v_role = 'team_member' and v_level = 'none' then 'No consequence — you reached the pass mark.' end,
      '/' || case c.kind when 'todo' then 'tasks' when 'weekly' then 'weekly-goals' when 'monthly' then 'monthly-goals' else 'prospecting' end,
      jsonb_build_object('checklist_id', p_id, 'kind', c.kind), 'graded:' || p_id);
    return;
  end if;

  v_ptype := case c.kind when 'weekly' then 'weekly' when 'monthly' then 'monthly' else 'daily' end;
  select b.p_start, b.p_end into s, e from private.period_bounds(v_ptype, (c.deadline at time zone v_tz)::date) b;
  v_cat := case c.kind when 'todo' then 'daily_todo' when 'weekly' then 'weekly_goals'
                       when 'monthly' then 'monthly_goals' else 'prospecting' end;
  -- Grace runs from the deadline, or from the moment of submitting if earlier.
  v_due := least(c.deadline, now()) + make_interval(mins => v_set.grace_minutes);

  insert into public.accountability_events (user_id, period_type, period_start, period_end, performance_pct, level,
                                            triggering_category, category_pct, checklist_id, auto_draw_at)
  values (c.owner_id, v_ptype, s, e, v_score, v_level, v_cat, v_score, p_id, v_due)
  on conflict (checklist_id) do nothing
  returning id into v_event;
  if v_event is null then return; end if;

  perform private.audit('accountability.triggered', 'accountability_event', v_event::text, c.owner_id, null,
    jsonb_build_object('checklist_id', p_id, 'title', c.title, 'kind', c.kind, 'score', v_score, 'level', v_level));
  perform private.notify(c.owner_id, 'accountability', 'accountability.triggered',
    'Your ' || v_label || ' scored ' || trim_scale(v_score) || '%. Spin the wheel',
    'Spin by ' || to_char(v_due at time zone v_tz, 'FMHH12:MI AM') || ', or the system will spin for you.',
    '/accountability', jsonb_build_object('event_id', v_event, 'checklist_id', p_id, 'kind', c.kind), 'event:' || v_event);
end $$;
revoke execute on function private.close_checklist(uuid, text) from public, authenticated;

-- Close everything that is due, send "closes soon" reminders and auto-spin
-- overdue spins. Runs every minute (pg_cron) and whenever a member opens a page.
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
  return jsonb_build_object('closed', v_closed, 'auto_draws', v_draws);
end $$;
revoke execute on function private.sweep_checklists(uuid) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Member-facing functions (every write goes through these)
-- -----------------------------------------------------------------------------

create or replace function public.sync_my_checklists()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_user() then return '{}'; end if;
  return private.sweep_checklists((select auth.uid()));
end $$;

create or replace function public.cron_sweep_checklists()
returns jsonb language sql security definer set search_path = '' as $$ select private.sweep_checklists(null); $$;

-- p_deadline is a local date-time in the organisation's time zone.
-- p_items: [{"title": "...", "target": 20}] (target only for prospecting).
create or replace function public.create_checklist(p_kind public.checklist_kind, p_title text, p_deadline timestamp, p_items jsonb default '[]')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_deadline timestamptz; it jsonb; v_pos int := 0; v_title text; v_target int;
begin
  perform private.require(private.is_active_user(), 'Not authorised');
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 1 and 120, 'Give the checklist a title (up to 120 characters)');
  perform private.require(p_deadline is not null, 'Choose a deadline');
  v_deadline := p_deadline at time zone private.org_tz();
  perform private.require(v_deadline > now() + interval '1 minute', 'Choose a deadline in the future');
  perform private.require(v_deadline <= now() + interval '100 days', 'The deadline must be within the next 100 days');
  perform private.require(jsonb_typeof(coalesce(p_items, '[]')) = 'array' and jsonb_array_length(coalesce(p_items, '[]')) <= 100,
    'A checklist can have up to 100 items');

  insert into public.checklists (owner_id, kind, title, deadline)
  values ((select auth.uid()), p_kind, btrim(p_title), v_deadline) returning id into v_id;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_title := btrim(coalesce(it ->> 'title', ''));
    continue when v_title = '';
    perform private.require(char_length(v_title) <= 200, 'Item titles can be up to 200 characters');
    v_target := nullif(it ->> 'target', '')::int;
    if p_kind = 'prospecting' then
      perform private.require(v_target between 1 and 1000000, 'Each prospecting item needs a target number');
    else
      v_target := null;
    end if;
    v_pos := v_pos + 1;
    insert into public.checklist_items (checklist_id, owner_id, title, target, position)
    values (v_id, (select auth.uid()), v_title, v_target, v_pos);
  end loop;

  perform private.audit('checklist.created', 'checklist', v_id::text, (select auth.uid()), null,
    jsonb_build_object('kind', p_kind, 'title', btrim(p_title), 'deadline', v_deadline, 'items', v_pos));
  return v_id;
end $$;

-- Rename, or move the deadline EARLIER (never later).
create or replace function public.update_checklist(p_id uuid, p_title text, p_deadline timestamp default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.checklists; v_deadline timestamptz;
begin
  c := private.editable_checklist(p_id);
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 1 and 120, 'Give the checklist a title (up to 120 characters)');
  v_deadline := coalesce(p_deadline at time zone private.org_tz(), c.deadline);
  perform private.require(v_deadline <= c.deadline, 'A deadline can be moved earlier, but not later');
  perform private.require(v_deadline > now(), 'Choose a deadline in the future');
  update public.checklists set title = btrim(p_title), deadline = v_deadline, updated_at = now() where id = p_id;
  if v_deadline <> c.deadline then
    perform private.audit('checklist.deadline_moved', 'checklist', p_id::text, c.owner_id,
      jsonb_build_object('deadline', c.deadline), jsonb_build_object('deadline', v_deadline));
  end if;
end $$;

-- Delete: only for mistakes — within 15 minutes of creating it, or while it is still empty.
create or replace function public.delete_checklist(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.checklists;
begin
  c := private.editable_checklist(p_id);
  perform private.require(c.created_at > now() - interval '15 minutes'
      or not exists (select 1 from public.checklist_items where checklist_id = p_id),
    'A checklist can only be deleted within 15 minutes of creating it. It will be graded at its deadline.');
  update public.checklists set deleted_at = now(), updated_at = now() where id = p_id;
  perform private.audit('checklist.deleted', 'checklist', p_id::text, c.owner_id, jsonb_build_object('title', c.title), null);
end $$;

create or replace function public.add_checklist_item(p_checklist uuid, p_title text, p_target int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.checklists; v_id uuid;
begin
  c := private.editable_checklist(p_checklist);
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 1 and 200, 'Item titles can be up to 200 characters');
  perform private.require((select count(*) from public.checklist_items where checklist_id = p_checklist) < 100,
    'A checklist can have up to 100 items');
  if c.kind = 'prospecting' then
    perform private.require(p_target between 1 and 1000000, 'Set a target number for this prospecting item');
  end if;
  insert into public.checklist_items (checklist_id, owner_id, title, target, position)
  values (p_checklist, c.owner_id, btrim(p_title), case when c.kind = 'prospecting' then p_target end,
          coalesce((select max(position) from public.checklist_items where checklist_id = p_checklist), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;

-- Update an item: progress (0/25/50/75/100) for ordinary items, or achieved/target for prospecting.
create or replace function public.update_checklist_item(p_item uuid, p_title text default null, p_progress int default null,
                                                         p_achieved int default null, p_target int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.checklist_items; c public.checklists; v_target int; v_achieved int;
begin
  select * into i from public.checklist_items where id = p_item;
  perform private.require(found, 'Item not found');
  c := private.editable_checklist(i.checklist_id);
  if p_title is not null then
    perform private.require(char_length(btrim(p_title)) between 1 and 200, 'Item titles can be up to 200 characters');
  end if;
  if c.kind = 'prospecting' then
    v_target := coalesce(p_target, i.target);
    v_achieved := coalesce(p_achieved, i.achieved);
    perform private.require(v_target between 1 and 1000000, 'Set a target number for this prospecting item');
    perform private.require(v_achieved between 0 and 10000000, 'Enter how many you have done');
    update public.checklist_items set title = coalesce(btrim(p_title), title), target = v_target, achieved = v_achieved,
           progress = round(least(v_achieved::numeric / v_target, 1) * 100, 2), updated_at = now()
     where id = p_item;
  else
    perform private.require(p_progress is null or p_progress in (0, 25, 50, 75, 100), 'Progress must be 0, 25, 50, 75 or 100%');
    update public.checklist_items set title = coalesce(btrim(p_title), title), progress = coalesce(p_progress, progress), updated_at = now()
     where id = p_item;
  end if;
  update public.checklists set updated_at = now() where id = c.id;
end $$;

create or replace function public.delete_checklist_item(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.checklist_items; c public.checklists;
begin
  select * into i from public.checklist_items where id = p_item;
  perform private.require(found, 'Item not found');
  c := private.editable_checklist(i.checklist_id);
  delete from public.checklist_items where id = p_item;
  perform private.audit('checklist.item_removed', 'checklist', c.id::text, c.owner_id,
    jsonb_build_object('item', i.title, 'progress', i.progress), null);
end $$;

-- Finish early: grade now (and open the spin straight away if below the pass mark).
create or replace function public.submit_checklist(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.checklists; v_event uuid;
begin
  c := private.editable_checklist(p_id);
  perform private.require(exists (select 1 from public.checklist_items where checklist_id = p_id),
    'Add at least one item before submitting');
  perform private.close_checklist(p_id, 'submitted');
  select id into v_event from public.accountability_events where checklist_id = p_id;
  return jsonb_build_object('score', (select score from public.checklists where id = p_id), 'event_id', v_event);
end $$;

-- The owner spins. After the grace period the outcome is recorded as chosen by the system.
create or replace function public.spin_accountability(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_due timestamptz; v_id uuid; v_l public.accountability_ledger;
begin
  select user_id, auto_draw_at into v_user, v_due from public.accountability_events where id = p_event;
  perform private.require(v_user is not null and v_user = (select auth.uid()) and private.is_active_user(),
    'Only the team member this event belongs to can spin the wheel');
  v_id := private.draw_for_event(p_event, case when v_due is not null and v_due <= now() then 'system_auto' else 'user_spin' end);
  update public.accountability_ledger set revealed_at = coalesce(revealed_at, now()) where id = v_id;
  select * into v_l from public.accountability_ledger where id = v_id;
  return jsonb_build_object('ledger_id', v_l.id, 'category', v_l.category, 'quantity', v_l.quantity, 'unit', v_l.unit,
                            'currency', v_l.currency, 'winning_index', v_l.winning_index, 'sectors', v_l.pool,
                            'accommodation', v_l.accommodation_active, 'status', v_l.status, 'assigned_at', v_l.assigned_at);
end $$;

-- Super Admin settings: grace period in minutes replaces the old "auto-draw after N hours".
drop function public.update_accountability_settings(boolean, numeric, numeric, numeric, boolean, boolean, boolean, int);
create or replace function public.update_accountability_settings(
  p_enabled boolean, p_none numeric, p_low numeric, p_moderate numeric,
  p_daily boolean, p_weekly boolean, p_monthly boolean, p_grace_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can configure accountability');
  perform private.require(p_grace_minutes between 5 and 240, 'The spin window must be between 5 and 240 minutes');
  select to_jsonb(s) into v_old from public.accountability_settings s where id;
  update public.accountability_settings set enabled = p_enabled, threshold_none = p_none, threshold_low = p_low,
         threshold_moderate = p_moderate, evaluate_daily = p_daily, evaluate_weekly = p_weekly, evaluate_monthly = p_monthly,
         grace_minutes = p_grace_minutes, updated_at = now(), updated_by = (select auth.uid())
   where id;
  perform private.audit('settings.accountability', 'accountability_settings', 'singleton', null, v_old,
    (select to_jsonb(s) from public.accountability_settings s where id));
end $$;

-- -----------------------------------------------------------------------------
-- Performance: every checklist counts equally (simple average); no weights.
-- Same result shape as before so history, analytics and reports keep working.
-- -----------------------------------------------------------------------------
create or replace function private.compute_performance(p_user uuid, p_type public.period_type, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s date; e date; v_tz text := private.org_tz(); cats jsonb := '[]'; r record;
  v_total int; v_closed int; v_avg numeric; v_overall numeric;
begin
  select b.p_start, b.p_end into s, e from private.period_bounds(p_type, p_date) b;
  for r in select * from (values ('todo', 'daily_todo'), ('weekly', 'weekly_goals'), ('prospecting', 'prospecting'),
                                 ('monthly', 'monthly_goals')) v(kind, cat) loop
    select count(x.sc), count(x.sc) filter (where x.status = 'closed'), round(avg(x.sc), 2)
      into v_total, v_closed, v_avg
      from (select c.status, private.checklist_current_score(c.id) as sc
              from public.checklists c
             where c.owner_id = p_user and c.deleted_at is null and c.kind = r.kind::public.checklist_kind
               and (c.deadline at time zone v_tz)::date between s and e) x;
    cats := cats || jsonb_build_array(jsonb_build_object('category', r.cat, 'weight', 0, 'effective_weight', 0,
              'completed', v_closed, 'total', v_total, 'applicable', v_total > 0, 'raw_pct', v_avg, 'capped_pct', v_avg));
  end loop;
  cats := cats || jsonb_build_array(jsonb_build_object('category', 'additional_tasks', 'weight', 0, 'effective_weight', 0,
            'completed', 0, 'total', 0, 'applicable', false, 'raw_pct', null, 'capped_pct', null));

  select round(avg(private.checklist_current_score(c.id)), 2) into v_overall
    from public.checklists c
   where c.owner_id = p_user and c.deleted_at is null and (c.deadline at time zone v_tz)::date between s and e;

  return jsonb_build_object('user_id', p_user, 'period_type', p_type, 'period_start', s, 'period_end', e,
                            'overall', v_overall, 'weights', '{}'::jsonb, 'categories', cats);
end $$;
revoke execute on function private.compute_performance(uuid, public.period_type, date) from public, authenticated;

-- Closed periods are still snapshotted for history, but no longer trigger spins
-- (each checklist triggers its own when it closes).
create or replace function private.evaluate_period(p_user uuid, p_type public.period_type, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s date; e date;
begin
  select b.p_start, b.p_end into s, e from private.period_bounds(p_type, p_date) b;
  if e >= private.org_today() then return null; end if;
  if not exists (select 1 from public.performance_snapshots
                  where user_id = p_user and period_type = p_type and period_start = s and is_current) then
    perform private.record_snapshot(p_user, p_type, p_date, null);
  end if;
  return null;
end $$;
revoke execute on function private.evaluate_period(uuid, public.period_type, date) from public, authenticated;

-- Notifications: accountability e-mails only for monthly checklists.
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

-- Draw: messages now name the checklist.
create or replace function private.draw_for_event(p_event uuid, p_selected_by text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.accountability_events; v_existing uuid; v_pool jsonb; v_sectors jsonb;
  v_total bigint := 0; v_pick bigint; v_acc bigint := 0; v_idx int := -1; v_choice jsonb; v_id uuid; i int;
  v_admin uuid; v_label text; v_cl record; v_for text; v_kind text;
begin
  select * into v_ev from public.accountability_events where id = p_event for update;
  if not found then raise exception 'Accountability event not found'; end if;
  select id into v_existing from public.accountability_ledger where event_id = p_event;
  if v_existing is not null then return v_existing; end if;

  v_pool := private.eligible_pool(p_event);
  v_sectors := v_pool -> 'sectors';
  if jsonb_array_length(v_sectors) = 0 then
    perform private.notify_super_admins('accountability', 'accountability.no_options',
      'Accountability wheel has no active options', 'An event could not be drawn because no eligible options are active.',
      '/settings/accountability', jsonb_build_object('event_id', p_event), 'no-options:' || p_event);
    raise exception 'No eligible accountability options are active' using errcode = 'P0001';
  end if;

  select coalesce(sum((s ->> 'weight')::bigint), 0) into v_total from jsonb_array_elements(v_sectors) s;
  v_pick := private.secure_random_int(v_total);
  for i in 0 .. jsonb_array_length(v_sectors) - 1 loop
    v_acc := v_acc + (v_sectors -> i ->> 'weight')::bigint;
    if v_pick < v_acc then v_idx := i; exit; end if;
  end loop;
  v_choice := v_sectors -> v_idx;

  insert into public.accountability_ledger (event_id, user_id, option_id, category, quantity, unit, currency,
                                            accommodation_active, pool, winning_index, selected_by,
                                            revealed_at)
  values (p_event, v_ev.user_id, (v_choice ->> 'option_id')::uuid, (v_choice ->> 'category')::public.consequence_category,
          (v_choice ->> 'quantity')::numeric, v_choice ->> 'unit',
          case when v_choice ->> 'category' = 'financial_fine' then 'NGN' end,
          (v_pool ->> 'accommodation')::boolean, v_sectors, v_idx, p_selected_by,
          case when p_selected_by = 'user_spin' then now() end)
  returning id into v_id;

  v_label := case v_choice ->> 'category'
    when 'frog_jumps' then (v_choice ->> 'quantity')::numeric::int || ' frog jumps'
    when 'leg_raising' then (v_choice ->> 'quantity')::numeric::int || ' minutes of leg raising'
    when 'office_signatures' then 'collect signatures from ' || (v_choice ->> 'quantity')::numeric::int || ' other office(s)'
    else '₦' || to_char((v_choice ->> 'quantity')::numeric, 'FM999,999') || ' financial fine' end;

  perform private.audit('accountability.selected', 'accountability_ledger', v_id::text, v_ev.user_id, null,
    jsonb_build_object('category', v_choice ->> 'category', 'quantity', (v_choice ->> 'quantity')::numeric,
                       'event_id', p_event, 'level', v_ev.level, 'accommodation', (v_pool ->> 'accommodation')::boolean),
    'success', jsonb_build_object('selected_by', p_selected_by, 'pool_size', jsonb_array_length(v_sectors)));

  -- What the outcome is for: a checklist (current rule) or a whole period (records before checklists).
  select c.title, c.kind into v_cl from public.checklists c where c.id = v_ev.checklist_id;
  v_for := case when v_ev.checklist_id is not null
                then 'Your ' || private.checklist_label(v_cl.title, v_cl.kind) || ' scored ' || trim_scale(v_ev.performance_pct) || '%.'
                else 'Your ' || v_ev.period_type || ' performance was ' || v_ev.performance_pct || '%.' end;
  v_kind := case when v_cl.kind is not null then v_cl.kind::text else v_ev.period_type::text end;

  perform private.notify(v_ev.user_id, 'accountability', 'accountability.assigned',
    'Accountability assigned: ' || v_label,
    v_for || case when p_selected_by = 'system_auto' then ' The wheel was spun for you because the 15-minute window passed.' else '' end
      || ' Open Accountability to track completion.',
    '/accountability', jsonb_build_object('ledger_id', v_id, 'kind', v_kind), 'ledger:' || v_id);
  v_admin := private.current_admin_of(v_ev.user_id);
  if v_admin is not null then
    perform private.notify(v_admin, 'accountability', 'accountability.member_assigned',
      (select full_name from public.profiles where id = v_ev.user_id) || ': ' || v_label,
      replace(v_for, 'Your ', 'Their '),
      '/team/' || v_ev.user_id, jsonb_build_object('ledger_id', v_id, 'kind', v_kind), 'ledger-admin:' || v_id);
  end if;
  return v_id;
end $$;
revoke execute on function private.draw_for_event(uuid, text) from public, authenticated;

-- -----------------------------------------------------------------------------
-- Reminders now talk about checklists. (A 30-minute "closes soon" heads-up per
-- checklist is sent by the every-minute sweep.)
-- -----------------------------------------------------------------------------
create or replace function private.run_reminders(p_force_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := private.org_tz();
  v_now timestamp := now() at time zone v_tz;
  v_today date := v_now::date;
  v_week date := v_today - (extract(isodow from v_today)::int - 1);
  v_month date := date_trunc('month', v_today)::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  r public.reminder_schedules; m record; v_sent int; v_out jsonb := '{}'; v_n int; v_avg numeric;
begin
  for r in select * from public.reminder_schedules order by local_time loop
    if not (r.kind = p_force_kind or (p_force_kind is null and private.reminder_due(r, v_now))) then continue; end if;
    v_sent := 0;
    for m in select p.id, p.full_name from public.profiles p where p.role = 'team_member' and p.status = 'approved' loop
      if r.kind = 'daily_plan' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'todo' and (c.deadline at time zone v_tz)::date = v_today;
        perform private.notify(m.id, 'reminders', 'reminder.daily_plan',
          case when v_n = 0 then 'Create today''s to-do checklist' else 'You have ' || v_n || ' to-do checklist(s) due today' end,
          case when v_n = 0 then 'Add a checklist with a title and a deadline. Each checklist is graded on its own at its deadline.'
               else 'Mark each item 0–100% as you go. Each checklist is graded at its deadline.' end,
          '/tasks', '{}', 'daily_plan:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'pending_tasks' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.status = 'open' and (c.deadline at time zone v_tz)::date = v_today
           and exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.progress < 100);
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.pending_tasks', v_n || ' checklist(s) still open today',
            'Each one is graded at its deadline. Update your items, or press Submit now when you are done.', '/tasks', '{}', 'pending_tasks:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'weekly_goals' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'weekly' and (c.deadline at time zone v_tz)::date between v_week and v_week + 6;
        perform private.notify(m.id, 'reminders', 'reminder.weekly_goals',
          case when v_n = 0 then 'Create this week''s goals checklist' else 'New week — review your ' || v_n || ' weekly goals checklist(s)' end,
          'Weekly goals are a checklist with its own deadline and are graded on their own.', '/weekly-goals', '{}', 'weekly_goals:' || v_week);
        v_sent := v_sent + 1;
      elsif r.kind = 'weekly_progress' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'weekly' and c.status = 'open'
           and exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.progress < 100);
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.weekly_progress', v_n || ' weekly goals checklist(s) not finished',
            'Update your progress before the deadline.', '/weekly-goals', '{}', 'weekly_progress:' || v_week);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'monthly_goals' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'monthly' and (c.deadline at time zone v_tz)::date between v_month and v_month_end;
        perform private.notify(m.id, 'reminders', 'reminder.monthly_goals',
          case when v_n = 0 then 'Set your monthly goals' else 'New month — review your monthly goals' end,
          'Create a monthly goals checklist for ' || to_char(v_month, 'FMMonth YYYY') || ' with its own deadline.', '/monthly-goals', '{}', 'monthly_goals:' || v_month);
        v_sent := v_sent + 1;
      elsif r.kind = 'monthly_progress' then
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'monthly' and c.status = 'open'
           and exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.progress < 100);
        if v_n > 0 then
          perform private.notify(m.id, 'reminders', 'reminder.monthly_progress', v_n || ' monthly goals checklist(s) still open',
            'The month closes soon. Update your progress before the deadline.', '/monthly-goals', '{}', 'monthly_progress:' || v_month);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'prospecting' then
        select count(*), round(avg(private.checklist_current_score(c.id)), 0) into v_n, v_avg from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'prospecting' and (c.deadline at time zone v_tz)::date = v_today;
        perform private.notify(m.id, 'reminders', 'reminder.prospecting',
          case when v_n = 0 then 'Create today''s prospecting checklist' else 'Prospecting check-in' end,
          case when v_n = 0 then 'Add your targets (for example, contact 20 prospects) with a deadline.'
               else 'You are at ' || coalesce(v_avg, 0) || '% on today''s prospecting.' end,
          '/prospecting', '{}', 'prospecting:' || v_today);
        v_sent := v_sent + 1;
      elsif r.kind = 'goal_deadlines' then
        -- Monthly goals due within 3 days (e-mailed). Other deadlines get the 30-minute heads-up.
        select count(*) into v_n from public.checklists c
         where c.owner_id = m.id and c.deleted_at is null and c.kind = 'monthly' and c.status = 'open'
           and (c.deadline at time zone v_tz)::date between v_today and v_today + 3
           and exists (select 1 from public.checklist_items i where i.checklist_id = c.id and i.progress < 100);
        if v_n > 0 then
          perform private.notify(m.id, 'deadlines', 'reminder.monthly_goal_deadlines', v_n || ' monthly goals checklist(s) due soon',
            'Some monthly goals are due within 3 days and are not finished yet.', '/monthly-goals', '{}', 'monthly_goal_deadlines:' || v_today);
          v_sent := v_sent + 1;
        end if;
      elsif r.kind = 'performance_summary' then
        select overall_score into v_n from public.performance_snapshots
         where user_id = m.id and period_type = 'daily' and period_start = v_today - 1 and is_current;
        if found and v_n is not null then
          perform private.notify(m.id, 'performance', 'performance.daily_summary', 'Yesterday''s performance: ' || v_n || '%',
            'Open your performance dashboard to see the category breakdown.', '/performance', '{}', 'perf_summary:' || v_today);
          v_sent := v_sent + 1;
        end if;
      end if;
    end loop;
    if p_force_kind is null then
      update public.reminder_schedules set last_run_on = v_today where kind = r.kind;
    end if;
    v_out := v_out || jsonb_build_object(r.kind, v_sent);
  end loop;
  return v_out;
end $$;
revoke execute on function private.run_reminders(text) from public, authenticated;

update public.reminder_schedules set label = 'Create today''s to-do checklist' where kind = 'daily_plan';
update public.reminder_schedules set label = 'Open checklists reminder' where kind = 'pending_tasks';
update public.reminder_schedules set label = 'Overdue task alert (not used: checklists close automatically)', enabled = false where kind = 'overdue_tasks';
update public.reminder_schedules set label = 'Weekly goals checklist (Monday)' where kind = 'weekly_goals';
update public.reminder_schedules set label = 'Weekly goals progress (Friday)' where kind = 'weekly_progress';
update public.reminder_schedules set label = 'Monthly goals checklist (1st)' where kind = 'monthly_goals';
update public.reminder_schedules set label = 'Monthly goals progress (3 days to go)' where kind = 'monthly_progress';
update public.reminder_schedules set label = 'Prospecting checklist check-in' where kind = 'prospecting';
update public.reminder_schedules set label = 'Monthly goals due within 3 days' where kind = 'goal_deadlines';

-- -----------------------------------------------------------------------------
-- Help centre (LEX answers from these)
-- -----------------------------------------------------------------------------
update public.knowledge_base_documents set title = 'Creating and managing to-do checklists', content =
'Open "My Tasks & Daily To-Dos" and press "New checklist". Give it a title and a deadline (date and time) — you can have as many to-do checklists as you need, each with its own deadline. Add your items, then mark each one 0%, 25%, 50%, 75% or 100% as you work. The checklist''s score is the average of its items: for example 100 + 75 + 50 + 25 + 0 = 250 ÷ 5 = 50%. You can add, rename and update items until the deadline. A deadline can be moved earlier but never later. When you are done early, press "Submit now" to grade it straight away. At the deadline the checklist closes and locks automatically. If the score is below the pass mark, a spin unlocks on the Accountability page.'
where slug = 'daily-tasks';
update public.knowledge_base_documents set title = 'Additional tasks', content =
'Additional tasks are now part of your to-do checklists: simply add them as items in a to-do checklist (or create a separate checklist for them with its own title and deadline). Your old additional tasks are kept as history.'
where slug = 'additional-tasks';
update public.knowledge_base_documents set content =
'Open "Weekly Goals" and press "New checklist". Give it a title and a deadline, add your goals as items and mark each one 0%, 25%, 50%, 75% or 100%. The checklist is graded on its own at its deadline (or when you press "Submit now"); below the pass mark a spin unlocks. A deadline can be moved earlier but never later.'
where slug = 'weekly-goals';
update public.knowledge_base_documents set content =
'Open "Monthly Goals" and press "New checklist". Give it a title and a deadline, add your goals as items and mark each one 0%, 25%, 50%, 75% or 100%. The checklist is graded on its own at its deadline (or when you press "Submit now"); below the pass mark a spin unlocks. You also get an e-mail reminder for monthly goals.'
where slug = 'monthly-goals';
update public.knowledge_base_documents set title = 'Prospecting checklists', content =
'Open "Prospecting Management" and press "New checklist". Give it a title and a deadline, then add each target as an item with a number — for example "Contact prospects: 20". As you work, enter how many you have done; the item''s percentage is worked out for you (12 of 20 = 60%, capped at 100%). The checklist''s score is the average of its items and it is graded on its own at its deadline or when you press "Submit now".'
where slug = 'prospecting';
update public.knowledge_base_documents set title = 'How your scores are calculated', content =
'Every checklist is scored on its own, out of 100%. Ordinary items are marked 0, 25, 50, 75 or 100%; prospecting items are calculated from your count and target. A checklist''s score is the plain average of its items. There are no weights between lists: to-do, weekly goals, monthly goals and prospecting checklists are each judged independently, and if you have several checklists each is graded separately. "My Performance" also shows a simple average of all your checklists in a day, week or month — this is for information and comparison only and never triggers a spin. Past periods are stored as snapshots for history.'
where slug = 'performance-calculation';
update public.knowledge_base_documents set content =
'Each checklist is graded when it closes — at its deadline, or straight away when you press "Submit now". Its score is compared with the pass marks: 90–100% no consequence, 75–89% low, 50–74% moderate, below 50% high. Below 90%, you are notified ("Your … to-do list scored 50%. Spin the wheel") and a Spin button appears on the Accountability page immediately. You have 15 minutes after the deadline to spin; after that the system spins for you. When you spin, the server securely selects the outcome from the eligible options and it is assigned to you immediately — there is no approval step and it cannot be re-rolled. Only four consequence types exist: frog jumps (10–400), leg raising (10–60 minutes), collecting signatures from other offices (1–10 offices) and a financial fine (₦200–₦5,000). Fines are recorded only; nothing is deducted automatically. If physical activity is unsafe for you, turn on Physical Accommodation and physical options are excluded. Update the status to In progress or Completed when you carry it out.'
where slug = 'accountability-wheel';
update public.knowledge_base_documents set content =
'Your dashboard shows a greeting with your administrator, today''s motivational quote, your open checklists with their deadlines and live scores, your recently graded checklists, your average score for the day, week or month (for information only), your current book, the latest service update and your accountability status, including any spin waiting for you.'
where slug = 'dashboard-overview';
update public.knowledge_base_documents set content =
'Welcome to Winners Team! A good first day: 1) Complete your profile under "My Unified Profile" (job title, skills and the services you offer). 2) Create today''s to-do checklist under "My Tasks & Daily To-Dos" — give it a title and a deadline and add your items. 3) Create checklists for this week''s and this month''s goals under "Weekly Goals" and "Monthly Goals". 4) Create a prospecting checklist with your targets under "Prospecting Management". 5) Mark your items 0–100% as you work; each checklist is graded at its deadline. 6) Set your notification preferences under "Notifications & Reminders". Ask LEX any time you are unsure how something works.'
where slug = 'getting-started';
update public.knowledge_base_documents set content =
'Can''t edit a checklist? Checklists lock at their deadline (or when you press Submit now) because they have been graded. Can''t move a deadline later? Deadlines can only be moved earlier. Can''t delete a checklist? Checklists can only be deleted within 15 minutes of creating them, or while they are still empty. Verification or reset link says expired or invalid? Open the link in the same browser you used to register, or request a new one. Not receiving e-mails? Check your spam folder and your notification preferences; most reminders arrive in the app and by browser notification. Page not loading? Refresh the page or sign out and back in. If a problem continues, contact your administrator.'
where slug = 'troubleshooting';
update public.knowledge_base_documents set content =
'System Settings contains accountability pass marks and the spin window (minutes after a deadline before the system spins automatically), the wheel sector editor (only the four permitted categories with their limits), reminder schedules, service update sources, books, quotes, LEX knowledge base articles and general settings. All changes are audited.'
where slug = 'super-admin-settings';
update public.knowledge_base_documents set content = replace(replace(content, 'their own tasks, goals, prospecting', 'their own checklists'), 'monitor members'' work', 'monitor members'' checklists')
where slug = 'roles-overview';
update public.knowledge_base_documents set content =
'Administrators see only the team members currently assigned to them. The Administrator dashboard shows team scores, open checklists due today and accountability outcomes. Open a member to view their profile, checklists and history. Use "Send announcement" to message your team. Administrators can remove any team-member account (soft removal that preserves history) but cannot transfer members, create administrators or view other teams'' records.'
where slug = 'admin-team';

-- -----------------------------------------------------------------------------
-- Grants and scheduling
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from anon, public;
grant execute on function public.sync_my_checklists(), public.create_checklist(public.checklist_kind, text, timestamp, jsonb),
  public.update_checklist(uuid, text, timestamp), public.delete_checklist(uuid), public.add_checklist_item(uuid, text, int),
  public.update_checklist_item(uuid, text, int, int, int), public.delete_checklist_item(uuid), public.submit_checklist(uuid),
  public.spin_accountability(uuid),
  public.update_accountability_settings(boolean, numeric, numeric, numeric, boolean, boolean, boolean, int) to authenticated;
revoke execute on function public.cron_sweep_checklists() from authenticated;
grant execute on function public.cron_sweep_checklists() to service_role;

-- Close checklists every minute, right inside the database (no app call needed),
-- and deliver push/e-mail every 2 minutes so "Spin the wheel" arrives promptly.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('winners-checklists', '* * * * *', 'select private.sweep_checklists(null)');
    perform cron.alter_job(jobid, schedule => '*/2 * * * *') from cron.job where jobname = 'winners-dispatch';
  end if;
end $$;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000100', 'core_identity') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000200', 'governance_workflows') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000300', 'productivity') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000400', 'performance') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000500', 'accountability') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000600', 'growth_updates_lex') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000700', 'scheduling_storage') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000800', 'reference_data') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122000900', 'realtime') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001000', 'backfill') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001100', 'harden_function_grants') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001200', 'explicit_api_grants') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001300', 'more_quotes_and_help') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001400', 'cron_tokens') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001500', 'admin_promotion_and_books') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001600', 'book_covers') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001700', 'reminder_email_quota') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261122001800', 'checklists') on conflict do nothing;
commit;
