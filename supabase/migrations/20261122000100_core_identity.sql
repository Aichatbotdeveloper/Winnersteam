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
