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
