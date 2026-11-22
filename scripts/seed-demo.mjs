#!/usr/bin/env node
/**
 * DEMONSTRATION DATA SEEDER — for local development and capacity testing ONLY.
 *
 * Creates clearly-labelled demo accounts on the "@demo.winners-team.local"
 * domain: 1 Super Admin, N administrators and M team members, plus 14 days of
 * synthetic history. Never run this against production.
 *
 *   node --env-file=.env.local scripts/seed-demo.mjs [--admins 8] [--members 250]
 *
 * Demo password for every account: Demo-Password-2026!
 */
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const ADMINS = Number(args.admins ?? 8);
const MEMBERS = Number(args.members ?? 250);
const PASSWORD = "Demo-Password-2026!";
const DOMAIN = "demo.winners-team.local";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
if (!/127\.0\.0\.1|localhost/.test(url) && !args.force) {
  throw new Error("Refusing to seed demo data into a non-local Supabase project. Pass --force true if you really mean it.");
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const pad = (n) => String(n).padStart(3, "0");
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[rnd(0, arr.length - 1)];

async function must(p, label) {
  const r = await p;
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data;
}

async function ensureUser(email, meta) {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: meta });
  if (!error) return data.user.id;
  if (!/already/i.test(error.message)) throw error;
  const p = await must(db.from("profiles").select("id").eq("email", email).single(), "lookup " + email);
  return p.id;
}

const today = await must(db.rpc("org_today"), "org_today");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (iso) => addDays(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

console.log(`Seeding demo data (today = ${today}) …`);

// Super Admin
const superEmail = `superadmin@${DOMAIN}`;
const superId = await ensureUser(superEmail, { full_name: "Demo Super Admin" });
await must(db.rpc("bootstrap_super_admin", { p_email: superEmail }), "bootstrap");

// Administrators (invitation row first, so the trigger grants the role)
const adminIds = [];
for (let i = 1; i <= ADMINS; i++) {
  const email = `admin${pad(i)}@${DOMAIN}`;
  const existing = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing.data) { adminIds.push(existing.data.id); continue; }
  await must(db.from("administrator_invitations").insert({ email, full_name: `Demo Administrator ${String.fromCharCode(64 + i)}`, job_title: "Team Administrator", invited_by: superId }), "invite");
  adminIds.push(await ensureUser(email, {}));
}
console.log(`  ${adminIds.length} administrators`);

const categories = await must(db.from("service_categories").select("id,slug"), "categories");
const taskCats = await must(db.from("task_categories").select("id,kind"), "task categories");
const dailyCats = taskCats.filter((c) => c.kind === "daily").map((c) => c.id);
const addCats = taskCats.filter((c) => c.kind === "additional").map((c) => c.id);
const TITLES = ["Client follow-up calls", "Prepare proposal draft", "Update CRM records", "Team stand-up notes", "Review portfolio links",
  "Send weekly report", "Research new prospects", "Reconcile expenses", "Draft social media posts", "Process client onboarding"];
const ACTIVITIES = ["find_prospects", "contact_prospects", "generate_leads", "send_proposals", "follow_ups", "appointments", "conversions"];

// Members
const memberIds = [];
const batch = 20;
for (let start = 1; start <= MEMBERS; start += batch) {
  const ids = await Promise.all(Array.from({ length: Math.min(batch, MEMBERS - start + 1) }, (_, k) => {
    const i = start + k;
    return ensureUser(`member${pad(i)}@${DOMAIN}`, {
      full_name: `Demo Member ${pad(i)}`, job_title: pick(["Sales Associate", "Marketing Executive", "Web Developer", "Business Analyst", "Account Officer"]),
      team_name: `Team ${String.fromCharCode(64 + ((i - 1) % ADMINS) + 1)}`,
    });
  }));
  memberIds.push(...ids);
}
// Leave the last 6 pending so the approval queue has content.
const pendingIds = memberIds.slice(-6);
const approveIds = memberIds.slice(0, -6);
const inChunks = async (ids, fn) => { const out = []; for (let i = 0; i < ids.length; i += 60) out.push(...(await fn(ids.slice(i, i + 60)))); return out; };
const profiles = await inChunks(approveIds, (ids) => must(db.from("profiles").select("id,status").in("id", ids), "member status"));
const toApprove = new Set(profiles.filter((p) => p.status === "pending").map((p) => p.id));
const assignRows = [];
approveIds.forEach((id, idx) => {
  if (toApprove.has(id)) assignRows.push({ member_id: id, administrator_id: adminIds[idx % adminIds.length], assigned_by: superId, reason: "Demo seed" });
});
if (assignRows.length) {
  await inChunks([...toApprove], async (ids) => {
    await must(db.from("profiles").update({ status: "approved", approved_at: new Date().toISOString(), approved_by: superId }).in("id", ids), "approve");
    await must(db.from("registration_requests").update({ decision: "approved", decided_by: superId, decided_at: new Date().toISOString() }).in("profile_id", ids), "requests");
    return [];
  });
  for (let i = 0; i < assignRows.length; i += 200) await must(db.from("admin_assignments").insert(assignRows.slice(i, i + 200)), "assign");
}
console.log(`  ${approveIds.length} approved members, ${pendingIds.length} pending registrations`);

