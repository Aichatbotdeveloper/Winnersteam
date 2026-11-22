-- Live notification bell: Realtime respects RLS (users only receive their own rows).
alter publication supabase_realtime add table public.notifications;
