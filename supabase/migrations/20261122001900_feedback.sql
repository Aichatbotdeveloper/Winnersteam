-- =============================================================================
-- WINNERS TEAM — 0019 Feedback ("Talk to the developer")
-- Visitors and members send feedback from a form. It is stored here, shown on the
-- Super Admin's Feedback page (downloadable as CSV) and announced to the Super
-- Admin in the app and by push (no e-mail). Writes come only from the app server
-- (after spam checks); only the Super Admin can read or update feedback.
-- =============================================================================

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid references public.profiles (id),
  name       text check (name is null or char_length(name) <= 120),
  email      text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  type       text not null check (type in ('suggestion', 'problem', 'compliment', 'other')),
  rating     int check (rating is null or rating between 1 and 5),
  message    text not null check (char_length(btrim(message)) between 3 and 4000),
  page       text check (page is null or char_length(page) <= 300),
  ip_hash    text check (ip_hash is null or char_length(ip_hash) <= 128),
  status     text not null default 'new' check (status in ('new', 'read', 'done')),
  updated_at timestamptz not null default now(),
  constraint feedback_contact check (user_id is not null or email is not null)
);
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_rate_idx on public.feedback (ip_hash, created_at);

alter table public.feedback enable row level security;
create policy feedback_super_read on public.feedback for select to authenticated using (private.is_super_admin());
create policy feedback_super_update on public.feedback for update to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant update (status, updated_at) on public.feedback to authenticated;
grant all on public.feedback to service_role;

-- Notifications get a "feedback" category (Super Admin only).
alter table public.notifications drop constraint notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'reminders', 'deadlines', 'performance', 'accountability', 'registration',
  'assignment', 'profile', 'service_updates', 'announcements', 'system', 'feedback'));

create or replace function private.notify(
  p_user uuid, p_category text, p_type text, p_title text, p_body text default null,
  p_link text default null, p_data jsonb default '{}', p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pref public.notification_preferences;
  v_ch jsonb;
  v_in_app boolean := true; v_email boolean := true; v_push boolean := true;
  v_id uuid;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from public.profiles where id = p_user and status in ('approved', 'pending', 'rejected')) then
    return null;
  end if;
  select * into v_pref from public.notification_preferences where user_id = p_user;
  if found then
    v_ch := v_pref.channels -> p_category;
    if v_ch is not null then
      v_in_app := coalesce((v_ch ->> 'in_app')::boolean, true);
      v_email  := coalesce((v_ch ->> 'email')::boolean, true);
      v_push   := coalesce((v_ch ->> 'push')::boolean, true);
    end if;
    v_email := v_email and v_pref.email_enabled;
    v_push  := v_push and v_pref.push_enabled;
  else
    v_push := false;
  end if;
  -- E-mail quota: routine reminders, deadlines and daily summaries are delivered in the
  -- app and by push only. Monthly-goal reminders and deadlines still go by e-mail.
  if (p_category in ('reminders', 'deadlines') or p_type = 'performance.daily_summary')
     and p_type not in ('reminder.monthly_goals', 'reminder.monthly_progress', 'reminder.monthly_goal_deadlines') then
    v_email := false;
  end if;
  -- Feedback alerts for the Super Admin: in the app and by push only.
  if p_category = 'feedback' then v_email := false; end if;
  -- Accountability e-mails only for monthly checklists; everything else is in the app and by push.
  if p_category = 'accountability' and coalesce(p_data ->> 'kind', '') <> 'monthly' then
    v_email := false;
  end if;
  -- Account lifecycle messages are always delivered in-app and by email.
  if p_category in ('registration', 'system') then v_in_app := true; v_email := true; end if;
  if not (v_in_app or v_email or v_push) then return null; end if;

  insert into public.notifications (user_id, category, type, title, body, link, data, dedupe_key, hidden, email_status, push_status)
  values (p_user, p_category, p_type, left(p_title, 200), left(p_body, 2000), p_link, coalesce(p_data, '{}'), p_dedupe,
          not v_in_app,
          case when v_email then 'pending' else 'skipped' end,
          case when v_push then 'pending' else 'skipped' end)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.notify(uuid, text, text, text, text, text, jsonb, text) from public, authenticated;

create or replace function private.feedback_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_who text;
begin
  v_who := coalesce((select full_name from public.profiles where id = new.user_id), nullif(btrim(new.name), ''), new.email, 'A visitor');
  perform private.notify_super_admins('feedback', 'feedback.new',
    'New feedback from ' || v_who || ': ' || case new.type when 'suggestion' then 'Suggestion' when 'problem' then 'Something isn''t working'
      when 'compliment' then 'Compliment' else 'Other' end || coalesce(' · ' || repeat('★', new.rating), ''),
    left(new.message, 200), '/super-admin/feedback', jsonb_build_object('feedback_id', new.id), 'feedback:' || new.id);
  return new;
end $$;
create trigger feedback_notify after insert on public.feedback for each row execute function private.feedback_notify();

create or replace function private.feedback_touch()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger feedback_touch before update on public.feedback for each row execute function private.feedback_touch();

-- Checklist labels: don't repeat words the title already ends with
-- ("Prospecting" → "Prospecting list", "Sales weekly" → "Sales weekly goals").
create or replace function private.checklist_label(p_title text, p_kind public.checklist_kind)
returns text language plpgsql immutable as $$
declare
  t text := btrim(p_title);
  w text[] := string_to_array(case p_kind when 'todo' then 'to-do list' when 'weekly' then 'weekly goals'
                                          when 'monthly' then 'monthly goals' else 'prospecting list' end, ' ');
  n int;
begin
  for n in reverse array_length(w, 1) .. 1 loop
    if lower(t) like '%' || array_to_string(w[1:n], ' ') then
      return btrim(t || ' ' || coalesce(array_to_string(w[n + 1:array_length(w, 1)], ' '), ''));
    end if;
  end loop;
  return t || ' ' || array_to_string(w, ' ');
end $$;
