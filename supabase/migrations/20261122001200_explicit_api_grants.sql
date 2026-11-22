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
