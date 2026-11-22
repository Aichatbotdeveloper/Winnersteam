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
