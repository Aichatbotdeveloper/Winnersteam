-- =============================================================================
-- WINNERS TEAM — 0021 Receipt clean-up
-- Receipt files are removed 60 days after the administrator decides (confirmed
-- or not received). Receipts still waiting for confirmation are never removed.
-- Replaced receipts (from "Pay again") and abandoned uploads are removed after a day.
-- The payment record itself (amount, dates, bank details used, who confirmed) is kept.
-- =============================================================================

alter table public.fine_payments add column receipt_deleted_at timestamptz;

-- Files the daily job should delete (the app deletes them through the Storage API).
create or replace function public.receipts_to_delete(p_days int default 60, p_min_age_minutes int default 1440)
returns table (path text) language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'fine-receipts'
     and o.created_at < now() - make_interval(mins => p_min_age_minutes)
     and not exists (
       select 1 from public.fine_payments f
        where f.receipt_path = o.name
          and (f.status = 'submitted' or f.decided_at > now() - make_interval(days => p_days)))
   order by o.created_at
   limit 1000;
$$;
revoke execute on function public.receipts_to_delete(int, int) from public, anon, authenticated;
grant execute on function public.receipts_to_delete(int, int) to service_role;
