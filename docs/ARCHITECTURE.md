# Architecture

## Repository layout

```
supabase/
  migrations/        SQL migrations (schema, RLS, functions, reference data)
  templates/         Branded Supabase Auth e-mail templates (token_hash links)
  sql/               Optional pg_cron schedule
  config.toml        Local stack configuration
src/
  proxy.ts           Session refresh + signed-out redirect (Next 16 "proxy")
  app/(auth)/        Login, register, verify-email, pending-approval, password flows
  app/(app)/         Authenticated workspace (role-aware shell)
  app/api/           LEX chat, report export, cron endpoints
  components/        UI primitives (Stitch tokens) and feature components
  server/actions/    Server actions (zod-validated, run as the signed-in user)
  server/            AI provider, delivery (e-mail/push), service-update ingestion, reports
  lib/               Supabase clients, auth guards, formatting, labels, generated DB types
tests/               unit, integration (real Supabase), e2e (Playwright)
scripts/seed-demo.mjs  Demo/capacity data (local only)
```

## Google Stitch → application mapping

The Stitch export contained 36 static HTML screens (Tailwind CDN) and `DESIGN.md`. There were no React, TypeScript, logo or font files. The tokens in every screen's `tailwind.config` were ported verbatim into `src/app/globals.css` (`@theme`), and each screen was rebuilt as connected React:

| Stitch screen | Route |
|---|---|
| universal_login_multi_role_enterprise_gateway | `/login` |
| team_member_registration_enterprise_onboarding | `/register` |
| email_verification_identity_attestation | `/verify-email`, `/auth/callback` |
| registration_pending_approval_governance_intake | `/pending-approval` |
| super_admin_executive_dashboard | `/super-admin` |
| administrator_team_management_dashboard | `/admin` |
| team_member_personal_dashboard, mobile_team_member_dashboard | `/dashboard` (responsive) |
| organisation_wide_user_directory_account_governance | `/super-admin/users` |
| administrator_directory_provisioning_management | `/super-admin/administrators` |
| team_assignments_reassignment_engine | `/super-admin/assignments` |
| individual_user_details_account_governance_management | `/team/[id]` |
| interactive_accountability_*_spin_wheel_*, mobile_spin_wheel_accountability, spin_wheel_calibrated_outcome_accommodation_active | `/accountability` |
| super_admin_spin_wheel_custom_sector_editor_matrix_calibration | `/settings/accountability` |
| financial_accountability_ngn_penalty_ledger, super_admin_dashboard_accommodation_record_exported | `/accountability` (ledger, NGN totals, CSV export) |
| spin_wheel_with_physical_exemption_manager_sign_off_modal | **Intentionally not implemented**: manager sign-off contradicts the "no approval" rule; the accommodation is user-controlled |
| unified_user_profile_multi_service_governance_hub | `/profile` |
| notifications_and_reminders_center | `/notifications` |
| lex_platform_assistant_conversational_modal | LEX launcher (all pages) and `/lex` |
| professional_service_updates_centre | `/service-updates` |
| personal_development_book_recommendations | `/books` |
| motivational_quote_management | `/settings/quotes` |
| administrator_team_performance_cohort_analytics_report, individual_team_member_performance_prospecting_accountability_report | `/reports`, `/team/[id]`, `/performance` |
| super_admin_organisation_wide_analytics_intelligence | `/super-admin/analytics` |
| system_settings_* (3 screens) | `/settings/*` |
| audit_logs_* (3 screens) | `/audit-logs` (scope set by role) |

Stitch demo content that conflicted with the brief was removed: "Enterprise HQ"/"Apex" branding, wall-sits, snack-fund and book-review consequences, dollar fines, peer/manager verification chains, and fabricated SOC-2/SSO badges.

## Security model

