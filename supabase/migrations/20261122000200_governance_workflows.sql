-- =============================================================================
-- WINNERS TEAM — 0002 Governance workflows (approval, assignment, removal)
-- All functions validate the caller's role from the database, never from the
-- client, and write an audit record.
-- =============================================================================

create or replace function private.require(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_message using errcode = '42501';
  end if;
end $$;

-- Internal: (re)assign a member to an administrator, preserving history.
create or replace function private.assign_member(p_member uuid, p_admin uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid; v_id uuid;
  v_member public.profiles; v_admin public.profiles;
begin
  select * into v_member from public.profiles where id = p_member for update;
  select * into v_admin from public.profiles where id = p_admin;
  perform private.require(v_member.role = 'team_member', 'Only team members can be assigned to an administrator');
  perform private.require(v_member.status in ('approved', 'pending'), 'Member account is not active');
  perform private.require(v_admin.role = 'administrator' and v_admin.status = 'approved', 'Target administrator is not active');

  v_old := private.current_admin_of(p_member);
  if v_old = p_admin then return null; end if;

  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid())
   where member_id = p_member and ended_at is null;
  insert into public.admin_assignments (member_id, administrator_id, assigned_by, reason)
  values (p_member, p_admin, (select auth.uid()), p_reason) returning id into v_id;

  perform private.audit(case when v_old is null then 'assignment.created' else 'assignment.transferred' end,
    'admin_assignment', v_id::text, p_member,
    case when v_old is not null then jsonb_build_object('administrator_id', v_old) end,
    jsonb_build_object('administrator_id', p_admin), 'success', jsonb_build_object('reason', p_reason));

  perform private.notify(p_admin, 'assignment', 'assignment.added', v_member.full_name || ' joined your team',
    'You are now the assigned administrator for ' || v_member.full_name || '.', '/team/' || p_member,
    jsonb_build_object('member_id', p_member));
  if v_old is not null then
    perform private.notify(v_old, 'assignment', 'assignment.removed', v_member.full_name || ' was transferred',
      v_member.full_name || ' has been reassigned to another administrator.', '/admin',
      jsonb_build_object('member_id', p_member));
    perform private.notify(p_member, 'assignment', 'assignment.changed', 'Your administrator has changed',
      'You now report to ' || v_admin.full_name || '.', '/profile', jsonb_build_object('administrator_id', p_admin));
  end if;
  return v_id;
end $$;
revoke execute on function private.assign_member(uuid, uuid, text) from public, authenticated;

-- Super Admin: approve a pending registration and assign an administrator.
create or replace function public.approve_registration(p_member uuid, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles; v_admin_name text;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can approve registrations');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found and v_member.status = 'pending' and v_member.role = 'team_member', 'Registration is not pending');

  update public.profiles set status = 'approved', approved_at = now(), approved_by = (select auth.uid()), status_reason = null
   where id = p_member;
  perform private.assign_member(p_member, p_admin, 'Registration approval');
  update public.registration_requests set decision = 'approved', decided_by = (select auth.uid()), decided_at = now(),
         assigned_admin_id = p_admin where profile_id = p_member;
  select full_name into v_admin_name from public.profiles where id = p_admin;

  perform private.audit('registration.approved', 'profile', p_member::text, p_member,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'approved', 'administrator_id', p_admin));
  perform private.notify(p_member, 'registration', 'registration.approved', 'Your Winners Team account is approved',
    'Welcome aboard! You have been assigned to ' || v_admin_name || '. You can now sign in to your workspace.',
    '/dashboard', '{}', 'registration-approved:' || p_member);
end $$;

create or replace function public.reject_registration(p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can reject registrations');
  perform private.require(char_length(coalesce(p_reason, '')) between 3 and 1000, 'A rejection reason (3–1000 characters) is required');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found and v_member.status = 'pending', 'Registration is not pending');

  update public.profiles set status = 'rejected', status_reason = p_reason where id = p_member;
  update public.registration_requests set decision = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
         decision_reason = p_reason where profile_id = p_member;
  perform private.audit('registration.rejected', 'profile', p_member::text, p_member,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected'), 'success', jsonb_build_object('reason', p_reason));
  perform private.notify(p_member, 'registration', 'registration.rejected', 'Your registration was not approved',
    p_reason, '/pending-approval', '{}', 'registration-rejected:' || p_member);
end $$;

-- Super Admin only: transfer a member to another administrator.
create or replace function public.transfer_member(p_member uuid, p_admin uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can transfer team members');
  perform private.require((select status from public.profiles where id = p_member) = 'approved', 'Member account is not active');
  perform private.assign_member(p_member, p_admin, left(p_reason, 500));
end $$;

-- Administrators AND the Super Admin may remove ANY team-member account.
-- Narrow privileged operation: it returns nothing about the member and never
-- grants read access to the member's private records.
create or replace function public.remove_team_member(p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.profiles;
begin
  perform private.require(private.is_staff(), 'Only administrators and the Super Admin can remove team members');
  perform private.require(char_length(coalesce(p_reason, '')) between 3 and 1000, 'A removal reason (3–1000 characters) is required');
  select * into v_member from public.profiles where id = p_member for update;
  perform private.require(found, 'Account not found');
  perform private.require(v_member.role = 'team_member', 'Only team-member accounts can be removed with this action');
  perform private.require(v_member.status <> 'removed', 'Account has already been removed');

  update public.profiles set status = 'removed', removed_at = now(), removed_by = (select auth.uid()), status_reason = p_reason
   where id = p_member;
  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid())
   where member_id = p_member and ended_at is null;
  perform private.audit('account.removed', 'profile', p_member::text, p_member,
    jsonb_build_object('status', v_member.status), jsonb_build_object('status', 'removed'), 'success',
    jsonb_build_object('reason', p_reason));
  perform private.notify_super_admins('system', 'account.removed', v_member.full_name || ' was removed',
    'Team member account removed. Reason: ' || p_reason, '/super-admin/users', jsonb_build_object('profile_id', p_member));
end $$;

-- Super Admin: deactivate / reactivate any non-Super-Admin account.
create or replace function public.set_account_active(p_user uuid, p_active boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user public.profiles; v_new public.account_status;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can deactivate or reactivate accounts');
  select * into v_user from public.profiles where id = p_user for update;
  perform private.require(found and v_user.role <> 'super_admin', 'This account cannot be changed');
  perform private.require(v_user.status in ('approved', 'deactivated', 'removed'), 'Account is not in a state that can be changed');
  v_new := case when p_active then 'approved' else 'deactivated' end;
  if v_user.status = v_new then return; end if;

  update public.profiles set status = v_new,
         deactivated_at = case when p_active then null else now() end,
         removed_at = case when p_active then null else removed_at end,
         removed_by = case when p_active then null else removed_by end,
         status_reason = p_reason
   where id = p_user;
  if not p_active then
    -- Members of a deactivated administrator keep their assignment row so the
    -- Super Admin can reassign them; a deactivated admin no longer passes the
    -- is_assigned_admin_of() check, so access is revoked immediately.
    null;
  end if;
  perform private.audit(case when p_active then 'account.reactivated' else 'account.deactivated' end,
    'profile', p_user::text, p_user, jsonb_build_object('status', v_user.status), jsonb_build_object('status', v_new),
    'success', jsonb_build_object('reason', p_reason));
end $$;

-- Super Admin records an administrator invitation (the app then sends the
-- Supabase Auth invite e-mail using the service role on the server).
create or replace function public.create_admin_invitation(p_email text, p_full_name text, p_job_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can invite administrators');
  perform private.require(p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'A valid e-mail address is required');
  perform private.require(not exists (select 1 from public.profiles where lower(email) = lower(p_email)), 'An account with this e-mail already exists');
  update public.administrator_invitations set revoked_at = now()
   where lower(email) = lower(p_email) and accepted_at is null and revoked_at is null;
  insert into public.administrator_invitations (email, full_name, job_title, invited_by)
  values (lower(btrim(p_email)), btrim(p_full_name), nullif(btrim(p_job_title), ''), (select auth.uid()))
  returning id into v_id;
  perform private.audit('administrator.invited', 'administrator_invitation', v_id::text, null, null,
    jsonb_build_object('email', lower(p_email), 'full_name', p_full_name));
  return v_id;
end $$;

create or replace function public.revoke_admin_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can revoke invitations');
  update public.administrator_invitations set revoked_at = now() where id = p_invitation and accepted_at is null and revoked_at is null;
  perform private.audit('administrator.invitation_revoked', 'administrator_invitation', p_invitation::text);
end $$;

-- Administrators can find ANY team member for removal, but only see the
-- minimum needed to identify them (no private workspace data).
create or replace function public.search_removable_members(p_query text, p_limit int default 20)
returns table (id uuid, full_name text, job_title text, team_name text, status public.account_status)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_staff(), 'Not authorised');
  return query
    select p.id, p.full_name, p.job_title, p.team_name, p.status
      from public.profiles p
     where p.role = 'team_member' and p.status in ('approved', 'pending', 'deactivated')
       and (coalesce(p_query, '') = '' or p.full_name ilike '%' || p_query || '%' or p.team_name ilike '%' || p_query || '%')
     order by p.full_name
     limit least(greatest(p_limit, 1), 50);
end $$;

-- A member's own administrator (name only) for "Reporting to …" displays.
create or replace function public.my_administrator()
returns table (id uuid, full_name text, job_title text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.job_title from public.profiles p
   where p.id = private.current_admin_of((select auth.uid()));
$$;

-- Super-Admin-only directory of administrators (used across management UIs).
create or replace function public.list_administrators()
returns table (id uuid, full_name text, email text, job_title text, status public.account_status, member_count bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_super_admin(), 'Not authorised');
  return query
    select p.id, p.full_name, p.email, p.job_title, p.status,
           (select count(*) from public.admin_assignments a join public.profiles m on m.id = a.member_id
             where a.administrator_id = p.id and a.ended_at is null and m.status = 'approved'),
           p.created_at
      from public.profiles p where p.role = 'administrator' order by p.full_name;
end $$;

-- Announcements: administrators → their assigned team; Super Admin → anyone.
create or replace function public.send_announcement(p_title text, p_body text, p_scope text default 'team')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count int := 0; r record; v_author text;
begin
  perform private.require(private.is_staff(), 'Only administrators and the Super Admin can send announcements');
  perform private.require(p_scope in ('team', 'organisation'), 'Invalid scope');
  perform private.require(p_scope = 'team' or private.is_super_admin(), 'Only the Super Admin can address the whole organisation');
  perform private.require(char_length(btrim(coalesce(p_title, ''))) between 1 and 160 and char_length(btrim(coalesce(p_body, ''))) between 1 and 4000,
    'Title (1–160) and message (1–4000 characters) are required');

  insert into public.announcements (author_id, scope, title, body)
  values ((select auth.uid()), p_scope, btrim(p_title), btrim(p_body)) returning id into v_id;
  select full_name into v_author from public.profiles where id = (select auth.uid());

  for r in
    select p.id from public.profiles p
     where p.status = 'approved' and p.id <> (select auth.uid())
       and (case when p_scope = 'organisation' then true
                 else p.role = 'team_member' and private.current_admin_of(p.id) = (select auth.uid()) end)
  loop
    perform private.notify(r.id, 'announcements', 'announcement', btrim(p_title), left(btrim(p_body), 500),
      '/notifications', jsonb_build_object('announcement_id', v_id, 'author', v_author), 'announcement:' || v_id);
    v_count := v_count + 1;
  end loop;
  update public.announcements set recipients = v_count where id = v_id;
  perform private.audit('announcement.sent', 'announcement', v_id::text, null, null,
    jsonb_build_object('title', p_title, 'scope', p_scope, 'recipients', v_count));
  return v_id;
end $$;

-- Mark all of the caller's notifications read.
create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = (select auth.uid()) and read_at is null;
$$;

-- Update last_seen_at (used for "active" indicators).
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
   where id = (select auth.uid()) and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;

-- Bootstrap: promote an existing auth account to Super Admin. Callable only by
-- the database owner / service role (SQL editor or deployment script).
create or replace function public.bootstrap_super_admin(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.profiles where lower(email) = lower(p_email);
  if v_id is null then raise exception 'No account with e-mail %', p_email; end if;
  update public.profiles set role = 'super_admin', status = 'approved', approved_at = coalesce(approved_at, now()), status_reason = null
   where id = v_id;
  update public.admin_assignments set ended_at = now() where member_id = v_id and ended_at is null;
  update public.registration_requests set decision = 'approved', decided_at = now() where profile_id = v_id and decision = 'pending';
  perform private.audit('account.super_admin_bootstrapped', 'profile', v_id::text, v_id);
end $$;
revoke execute on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;
