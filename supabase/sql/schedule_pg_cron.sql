-- =============================================================================
-- OPTIONAL: run Winners Team scheduled processing inside Supabase (pg_cron).
-- Run once in the Supabase SQL editor of your production project after
-- enabling the pg_cron and pg_net extensions (Database → Extensions).
-- Replace <SITE_URL> and <CRON_SECRET> below. Times are UTC (Lagos = UTC+1).
-- =============================================================================

-- Reminders: hourly (the database decides which schedules are due; deduplicated).
select cron.schedule('winners-reminders', '5 * * * *', $$ select public.cron_run_reminders(); $$);

-- Evaluations + automatic draws: daily at 00:15 Africa/Lagos (23:15 UTC).
select cron.schedule('winners-evaluations', '15 23 * * *', $$ select public.cron_run_evaluations(); $$);

-- E-mail / push delivery: every 10 minutes (needs the web app for Resend / Web Push).
select cron.schedule('winners-dispatch', '*/10 * * * *', $$
  select net.http_get(url := '<SITE_URL>/api/cron/dispatch', headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'));
$$);

-- Service updates: every 6 hours.
select cron.schedule('winners-service-updates', '20 */6 * * *', $$
  select net.http_get(url := '<SITE_URL>/api/cron/service-updates', headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'), timeout_milliseconds := 120000);
$$);

-- To remove: select cron.unschedule('winners-reminders'); (etc.)
