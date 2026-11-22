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
