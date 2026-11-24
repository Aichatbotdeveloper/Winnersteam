-- =============================================================================
-- WINNERS TEAM — 0022 Weekly and monthly AI summaries
-- Every Monday 07:00 (previous week) and on the 1st at 07:00 (previous month),
-- members get a personal summary, administrators a team summary and the Super
-- Admin an organisation summary: numbers plus a short AI-written note. They are
-- written by the app server (service role) and announced in the app and by push.
-- =============================================================================

create table public.performance_summaries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  scope        text not null check (scope in ('member', 'team', 'organisation')),
  period_type  text not null check (period_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end   date not null,
  stats        jsonb not null,
  ai_text      text,
  ai_used      boolean not null default false,
  delivered    boolean not null default true,  -- false = nothing to report (no notification sent)
  created_at   timestamptz not null default now(),
  constraint performance_summaries_once unique (user_id, scope, period_type, period_start)
);
create index performance_summaries_user_idx on public.performance_summaries (user_id, period_start desc);

alter table public.performance_summaries enable row level security;
create policy performance_summaries_read on public.performance_summaries for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_super_admin()));
revoke all on public.performance_summaries from anon, authenticated;
grant select on public.performance_summaries to authenticated;
grant all on public.performance_summaries to service_role;

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

-- Called by the app server after writing a summary.
create or replace function public.notify_summary_ready(p_user uuid, p_period_type text, p_period_start date, p_summary uuid, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  select private.notify(p_user, 'performance', 'summary.' || p_period_type, p_title, p_body, '/summaries?id=' || p_summary,
    jsonb_build_object('summary_id', p_summary), 'summary:' || p_period_type || ':' || p_period_start);
$$;
revoke execute on function public.notify_summary_ready(uuid, text, date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify_summary_ready(uuid, text, date, uuid, text, text) to service_role;