- **RLS on every table** (verified: zero `public` tables without RLS). Helper predicates live in a non-exposed `private` schema:
  - `can_view_user(uid)`: self (active), the Super Admin, or the **currently** assigned active administrator.
  - Ending an assignment revokes the previous administrator's access immediately.
- **Writes needing elevated rights** go through `SECURITY DEFINER` RPCs that check the caller's role from the database and write an audit record: `approve_registration`, `reject_registration`, `transfer_member` (Super Admin only), `remove_team_member` (any administrator or the Super Admin, team members only, returns no data), `set_account_active`, `create_admin_invitation`, `spin_accountability`, `update_ledger_status`, `set_physical_accommodation`, `correct_performance`, and others.
- **No anonymous RPC access.** `EXECUTE` is revoked from `anon` on every public function. Cron entry points are service-role only.
- **Role spoofing is impossible.** New auth users always become pending team members unless a Super-Admin-created invitation exists for that e-mail. Client-supplied metadata never grants a role.
- **Protected columns.** Role, status, e-mail, approval and accommodation fields cannot be changed through direct table updates (trigger guard).
- **Append-only audit log.** UPDATE, DELETE and TRUNCATE are blocked by trigger, even for the service role. No secrets or passwords are written to it.
- **Service-role key** is used only in trusted server code, and only *after* the RPC has authorised the caller: Auth invitations, blocking a removed or deactivated account's sign-in, cron. It is verified absent from client bundles.
- **Removal is soft.** The status becomes `removed`, the assignment ends, and sign-in is banned. History is never deleted.
- **Other safeguards.** Storage avatars live in per-user folders with the same visibility as the profile, with type/size limits and magic-byte checks. CSV export guards against formula injection. RSS ingestion is https-only with a private-IP (SSRF) guard. Security headers are set in `next.config.ts`.

## Business rules (enforced in Postgres)

**Performance** (`private.compute_performance`): weights 30/20/20/20/10 by default, configurable, with a CHECK that they total 100. Each category is capped at 100% for scoring, and the raw value is kept for display. Categories with nothing due are excluded and the remaining weights are normalised, so there is never a division by zero. Prospecting uses Σmin(actual, target)/Σtarget per activity. A weekly target replaces daily targets for that week, so activity is never double counted. Closed periods are locked for users. Snapshots are versioned, and corrections create a new audited version.

**Accountability**
- **Categories:** the `consequence_category` enum has exactly four values. CHECK constraints enforce frog jumps 10–400, leg raising 10–60 minutes, office signatures 1–10, and fines ₦200–₦5,000 with currency always `NGN`.
- **Levels:** thresholds are ordered with no gaps or overlaps (90/75/50 by default).
- **Triggering category:** the weakest applicable category. Frog-jump sectors apply to daily to-do (and additional-task) triggers by default.
- **Draw:** selection uses `gen_random_bytes` inside a transaction. There is one result per event (unique), and calling spin again returns the same result.
- **No approval gate.** The outcome is `assigned` on insert. An unspun event is drawn automatically after a configurable window.
- **Physical accommodation:** user-controlled, takes effect immediately, and is recorded. It excludes physical categories (a ledger CHECK enforces this).
- **Fines** are recorded only and never deducted.

## Scheduled processing

All scheduling logic is idempotent SQL: `cron_run_evaluations`, `cron_run_reminders` and `cron_match_service_updates`, with dedupe keys on notifications. The same functions can be driven by Vercel Cron (`/api/cron/*`, Bearer `CRON_SECRET`) or by Supabase pg_cron (`supabase/sql/schedule_pg_cron.sql`).

## Capacity

Measured locally with 287 accounts (11 administrators, 263 active members, about 15,600 tasks and 4,200 snapshots):

- Live organisation-wide weekly scoring for all members (`team_performance`): about 170 ms.
- Snapshot comparison by administrator: under 20 ms.
- Full evaluation run: a few seconds.

Lists use pagination, and dashboards use aggregate RPCs instead of loading raw organisation data into the browser.
