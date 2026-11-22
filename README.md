# Winners Team

**Office Productivity, Accountability & Personal Development Management System**

A multi-user, role-based workspace for a team of 200–300 people. It covers daily to-dos, weekly/monthly goals, prospecting, a weighted performance engine, an accountability spin wheel, personalised book recommendations, professional service updates, reminders, motivational quotes, the **LEX** AI platform assistant, reports and audit logs.

| | |
|---|---|
| Frontend | Next.js 16 (App Router, React 19, TypeScript strict), Tailwind CSS v4 with the Google Stitch design tokens |
| Backend / DB / Auth / Storage | Supabase (PostgreSQL 17, Row Level Security, Supabase Auth, Supabase Storage, Realtime) |
| Hosting | Vercel (with Vercel Cron) |

Roles: **Super Admin** (whole organisation), **Administrator** (assigned team), and **Team Member** (own workspace). Permissions are enforced in Postgres (RLS + audited `SECURITY DEFINER` functions) and checked again server-side. They are never left to the frontend.

---

## Quick start (local)

Prerequisites: Node 20+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
```

```bash
supabase start
```

Applies all migrations in `supabase/migrations`. Local e-mails go to Mailpit at http://127.0.0.1:54324.

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`, and set `CRON_SECRET` to any random string of 16 or more characters.

```bash
npm run seed:demo
```

Optional: creates clearly labelled demo accounts and 14 days of synthetic history (local only).

```bash
npm run dev
```

Demo accounts (local only, password `Demo-Password-2026!`): `superadmin@demo.winners-team.local`, `admin001@demo.winners-team.local`, `member001@demo.winners-team.local`.

### Create the first Super Admin (any environment)

1. Register normally at `/register` (or create the user in Supabase → Authentication).
2. In the Supabase SQL editor run:
   ```sql
   select public.bootstrap_super_admin('you@your-domain.com');
   ```
   This function can only be executed by the database owner or service role.
3. Sign in. Invite administrators from **Administrator Directory**.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit tests (feed parser, CSV injection guard, period maths, business-rule constants) |
| `npm run test:integration` | Integration tests against the **local** Supabase stack: RLS, role isolation, workflows, performance and accountability engines |
| `npm run test:e2e` | Playwright browser tests (needs the dev server and demo seed) |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` from the local schema |
| `npm run seed:demo` | Demo data (refuses to run against a non-local project) |

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): structure, Stitch screen → route map, data model, security model, business rules
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Supabase production project, Vercel, environment variables, scheduled jobs, e-mail templates
- [PROGRESS.md](PROGRESS.md): completed features, test results, known limitations and items that need credentials

## Branding

The official name is **Winners Team**. The supplied trophy artwork is used as the logo, favicon and app icon (`public/brand`, `src/app/icon.png`). LEX has an original trophy-in-speech-bubble icon (`public/brand/lex-icon.svg`). The UI palette, typography and spacing come from the Google Stitch design system (`src/app/globals.css`). The logo does not change the palette.