// History: only for members without tasks yet (idempotent re-runs).
const haveTasks = new Set((await inChunks(approveIds, (ids) => must(db.from("tasks").select("owner_id").in("owner_id", ids).limit(100000), "existing"))).map((t) => t.owner_id));
const fresh = approveIds.filter((id) => !haveTasks.has(id));
const tasks = [], targets = [], acts = [], wgoals = [], mgoals = [], services = [];
for (const [n, id] of fresh.entries()) {
  const skill = 0.45 + Math.random() * 0.55; // each member has a consistent performance level
  for (let d = 14; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const count = rnd(4, 8);
    for (let t = 0; t < count; t++) {
      const done = d > 0 ? Math.random() < skill : Math.random() < skill * 0.5;
      tasks.push({ owner_id: id, kind: "daily", title: pick(TITLES), category_id: pick(dailyCats), priority: pick(["normal", "normal", "high", "urgent", "low"]),
        due_date: date, due_time: `${String(rnd(9, 17)).padStart(2, "0")}:${pick(["00", "30"])}`, status: done ? "completed" : "pending" });
    }
    if (Math.random() < 0.4) tasks.push({ owner_id: id, kind: "additional", title: pick(["Office support rota", "Training session", "Event preparation"]), category_id: pick(addCats), priority: "normal", due_date: date, due_time: null, status: Math.random() < skill ? "completed" : "pending" });
    for (const a of ["contact_prospects", "generate_leads", "send_proposals"]) {
      const target = a === "contact_prospects" ? 20 : a === "generate_leads" ? 5 : 2;
      targets.push({ owner_id: id, activity: a, period: "daily", period_start: date, target });
      const q = Math.round(target * (skill + (Math.random() - 0.4) * 0.4) * (d === 0 ? 0.5 : 1));
      if (q > 0) acts.push({ owner_id: id, activity: a, quantity: Math.min(q, 1000), occurred_on: date });
    }
  }
  for (const ws of [weekStart(addDays(today, -7)), weekStart(today)]) {
    wgoals.push({ owner_id: id, title: "Proposals submitted", unit: "proposals", target: 5, achieved: Math.round(5 * skill * (ws === weekStart(today) ? 0.6 : 1)), week_start: ws, deadline: addDays(ws, 4) });
    wgoals.push({ owner_id: id, title: "Client meetings", unit: "meetings", target: 3, achieved: Math.min(3, Math.round(3 * skill + Math.random())), week_start: ws, deadline: addDays(ws, 4) });
  }
  const ms = today.slice(0, 8) + "01";
  mgoals.push({ owner_id: id, title: "Portfolio value secured", unit: "NGN", target: 2000000, achieved: Math.round(2000000 * skill * 0.7), month_start: ms, deadline: addDays(addDays(ms, 32).slice(0, 8) + "01", -1) });
  services.push({ profile_id: id, name: pick(["Website Development", "Digital Marketing", "Academic Publishing", "Financial Consulting"]), category_id: pick(categories).id,
    description: "Demo service entry", key_benefits: ["Fast delivery", "Quality assurance"], position: 0 });
  if (n % 50 === 0) process.stdout.write(".");
}
const chunk = async (table, rows) => { for (let i = 0; i < rows.length; i += 1000) await must(db.from(table).insert(rows.slice(i, i + 1000)), table); };
await chunk("tasks", tasks);
await chunk("prospecting_targets", targets);
await chunk("prospecting_activities", acts);
await chunk("weekly_goals", wgoals);
await chunk("monthly_goals", mgoals);
await chunk("profile_services", services);
console.log(`\n  ${tasks.length} tasks, ${acts.length} prospecting logs, ${wgoals.length + mgoals.length} goals`);

const snaps = await must(db.rpc("cron_backfill_snapshots", { p_days: 14 }), "backfill");
const evals = await must(db.rpc("cron_run_evaluations"), "evaluations");
console.log(`  ${snaps} historical snapshots; evaluations:`, evals);
console.log(`\nDone. Sign in with superadmin@${DOMAIN}, admin001@${DOMAIN} or member001@${DOMAIN} — password ${PASSWORD}`);
