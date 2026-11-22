-- Service-role utility: record daily/weekly snapshots for the last N closed days
-- (history for charts and weakness detection). Does NOT create accountability
-- events — those come only from the scheduled evaluation of recent periods.
create or replace function public.cron_backfill_snapshots(p_days int default 14)
returns int language plpgsql security definer set search_path = '' as $$
declare m record; d int; v_today date := private.org_today(); v_n int := 0;
begin
  for m in select id from public.profiles where role = 'team_member' and status = 'approved' loop
    for d in 1..least(greatest(p_days, 1), 120) loop
      if not exists (select 1 from public.performance_snapshots where user_id = m.id and period_type = 'daily' and period_start = v_today - d and is_current) then
        perform private.record_snapshot(m.id, 'daily', v_today - d, null); v_n := v_n + 1;
      end if;
      if extract(isodow from v_today - d) = 7 and not exists (
        select 1 from public.performance_snapshots where user_id = m.id and period_type = 'weekly' and period_start = v_today - d - 6 and is_current) then
        perform private.record_snapshot(m.id, 'weekly', v_today - d, null); v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;
revoke execute on function public.cron_backfill_snapshots(int) from public, anon, authenticated;
grant execute on function public.cron_backfill_snapshots(int) to service_role;
