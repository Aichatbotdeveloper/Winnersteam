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
