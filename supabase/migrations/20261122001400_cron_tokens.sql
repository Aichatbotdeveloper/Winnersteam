-- =============================================================================
-- WINNERS TEAM — 0014 One-time tokens for database-scheduled calls (pg_cron)
-- pg_cron (running inside the database) calls the app's /api/cron/* routes
-- with a single-use token that only the database can issue. No shared secret
-- has to be copied into SQL. Tokens expire after 5 minutes and work once.
-- Safe to run more than once.
-- =============================================================================
create table if not exists public.cron_tokens (
  token      text primary key,
  created_at timestamptz not null default now()
);
alter table public.cron_tokens enable row level security;  -- no policies: API users can never read it
revoke all on public.cron_tokens from anon, authenticated;
grant all on public.cron_tokens to service_role;

-- Issued by pg_cron jobs (run as the database owner). Not callable through the API.
create or replace function public.cron_issue_token()
returns text language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.cron_tokens where created_at < now() - interval '1 hour';
  insert into public.cron_tokens (token) values (t);
  return t;
end $$;
revoke execute on function public.cron_issue_token() from public, anon, authenticated, service_role;

-- Checked by the app (service role): valid once, within 5 minutes.
create or replace function public.cron_consume_token(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cron_tokens where token = p_token and created_at > now() - interval '5 minutes';
  return found;
end $$;
revoke execute on function public.cron_consume_token(text) from public, anon, authenticated;
grant execute on function public.cron_consume_token(text) to service_role;
