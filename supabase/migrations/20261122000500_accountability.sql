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
