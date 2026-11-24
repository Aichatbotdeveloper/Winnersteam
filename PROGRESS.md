# Winners Team — Progress Record

Last updated: 22 Nov 2026

## Status by phase

| Phase | Status |
|---|---|
| 1. Inspection & foundation | ✅ All 36 Stitch screens and DESIGN.md inspected. Tokens ported. Logo, favicon and LEX icon done. Shell built. |
| 2. Supabase & auth | ✅ 11 migrations, RLS on every table. Registration, e-mail verification, approval, invitations and password recovery. Branded e-mail templates. |
| 3. Hierarchy | ✅ Three dashboards. Approvals, administrator invitations, assignment/transfer, deactivation and soft removal (admins may remove any team member). |
| 4. Productivity | ✅ Checklists (to-do, weekly goals, monthly goals, prospecting), each with its own title and deadline; items 0/25/50/75/100% (prospecting by count ÷ target); Submit now; deadlines move earlier only; locked once graded. |
| 5. Performance | ✅ Each checklist scored on its own (average of its items), no weights; day/week/month averages for information; recorded snapshots, versioned corrections, member/team/organisation views. |
| 6. Accountability | ✅ Four categories only, DB-enforced limits, NGN only. Secure server-side draw, no rerolls, no approval gate. Auto-draw, accommodation override, ledger, sector editor. Animated wheel with sound and confetti. |
| 7. Notifications | ✅ In-app (Realtime bell), preferences, scheduled reminders with dedupe. E-mail (Resend) and Web Push delivery code. |
| 8. Service updates | ✅ Approved-source RSS/Atom ingestion (SSRF guard), category matching, AI summaries, feed, save/read. |
| 9. Personal development | ✅ Historical weakness detection, recommendations, library, reading list, progress, notes. Copyright guard. |
| 10. LEX | ✅ Role-aware chat grounded in a role-filtered knowledge base, conversation history, rate limit, provider interface. |
| 11. Quotes, settings, audit, reports | ✅ Login quotes with no-repeat window. All settings sections. Append-only audit viewer. Reports (performance, tasks, prospecting achievement, goal history, personal development, accountability, user directory) in CSV, Excel and PDF; large reports are read in pages so nothing is cut off. |
| 12. QA & deployment prep | ✅ Tests below. Production build. Docs. `vercel.json` and `.env.example`. **Not deployed**: awaiting authorisation. |

## Verified test results (fresh `supabase db reset`, production build)

- `tsc --noEmit`: pass. `eslint src`: 0 errors.
- Unit tests: **7/7** pass.
- Integration tests against real local Supabase Auth, PostgREST and RLS: **31/31** pass. Coverage:
  - Role spoofing at sign-up; pending users cannot write.
  - Administrators see only assigned members; members see only themselves.
  - Transfer moves access immediately and keeps history; administrators cannot transfer.
  - Any administrator can remove any team member but cannot read that member's data, and cannot remove administrators.
  - Append-only audit log (even for the service role); service-role-only cron functions.
  - Checklist maths: 100/75/50/25/0 = 50%; prospecting 12 of 20 = 60% (capped at 100%); averages count every checklist equally.
  - Checklist rules: grading at the deadline or on Submit now; a spin per failed checklist with a 15-minute window, then the system spins; deadlines earlier-only; locked after grading; deletion only within 15 minutes or while empty.
  - All four limits plus a rejected fifth category; NGN only.
  - Event → spin → assigned with no approval; no reroll; no duplicate events; auto-draw; accommodation excludes physical options.
  - Reminder dedupe; profile-change notifications; quote rotation; role-filtered LEX knowledge base.
  - Storage isolation; no forged notifications or audit entries.
- Playwright E2E on the production build: **8/8** pass. Coverage:
  - Register → Mailpit e-mail link → pending → Super Admin approves → member login with quote → create and complete a task.
  - Direct-URL role boundaries; cron requires a secret.
  - LEX; CSV, Excel and PDF exports; staff pages; mobile layout with no horizontal overflow.
- Route smoke test, 3 roles × 52 routes on the production build: 0 failures. Members are redirected away from staff pages.
- Capacity: 287 accounts (263 active members, about 15,600 tasks, about 4,200 snapshots).
  - Organisation-wide live scoring: about 170 ms.
  - The client bundle contains no secrets.

## Production status (live)

