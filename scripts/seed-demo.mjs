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
const TITLES = ["Client follow-up calls", "Prepare proposal draft", "Update CRM records", "Team stand-up notes", "Review portfolio links",
  "Send weekly report", "Research new prospects", "Reconcile expenses", "Draft social media posts", "Process client onboarding"];

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

// Profile services: only for members without any yet (idempotent re-runs).
const haveServices = new Set((await inChunks(approveIds, (ids) => must(db.from("profile_services").select("profile_id").in("profile_id", ids).limit(100000), "existing services"))).map((t) => t.profile_id));
const services = [];
for (const id of approveIds.filter((x) => !haveServices.has(x))) {
  services.push({ profile_id: id, name: pick(["Website Development", "Digital Marketing", "Academic Publishing", "Financial Consulting"]), category_id: pick(categories).id,
    description: "Demo service entry", key_benefits: ["Fast delivery", "Quality assurance"], position: 0 });
}
const chunk = async (table, rows) => { for (let i = 0; i < rows.length; i += 1000) await must(db.from(table).insert(rows.slice(i, i + 1000)), table); };
await chunk("profile_services", services);

// Checklists (current model): only for members without checklists yet.
const haveLists = new Set((await inChunks(approveIds, (ids) => must(db.from("checklists").select("owner_id").in("owner_id", ids).limit(100000), "existing lists"))).map((c) => c.owner_id));
const lists = [], items = [];
const STEP = [0, 25, 50, 75, 100];
const stepFor = (skill) => STEP[Math.max(0, Math.min(4, Math.round(skill * 4 + (Math.random() - 0.5) * 2)))];
const at = (date, hh) => `${date}T${String(hh - 1).padStart(2, "0")}:00:00Z`; // local (UTC+1) hour → UTC
function addList(owner, kind, title, deadline, rows, closed) {
  const id = crypto.randomUUID();
  const progress = rows.map((r) => r.progress);
  const score = progress.length ? Math.round((progress.reduce((a, b) => a + b, 0) / progress.length) * 100) / 100 : null;
  lists.push({ id, owner_id: owner, kind, title, deadline, created_at: new Date(new Date(deadline).getTime() - 9 * 3600e3).toISOString(),
    ...(closed ? { status: "closed", closed_at: deadline, closed_reason: "deadline", score } : { status: "open", closed_at: null, closed_reason: null, score: null }) });
  rows.forEach((r, i) => items.push({ checklist_id: id, owner_id: owner, title: r.title, progress: r.progress, target: r.target ?? null, achieved: r.achieved ?? 0, position: i + 1 }));
}
for (const id of approveIds.filter((x) => !haveLists.has(x))) {
  const skill = 0.45 + Math.random() * 0.55;
  for (let d = 14; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const closed = d > 0;
    const todo = Array.from({ length: rnd(3, 6) }, () => ({ title: pick(TITLES), progress: closed ? stepFor(skill) : pick([0, 0, 25, 50, 100]) }));
    addList(id, "todo", pick(["Office", "Daily", "Morning", "Client work"]), at(date, closed ? 17 : 23), todo, closed);
    if (Math.random() < 0.35) addList(id, "todo", pick(["Home", "Evening", "Admin"]), at(date, 21), [{ title: "Plan tomorrow", progress: closed ? stepFor(skill + 0.2) : 0 }, { title: "Reading", progress: closed ? stepFor(skill) : 0 }], closed);
    const prospect = [["Contact prospects", 20], ["Generate leads", 5], ["Send proposals", 2]].map(([t, target]) => {
      const achieved = Math.max(0, Math.round(target * (skill + (Math.random() - 0.4) * 0.4) * (closed ? 1 : 0.4)));
      return { title: t, target, achieved, progress: Math.round(Math.min(achieved / target, 1) * 10000) / 100 };
    });
    addList(id, "prospecting", "Prospecting", at(date, closed ? 17 : 23), prospect, closed);
  }
  const fri = addDays(weekStart(today), 4);
  addList(id, "weekly", "This week", at(fri < today ? addDays(fri, 7) : fri, 18), [{ title: "Send 5 proposals", progress: pick([25, 50, 75]) }, { title: "Hold 3 client meetings", progress: pick([0, 25, 50]) }], false);
  const monthEnd = addDays(addDays(today.slice(0, 8) + "01", 32).slice(0, 8) + "01", -1);
  addList(id, "monthly", pick(["November targets", "Monthly goals"]), at(monthEnd, 18), [{ title: "Secure ₦2m portfolio value", progress: pick([25, 50]) }, { title: "Close 3 new contracts", progress: pick([0, 25, 50]) }], false);
}
await chunk("checklists", lists);
await chunk("checklist_items", items);
console.log(`  ${lists.length} checklists, ${items.length} checklist items`);

const snaps = await must(db.rpc("cron_backfill_snapshots", { p_days: 14 }), "backfill");
const evals = await must(db.rpc("cron_run_evaluations"), "evaluations");
console.log(`  ${snaps} historical snapshots; evaluations:`, evals);
console.log(`\nDone. Sign in with superadmin@${DOMAIN}, admin001@${DOMAIN} or member001@${DOMAIN} — password ${PASSWORD}`);
