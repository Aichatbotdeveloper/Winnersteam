-- =============================================================================
-- WINNERS TEAM — hourly reminders & frequent delivery using Supabase pg_cron
--
-- Paste this whole file into Supabase → SQL Editor → + New query → Run.
-- It contains NO secrets and is safe to run again (it replaces its own jobs).
--
-- What it schedules (times in UTC; Lagos = UTC+1):
--   winners-reminders        every hour at :05  → creates due reminders (in-database)
--   winners-dispatch         every 10 minutes   → app sends pending e-mails / push
--   winners-service-updates  every 6 hours      → app fetches approved update sources
-- Daily evaluations keep running from Vercel Cron.
--
-- Calls to the app use single-use tokens issued by the database
-- (public.cron_issue_token), so no shared secret is stored here.
-- =============================================================================

-- 1) Extensions (no-ops if already enabled)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 2) One-time tokens for database → app calls (same as migration 0014)
create table if not exists public.cron_tokens (
  token      text primary key,
  created_at timestamptz not null default now()
);
alter table public.cron_tokens enable row level security;
revoke all on public.cron_tokens from anon, authenticated;
grant all on public.cron_tokens to service_role;

create or replace function public.cron_issue_token()
returns text language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.cron_tokens where created_at < now() - interval '1 hour';
  insert into public.cron_tokens (token) values (t);
  return t;
end $$;
revoke execute on function public.cron_issue_token() from public, anon, authenticated, service_role;

create or replace function public.cron_consume_token(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cron_tokens where token = p_token and created_at > now() - interval '5 minutes';
  return found;
end $$;
revoke execute on function public.cron_consume_token(text) from public, anon, authenticated;
grant execute on function public.cron_consume_token(text) to service_role;

-- 3) Replace any previous Winners Team jobs, then schedule them
select cron.unschedule(jobid) from cron.job where jobname like 'winners-%';

select cron.schedule('winners-reminders', '5 * * * *',
  $job$ select public.cron_run_reminders(); $job$);

select cron.schedule('winners-dispatch', '*/10 * * * *',
  $job$ select net.http_get(
          url := 'https://winnersteam.automifyco.com/api/cron/dispatch',
          headers := jsonb_build_object('x-cron-token', public.cron_issue_token()),
          timeout_milliseconds := 60000); $job$);

select cron.schedule('winners-service-updates', '20 */6 * * *',
  $job$ select net.http_get(
          url := 'https://winnersteam.automifyco.com/api/cron/service-updates',
          headers := jsonb_build_object('x-cron-token', public.cron_issue_token()),
          timeout_milliseconds := 120000); $job$);

-- 4) Show what is now scheduled
select jobname, schedule, active from cron.job where jobname like 'winners-%' order by jobname;
