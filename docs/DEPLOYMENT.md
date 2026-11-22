# Deployment (Supabase + Vercel)

> Nothing has been deployed. These are the steps to deploy when you are ready.

## 1. Supabase production project

1. Create a **new** Supabase project. Do not reuse a project that belongs to another application.
2. Link and push the migrations:
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   ```
   ```bash
   supabase db push
   ```
3. Configure **Authentication → URL Configuration**:
   - Site URL: `https://your-domain`
   - Redirect URLs: `https://your-domain/**`
4. Configure **Authentication → Sign In / Providers → Email**:
   - Enable "Confirm email". Email verification is tracked separately from Super Admin approval.
5. **Authentication → Email Templates:** paste the templates from `supabase/templates/`. They use `token_hash` links to `/auth/callback`, which works across devices.
6. **Authentication → SMTP:** configure a real SMTP provider. Supabase's default sender is rate-limited.
7. Bootstrap the first Super Admin. Register at `/register`, then run in the SQL editor:
   ```sql
   select public.bootstrap_super_admin('you@your-domain.com');
   ```
8. Optional: enable `pg_cron` and `pg_net`, then run `supabase/sql/schedule_pg_cron.sql` after replacing `<SITE_URL>` and `<CRON_SECRET>`.

## 2. Vercel

1. Import the GitHub repository in Vercel. The framework preset is Next.js and needs no build overrides.
2. Set the environment variables from `.env.example`.
   - Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.
   - Optional: AI, Resend and VAPID keys.
3. `vercel.json` defines two **daily** crons, which are compatible with every Vercel plan:
   - `/api/cron/evaluations` at 00:15 Lagos.
   - `/api/cron/daily` (reminders, delivery and service updates) at 07:05 Lagos.

### Recommended production schedule

Daily crons only deliver morning reminders and send e-mails once a day. For the full schedule, use **either** pg_cron (step 1.8) **or** Vercel Pro with these crons:

| Path | Schedule |
|---|---|
| `/api/cron/reminders` | `5 * * * *` |
| `/api/cron/dispatch` | `*/10 * * * *` |
| `/api/cron/service-updates` | `20 */6 * * *` |

## 3. Optional integrations

| Feature | Variables | Without it |
|---|---|---|
| LEX AI + update summaries | `AI_PROVIDER=anthropic`, `AI_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`) | LEX answers directly from the knowledge base and says so; updates show the source excerpt |
| Notification e-mails | `RESEND_API_KEY`, `EMAIL_FROM` (verified domain) | In-app only; e-mails are marked "skipped" in the delivery log |
| Browser push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`) | The push toggle explains it is not configured |
| Service updates | Add approved RSS/Atom feeds under **Settings → Service update sources** | Members see an empty state; nothing is invented |

The AI layer (`src/server/ai/provider.ts`) is a provider interface. Anthropic is implemented, and another provider can be added in `getAIProvider()` without touching LEX.

## 4. Release checklist

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- `npm run test:integration` passes against a fresh `supabase db reset`.
- `npm run test:e2e` passes.
- `npm run build` succeeds.
- `CRON_SECRET` is set. A request to `/api/cron/dispatch` without it returns 401.
- The Auth e-mail templates and SMTP are configured.
- The Super Admin has been bootstrapped. No demo data exists in production (the seeder refuses non-local URLs).

## 5. Current production setup (as configured)

| Item | Value |
|---|---|
| App URL | https://winnersteam.automifyco.com (`winners-team.vercel.app` redirects here with 308) |
| DNS (Namecheap, automifyco.com) | `CNAME winnersteam → <vercel-dns target shown in Vercel → Domains>` |
| Vercel project | `winners-team`, linked to GitHub `Aichatbotdeveloper/Winnersteam` (pushes to `main` deploy automatically) |
| Supabase Auth URLs | Site URL `https://winnersteam.automifyco.com`, redirect `https://winnersteam.automifyco.com/**` |
| E-mail sender | `Winners Team <no-reply@winnersteam.automifyco.com>` via Resend (domain verified, region eu-west-1) |
| Resend DNS (Namecheap) | `TXT resend._domainkey.winnersteam`, `CNAME rsend.winnersteam`, `CNAME send.winnersteam` |
| Auth e-mails | Supabase custom SMTP → `smtp.resend.com:465`, user `resend`, password = Resend API key |
| App notification e-mails | `RESEND_API_KEY` + `EMAIL_FROM` in Vercel; sent immediately after each action (Next.js `after()`), with the daily cron as a backstop |
| E-mail templates | `supabase/templates/*` pasted into Supabase → Authentication → Emails |

Super Admin tools: **Settings → General → Integrations** has "Send test e-mail to me" and "Deliver pending notifications now".
