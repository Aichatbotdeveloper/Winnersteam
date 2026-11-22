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
