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
