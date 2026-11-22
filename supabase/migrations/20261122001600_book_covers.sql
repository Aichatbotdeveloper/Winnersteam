-- =============================================================================
-- WINNERS TEAM — 0016 Real book covers
-- Classics: scanned covers of the exact free editions (Internet Archive).
-- Commercial titles: official Open Library covers (?default=false → 404 if
-- missing, and the app then falls back to its generated cover).
-- Only fills books that have no cover yet. Safe to run more than once.
-- =============================================================================
update public.books set cover_url = 'https://archive.org/services/img/howtoliveon24hou00bennuoft' where cover_url is null and title = $t$How to Live on 24 Hours a Day$t$;
update public.books set cover_url = 'https://archive.org/services/img/SelfHelp' where cover_url is null and title = $t$Self-Help$t$;
update public.books set cover_url = 'https://archive.org/services/img/autobiobenfran00miffrich' where cover_url is null and title = $t$The Autobiography of Benjamin Franklin$t$;
update public.books set cover_url = 'https://archive.org/services/img/asmanthinketh00alleiala' where cover_url is null and title = $t$As a Man Thinketh$t$;
update public.books set cover_url = 'https://archive.org/services/img/meditationsofmar00marc' where cover_url is null and title = $t$Meditations$t$;
update public.books set cover_url = 'https://archive.org/services/img/artofwaroldestmi00suntuoft' where cover_url is null and title = $t$The Art of War$t$;
update public.books set cover_url = 'https://archive.org/services/img/artofpublicspeak00esen' where cover_url is null and title = $t$The Art of Public Speaking$t$;
update public.books set cover_url = 'https://archive.org/services/img/p-t-barnum_the-art-of-money-getting_202302' where cover_url is null and title = $t$The Art of Money Getting$t$;
update public.books set cover_url = 'https://archive.org/services/img/cu31924029452467' where cover_url is null and title = $t$Acres of Diamonds$t$;
update public.books set cover_url = 'https://archive.org/services/img/princemac00machuoft' where cover_url is null and title = $t$The Prince$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/7988607-M.jpg?default=false' where cover_url is null and title = $t$Deep Work$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12539702-M.jpg?default=false' where cover_url is null and title = $t$Atomic Habits$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/847534-M.jpg?default=false' where cover_url is null and title = $t$Eat That Frog!$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/13270498-M.jpg?default=false' where cover_url is null and title = $t$The Psychology of Selling$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12685538-M.jpg?default=false' where cover_url is null and title = $t$Fanatical Prospecting$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/9136687-M.jpg?default=false' where cover_url is null and title = $t$The 4 Disciplines of Execution$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/8315603-M.jpg?default=false' where cover_url is null and title = $t$Rich Dad Poor Dad$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12830137-M.jpg?default=false' where cover_url is null and title = $t$Ice Breakers!$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/11948182-M.jpg?default=false' where cover_url is null and title = $t$$100M Offers$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/6974809-M.jpg?default=false' where cover_url is null and title = $t$You Can Win$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12449352-M.jpg?default=false' where cover_url is null and title = $t$Go Pro$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/9159200-M.jpg?default=false' where cover_url is null and title = $t$The Art of Saying No$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/12093579-M.jpg?default=false' where cover_url is null and title = $t$The Power of Self-Discipline$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/10459447-M.jpg?default=false' where cover_url is null and title = $t$Master Your Focus$t$;
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/13776386-M.jpg?default=false' where cover_url is null and title = $t$Leadership$t$;