- Live at **https://winnersteam.automifyco.com** (Vercel + Supabase), Super Admin bootstrapped.
- E-mail: Supabase Auth e-mails and app notifications both delivered through Resend from `no-reply@winnersteam.automifyco.com`, confirmed received by the owner; branded templates installed.
- Production fix applied: explicit Data API grants (newer Supabase projects do not expose tables automatically).
- AI: Google Gemini API (`AI_PROVIDER=gemini`, `AI_MODEL=gemini-3.8-flash`), confirmed working live. If a model is busy or retired the app retries, then falls back to other available Flash/Flash-Lite models; LEX receives the full role-filtered help centre and cites its sources. Only the user's role is sent to the AI — no names or personal records.
- Browser push: VAPID keys in Vercel (private key sensitive), confirmed working live (test notification received). Users enable it per device under Notifications → Preferences.
- Scheduling: Supabase pg_cron runs reminders hourly and delivery every 10 minutes (single-use database tokens authorise calls to the app; verified locally end-to-end).
- Service updates: 18 approved sources active across 9 categories (confirmed fetching in production); articles delivered by each member's service categories, with an instant 30-day catch-up when a member adds a service and AI summaries added gradually in the background.
- All planned integrations are live.
- E-mail quota (Resend free plan ≈100/day): routine reminders, deadline alerts and daily performance summaries go in the app and by push only; monthly-goal reminders and monthly-goal deadlines are still e-mailed (migration 0017). If Resend replies "limit reached" (HTTP 429), e-mails wait and are sent on a later run; anything still waiting after 3 days is dropped as out of date.
- Weekly & monthly AI summaries (migration 0022): Monday 07:00 (last week) and the 1st 07:00 (last month) for members (personal), administrators (team) and the Super Admin (organisation). Numbers plus a short Gemini note (names never sent to the AI; standard note if AI is unavailable), in-app and push only, PDF download, history on the Summaries page. Generated in batches by the 2-minute delivery job.
- Fine payments (trial, migration 0020): administrators add bank details; a member with a financial fine pays by transfer, taps "I've paid" with a receipt, and their administrator confirms (or marks not received). Nothing is deducted automatically. Super Admin can switch it off in Settings → Accountability. Receipt photos are shrunk in the browser (≈100–250 KB) and receipt files are deleted 60 days after the administrator's decision (migration 0021; never while awaiting confirmation; the payment record is kept). Profile photos are shrunk to 512 px (≈50 KB).
- Feedback ("Talk to the developer"): round floating button on the website and in the app opens a form (visitors must give an email; members are recognised). Stored in Supabase, shown on the Super Admin's Feedback page with a CSV download, announced in the app and by push (migration 0019). Spam protection: hidden bot trap and 5 messages per hour per person.
- Books: real covers (archive.org / Open Library) with a generated fallback (migration 0016).

## Needs credentials or authorisation (implemented, not live-tested)

- **Supabase production project:** none was created. The only project on the connected account ("TalentVault") belongs to another application and was not touched.
- **Vercel deployment and GitHub push:** not performed (requires your authorisation). There is no git remote; the history is committed locally.
- **AI provider (`AI_API_KEY`):** without it LEX runs in knowledge-base mode (tested) and summaries are skipped.
- **Resend:** e-mail notifications are marked "skipped" until configured. Supabase Auth e-mails were tested locally through Mailpit.
- **VAPID keys:** browser push code and the service worker are in place but not tested end-to-end without keys.
- **RSS sources:** none are pre-seeded because the feeds could not be verified from this environment. The Super Admin adds them in Settings.

## Known limitations and decisions

- **Book links:** public-domain titles link to Project Gutenberg *search* pages and open-access titles to the OpenStax subject page. Exact URLs could not be verified from the sandbox, so none were guessed. The Super Admin can replace them.
- **Graded checklists are locked** so results cannot be changed afterwards. Old tasks, goals and prospecting records from before checklists are kept as read-only history.
- **Monthly prospecting:** weekly targets count toward the month in which the week starts.
- **Vercel crons:** the default `vercel.json` uses two daily crons (works on every plan). Hourly reminders and frequent e-mail delivery need pg_cron (`supabase/sql/schedule_pg_cron.sql`) or Vercel Pro (see docs/DEPLOYMENT.md).
- **Not implemented:** the Stitch "manager sign-off" modal, because it conflicts with the mandatory no-approval rule.
