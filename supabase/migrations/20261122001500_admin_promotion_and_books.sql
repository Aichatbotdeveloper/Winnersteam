-- =============================================================================
-- WINNERS TEAM — 0015 "Make administrator" + verified book links + new titles
-- Safe to run more than once.
-- =============================================================================

-- Super Admin: turn an existing (pending or approved) team-member account into
-- an administrator — e.g. a manager who registered through the public form.
create or replace function public.make_administrator(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  perform private.require(private.is_super_admin(), 'Only the Super Admin can create administrators');
  select * into v from public.profiles where id = p_user for update;
  perform private.require(found and v.role = 'team_member', 'Only a team-member account can be made an administrator');
  perform private.require(v.status in ('pending', 'approved'), 'The account is not active');
  update public.profiles
     set role = 'administrator', status = 'approved', team_leader_name = null,
         approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, (select auth.uid())), status_reason = null
   where id = p_user;
  -- An administrator does not report to another administrator.
  update public.admin_assignments set ended_at = now(), ended_by = (select auth.uid()) where member_id = p_user and ended_at is null;
  update public.registration_requests set decision = 'approved', decided_by = (select auth.uid()), decided_at = now()
   where profile_id = p_user and decision = 'pending';
  perform private.audit('account.made_administrator', 'profile', p_user::text, p_user,
    jsonb_build_object('role', v.role, 'status', v.status), jsonb_build_object('role', 'administrator', 'status', 'approved'));
  perform private.notify(p_user, 'registration', 'account.made_administrator', 'You are now a Winners Team administrator',
    'The Super Admin has given you administrator access. Sign in to manage your team.', '/admin', '{}', 'made-admin:' || p_user);
end $$;
revoke execute on function public.make_administrator(uuid) from public, anon;
grant execute on function public.make_administrator(uuid) to authenticated;

-- Public-domain classics: verified free scans on the Internet Archive
-- (Project Gutenberg search links replaced; read online + direct PDF).
update public.books set reading_url = 'https://archive.org/details/howtoliveon24hou00bennuoft', free_download_url = 'https://archive.org/download/howtoliveon24hou00bennuoft/howtoliveon24hou00bennuoft.pdf', license = 'public_domain' where title = $t$How to Live on 24 Hours a Day$t$;
update public.books set reading_url = 'https://archive.org/details/SelfHelp', free_download_url = 'https://archive.org/download/SelfHelp/SelfHelp.pdf', license = 'public_domain' where title = $t$Self-Help$t$;
update public.books set reading_url = 'https://archive.org/details/autobiobenfran00miffrich', free_download_url = 'https://archive.org/download/autobiobenfran00miffrich/autobiobenfran00miffrich.pdf', license = 'public_domain' where title = $t$The Autobiography of Benjamin Franklin$t$;
update public.books set reading_url = 'https://archive.org/details/asmanthinketh00alleiala', free_download_url = 'https://archive.org/download/asmanthinketh00alleiala/asmanthinketh00alleiala.pdf', license = 'public_domain' where title = $t$As a Man Thinketh$t$;
update public.books set reading_url = 'https://archive.org/details/meditationsofmar00marc', free_download_url = 'https://archive.org/download/meditationsofmar00marc/meditationsofmar00marc.pdf', license = 'public_domain' where title = $t$Meditations$t$;
update public.books set reading_url = 'https://archive.org/details/artofwaroldestmi00suntuoft', free_download_url = 'https://archive.org/download/artofwaroldestmi00suntuoft/artofwaroldestmi00suntuoft.pdf', license = 'public_domain' where title = $t$The Art of War$t$;
update public.books set reading_url = 'https://archive.org/details/artofpublicspeak00esen', free_download_url = 'https://archive.org/download/artofpublicspeak00esen/artofpublicspeak00esen.pdf', license = 'public_domain' where title = $t$The Art of Public Speaking$t$;
update public.books set reading_url = 'https://archive.org/details/p-t-barnum_the-art-of-money-getting_202302', free_download_url = 'https://archive.org/download/p-t-barnum_the-art-of-money-getting_202302/p-t-barnum_the-art-of-money-getting.pdf', license = 'public_domain' where title = $t$The Art of Money Getting$t$;
update public.books set reading_url = 'https://archive.org/details/cu31924029452467', free_download_url = 'https://archive.org/download/cu31924029452467/cu31924029452467.pdf', license = 'public_domain' where title = $t$Acres of Diamonds$t$;
update public.books set reading_url = 'https://archive.org/details/princemac00machuoft', free_download_url = 'https://archive.org/download/princemac00machuoft/princemac00machuoft.pdf', license = 'public_domain' where title = $t$The Prince$t$;

-- Commercial titles: official Open Library page (editions, borrowing, purchase). No download links.
update public.books set reading_url = 'https://openlibrary.org/works/OL17713267W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Deep Work$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL17930368W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Atomic Habits$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2392324W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Eat That Frog!$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2392356W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$The Psychology of Selling$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL20015117W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Fanatical Prospecting$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL16465202W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$The 4 Disciplines of Execution$t$;
update public.books set reading_url = 'https://openlibrary.org/works/OL2010879W', free_download_url = null, description = replace(description, 'Commercial title — borrow or buy.', 'Commercial title — see editions, borrow or buy.') where title = $t$Rich Dad Poor Dad$t$;

-- New commercial titles requested by the Super Admin (no free legal PDF exists).
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$There Is a Place Called Tomorrow$t$, $t$Habu Dawaki$t$, 'personal-development', $t$Vision & personal growth$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$There Is a Place Called Tomorrow$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Power of Decision Making$t$, $t$Manoj Tripath$t$, 'strategic-planning', $t$Decision making$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Power of Decision Making$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Ice Breakers!$t$, $t$Tom "Big Al" Schreiter$t$, 'sales', $t$Prospecting & starting conversations$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL27710826W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Ice Breakers!$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$$100M Offers$t$, $t$Alex Hormozi$t$, 'business-development', $t$Building irresistible offers$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL25037516W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$$100M Offers$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$You Can Win$t$, $t$Shiv Khera$t$, 'personal-development', $t$Attitude & success habits$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL8938318W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$You Can Win$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Go Pro$t$, $t$Eric Worre$t$, 'sales', $t$Network marketing & prospecting$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL17082196W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Go Pro$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Art of Saying No$t$, $t$Damon Zahariades$t$, 'time-management', $t$Boundaries & time management$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL20504357W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Art of Saying No$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Power of Self-Discipline$t$, $t$Peter Hollins$t$, 'discipline', $t$Self-discipline$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL26138830W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Power of Self-Discipline$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$The Art of Laziness$t$, $t$Library Mindset$t$, 'productivity', $t$Productivity & procrastination$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$The Art of Laziness$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Master Your Focus$t$, $t$Thibaut Meurisse$t$, 'productivity', $t$Focus & concentration$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL22433530W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Master Your Focus$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Leadership$t$, $t$Brian Tracy$t$, 'leadership', $t$Leadership$t$, 'Commercial title — buy or borrow.', 'https://openlibrary.org/works/OL34323215W', null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Leadership$t$));
insert into public.books (title, author, category, improvement_area, description, reading_url, free_download_url, license)
select $t$Master Your Mindset$t$, $t$Mindset Reading$t$, 'personal-development', $t$Mindset$t$, 'Commercial title — buy or borrow.', null, null, 'commercial'
where not exists (select 1 from public.books where lower(title) = lower($t$Master Your Mindset$t$));
