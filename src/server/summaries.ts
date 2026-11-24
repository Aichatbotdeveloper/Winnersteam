import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAIProvider } from "@/server/ai/provider";
import { addDays, monthStart, nowTimeInOrg, todayInOrg, weekStart } from "@/lib/format";

/**
 * Weekly (Monday 07:00, previous Mon–Sun) and monthly (1st 07:00, previous month)
 * summaries. Runs in small batches (from the every-2-minute delivery job) until
 * everyone has theirs; each summary is written once (unique per person and period).
 * The AI only ever sees numbers and "Member A/B…" labels — never names.
 */

export type PeriodType = "weekly" | "monthly";
export type Period = { type: PeriodType; start: string; end: string; prevStart: string; prevEnd: string };
type Kind = "todo" | "weekly" | "monthly" | "prospecting";
const KINDS: Kind[] = ["todo", "weekly", "monthly", "prospecting"];
export const KIND_NAME: Record<Kind, string> = { todo: "to-do checklists", weekly: "weekly goals", monthly: "monthly goals", prospecting: "prospecting" };
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type MemberStats = {
  checklists: number; graded: number; average: number | null; previousAverage: number | null; change: number | null;
  byKind: Partial<Record<Kind, { count: number; average: number | null }>>; best: Kind | null; weakest: Kind | null;
  submittedEarly: number; passed: number; belowPass: number; weakestDay: string | null;
  spins: number; outcomes: { category: string; quantity: number }[]; unspun: number; finesUnpaid: number;
};
export type TeamStats = {
  members: number; activeMembers: number; average: number | null; previousAverage: number | null; change: number | null;
  ranking: { userId: string; name: string; average: number | null; checklists: number }[];
  top: { name: string; average: number }[]; attention: { name: string; reasons: string[] }[];
};
export type OrgStats = {
  members: number; activeMembers: number; average: number | null; previousAverage: number | null; change: number | null;
  teams: { name: string; members: number; average: number | null }[]; inactive: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** The periods whose summaries are due now (the latest closed week / month). */
export function duePeriods(now = new Date()): Period[] {
  const today = todayInOrg(now);
  const early = nowTimeInOrg(now) < "07:00";
  let monday = weekStart(today);
  if (today === monday && early) monday = addDays(monday, -7);
  const wStart = addDays(monday, -7), wEnd = addDays(monday, -1);
  let first = monthStart(today);
  if (today === first && early) first = monthStart(addDays(first, -1));
  const mEnd = addDays(first, -1), mStart = monthStart(mEnd);
  const pmEnd = addDays(mStart, -1);
  return [
    { type: "weekly", start: wStart, end: wEnd, prevStart: addDays(wStart, -7), prevEnd: addDays(wEnd, -7) },
    { type: "monthly", start: mStart, end: mEnd, prevStart: monthStart(pmEnd), prevEnd: pmEnd },
  ];
}

type Row = { owner_id: string; kind: Kind; status: string; score: number | null; closed_reason: string | null; deadline: string };
type Led = { id: string; user_id: string; category: string; quantity: number; status: string; event_id: string };

const localDate = (ts: string) => todayInOrg(new Date(ts));
const range = (from: string, to: string) => [`${from}T00:00:00+01:00`, `${to}T23:59:59.999+01:00`] as const;

async function fetchAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let a = 0; a < 100_000; a += 1000) {
    const { data, error } = await q(a, a + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function memberStats(rows: Row[], prevRows: Row[], ledger: Led[], unspunEvents: number, finesUnpaid: number, pass: number): MemberStats {
  const graded = rows.filter((r) => r.status === "closed" && r.score !== null);
  const scores = graded.map((r) => Number(r.score));
  const prevScores = prevRows.filter((r) => r.status === "closed" && r.score !== null).map((r) => Number(r.score));
  const average = avg(scores), previousAverage = avg(prevScores);
  const byKind: MemberStats["byKind"] = {};
  for (const k of KINDS) {
    const ks = graded.filter((r) => r.kind === k).map((r) => Number(r.score));
    const count = rows.filter((r) => r.kind === k).length;
    if (count) byKind[k] = { count, average: avg(ks) };
  }
  const ranked = (Object.entries(byKind) as [Kind, { average: number | null }][]).filter(([, v]) => v.average !== null).sort((a, b) => b[1].average! - a[1].average!);
  const days = new Map<number, number[]>();
  for (const r of graded) { const d = new Date(localDate(r.deadline) + "T12:00:00Z").getUTCDay(); days.set(d, [...(days.get(d) ?? []), Number(r.score)]); }
  const dayAvg = [...days.entries()].filter(([, v]) => v.length >= 1).map(([d, v]) => [d, avg(v)!] as const).sort((a, b) => a[1] - b[1]);
  return {
    checklists: rows.length, graded: graded.length, average, previousAverage,
    change: average !== null && previousAverage !== null ? r1(average - previousAverage) : null,
    byKind, best: ranked.length > 1 ? ranked[0]![0] : null, weakest: ranked.length > 1 ? ranked[ranked.length - 1]![0] : null,
    submittedEarly: graded.filter((r) => r.closed_reason === "submitted").length,
    passed: scores.filter((s) => s >= pass).length, belowPass: scores.filter((s) => s < pass).length,
    weakestDay: dayAvg.length > 1 && dayAvg[0]![1] < (average ?? 100) - 5 ? WEEKDAY[dayAvg[0]![0]]! : null,
    spins: ledger.length, outcomes: ledger.map((l) => ({ category: l.category, quantity: Number(l.quantity) })),
    unspun: unspunEvents, finesUnpaid,
  };
}

async function aiNote(system: string, facts: unknown): Promise<string | null> {
  const ai = getAIProvider();
  if (!ai) return null;
  try {
    const text = await Promise.race([
      ai.complete({ system, messages: [{ role: "user", content: JSON.stringify(facts) }], maxTokens: 260, effort: "low" }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15_000)),
    ]);
    const clean = text.replace(/\*\*?/g, "").replace(/^#+\s*/gm, "").trim();
    return clean.length > 20 ? clean.slice(0, 900) : null;
  } catch {
    return null;
  }
}

const label = (k: Kind | null) => (k ? KIND_NAME[k] : null);

function memberFallback(s: MemberStats, t: PeriodType): string {
  const p = t === "weekly" ? "week" : "month";
  const parts = [`You completed ${s.graded} checklist${s.graded === 1 ? "" : "s"} last ${p} with an average of ${s.average}%${s.change !== null ? ` (${s.change >= 0 ? "up" : "down"} ${Math.abs(s.change)} points)` : ""}.`];
  if (s.best) parts.push(`Your strongest area was ${label(s.best)}.`);
  if (s.weakest) parts.push(`Give ${label(s.weakest)} extra attention this ${p}: break it into small steps and finish them early in the day.`);
  if (s.unspun) parts.push(`You have ${s.unspun} spin${s.unspun === 1 ? "" : "s"} waiting.`);
  return parts.join(" ");
}

const MEMBER_PROMPT = `You are a warm, practical performance coach for Winners Team, a community of students, entrepreneurs and self-employed people.
You receive JSON with one person's checklist results for the period (scores are percentages; each checklist is scored on its own).
Write 3–4 short sentences (max 90 words), plain text, no greeting, no names, no lists, no headings.
Mention: overall result and the change from the previous period if given; one strength; one focus area with ONE concrete tip for the next period.
If weakestDay is given you may mention it. If unspun > 0 remind them to spin. Use only the numbers provided; never invent figures.`;

const TEAM_PROMPT = `You are an experienced team-leadership coach for Winners Team. You receive JSON describing an administrator's team for the period:
members are labelled "Member A", "Member B", etc. Write 3–4 short sentences (max 100 words), plain text, no greeting, no lists:
the team's overall result and trend, who to recognise (by label), who needs support (by label) and one concrete leadership action for the next period.
Use only the numbers provided; never invent figures; refer to people only by their labels.`;

const ORG_PROMPT = `You are an advisor to the founder of Winners Team. You receive JSON describing the whole organisation for the period
(teams are labelled "Team A", "Team B", etc.). Write 3–4 short sentences (max 100 words), plain text, no greeting, no lists:
overall result and trend, the strongest and weakest team (by label), and one concrete recommendation. Use only the numbers provided.`;

/** Generate summaries that are due, within a time budget. Safe to call repeatedly. */
export async function generateDueSummaries(budgetMs = 45_000, now = new Date()) {
  const started = Date.now();
  const db = createAdminClient();
  const out: Record<string, number> = {};
  const { data: set } = await db.from("accountability_settings").select("threshold_none").single();
  const pass = Number(set?.threshold_none ?? 90);

  for (const period of duePeriods(now)) {
    const [{ data: done }, people, assigns] = await Promise.all([
      db.from("performance_summaries").select("user_id,scope").eq("period_type", period.type).eq("period_start", period.start),
      fetchAll<{ id: string; full_name: string; role: string; status: string; created_at: string }>((a, b) => db.from("profiles").select("id,full_name,role,status,created_at").eq("status", "approved").order("id").range(a, b)),
      fetchAll<{ member_id: string; administrator_id: string }>((a, b) => db.from("admin_assignments").select("member_id,administrator_id").is("ended_at", null).order("member_id").range(a, b)),
    ]);
    const have = new Set((done ?? []).map((d) => `${d.user_id}:${d.scope}`));
    const members = people.filter((p) => p.role === "team_member");
    const admins = people.filter((p) => p.role === "administrator");
    const supers = people.filter((p) => p.role === "super_admin");
    const todo = [
      ...members.filter((p) => !have.has(`${p.id}:member`)).map((p) => ({ p, scope: "member" as const })),
      ...admins.filter((p) => !have.has(`${p.id}:team`)).map((p) => ({ p, scope: "team" as const })),
      ...supers.filter((p) => !have.has(`${p.id}:organisation`)).map((p) => ({ p, scope: "organisation" as const })),
    ];
    if (!todo.length) continue;

    // Load the period's data once.
    const [from, to] = range(period.prevStart, period.end);
    const rows = await fetchAll<Row>((a, b) => db.from("checklists").select("owner_id,kind,status,score,closed_reason,deadline")
      .is("deleted_at", null).gte("deadline", from).lte("deadline", to).order("id").range(a, b));
    const [lf, lt] = range(period.start, period.end);
    const ledger = await fetchAll<Led>((a, b) => db.from("accountability_ledger").select("id,user_id,category,quantity,status,event_id")
      .gte("assigned_at", lf).lte("assigned_at", lt).order("id").range(a, b));
    const unspunQ = await fetchAll<{ id: string; user_id: string; accountability_ledger: unknown }>((a, b) => db.from("accountability_events")
      .select("id,user_id,accountability_ledger(id)").order("id").range(a, b));
    const unspun = new Map<string, number>();
    for (const e of unspunQ) { const l = e.accountability_ledger; if (!l || (Array.isArray(l) && !l.length)) unspun.set(e.user_id, (unspun.get(e.user_id) ?? 0) + 1); }
    const finesOpen = await fetchAll<{ user_id: string }>((a, b) => db.from("accountability_ledger").select("user_id")
      .eq("category", "financial_fine").neq("status", "completed").order("id").range(a, b));
    const unpaid = new Map<string, number>();
    for (const f of finesOpen) unpaid.set(f.user_id, (unpaid.get(f.user_id) ?? 0) + 1);

    const inPeriod = (r: Row) => { const d = localDate(r.deadline); return d >= period.start && d <= period.end; };
    const inPrev = (r: Row) => { const d = localDate(r.deadline); return d >= period.prevStart && d <= period.prevEnd; };
    const byOwner = new Map<string, Row[]>();
    for (const r of rows) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);
    const statsFor = (id: string) => {
      const mine = byOwner.get(id) ?? [];
      return memberStats(mine.filter(inPeriod), mine.filter(inPrev), ledger.filter((l) => l.user_id === id), unspun.get(id) ?? 0, unpaid.get(id) ?? 0, pass);
    };
    const teamOf = (adminId: string) => {
      const ids = assigns.filter((a) => a.administrator_id === adminId).map((a) => a.member_id);
      return members.filter((m) => ids.includes(m.id));
    };
    const teamStats = (team: typeof members): TeamStats => {
      const ranking = team.map((m) => { const s = statsFor(m.id); return { userId: m.id, name: m.full_name, average: s.average, checklists: s.checklists, s }; })
        .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
      const teamRows = team.flatMap((m) => byOwner.get(m.id) ?? []);
      const sc = (rs: Row[]) => avg(rs.filter((r) => r.status === "closed" && r.score !== null).map((r) => Number(r.score)));
      const average = sc(teamRows.filter(inPeriod)), previousAverage = sc(teamRows.filter(inPrev));
      return {
        members: team.length, activeMembers: ranking.filter((x) => x.checklists > 0).length, average, previousAverage,
        change: average !== null && previousAverage !== null ? r1(average - previousAverage) : null,
        ranking: ranking.map(({ s: _s, ...x }) => x),
        top: ranking.filter((x) => x.average !== null).slice(0, 3).map((x) => ({ name: x.name, average: x.average! })),
        attention: ranking.map((x) => ({ name: x.name, reasons: [
          ...(x.checklists === 0 ? ["no checklists"] : []),
          ...(x.average !== null && x.average < 75 ? [`average ${x.average}%`] : []),
          ...(x.s.unspun ? [`${x.s.unspun} spin(s) not taken`] : []),
          ...(x.s.finesUnpaid ? [`${x.s.finesUnpaid} unpaid fine(s)`] : []),
        ] })).filter((x) => x.reasons.length).slice(0, 8),
      };
    };

    let made = 0;
    for (const { p, scope } of todo) {
      if (Date.now() - started > budgetMs) { out[`${period.type}_pending`] = (out[`${period.type}_pending`] ?? 0) + 1; continue; }
      let stats: MemberStats | TeamStats | OrgStats, ai: string | null = null, fallback = "", delivered = true;
      if (scope === "member") {
        const s = statsFor(p.id);
        stats = s;
        if (s.checklists === 0 && s.spins === 0) delivered = false;
        else {
          ai = s.graded ? await aiNote(MEMBER_PROMPT, { period: period.type, passMark: pass, ...s, best: label(s.best), weakest: label(s.weakest),
            byKind: Object.fromEntries(Object.entries(s.byKind).map(([k, v]) => [KIND_NAME[k as Kind], v])) }) : null;
          fallback = s.graded ? memberFallback(s, period.type) : `You had ${s.checklists} checklist${s.checklists === 1 ? "" : "s"} last ${period.type === "weekly" ? "week" : "month"} but none were graded yet.`;
        }
      } else if (scope === "team") {
        const t = teamStats(teamOf(p.id));
        stats = t;
        if (!t.members || !t.activeMembers) delivered = false;
        else {
          const labels = new Map(t.ranking.map((x, i) => [x.name, `Member ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`]));
          const facts = { period: period.type, passMark: pass, members: t.members, activeMembers: t.activeMembers, average: t.average, previousAverage: t.previousAverage, change: t.change,
            ranking: t.ranking.map((x) => ({ member: labels.get(x.name), average: x.average, checklists: x.checklists })),
            needsAttention: t.attention.map((x) => ({ member: labels.get(x.name), reasons: x.reasons })) };
          const raw = await aiNote(TEAM_PROMPT, facts);
          // Put the real names back in place of the labels.
          ai = raw ? [...labels.entries()].sort((a, b) => b[1].length - a[1].length).reduce((txt, [name, l]) => txt.replace(new RegExp(`\\b${l}\\b`, "g"), name), raw) : null;
          fallback = `Your team of ${t.members} averaged ${t.average ?? "—"}%${t.change !== null ? ` (${t.change >= 0 ? "up" : "down"} ${Math.abs(t.change)} points)` : ""}. ${t.top[0] ? `${t.top[0].name} led with ${t.top[0].average}%. ` : ""}${t.attention.length ? `${t.attention.length} member(s) need attention — see the list below.` : "Nobody needs special attention."}`;
        }
      } else {
        const teams = admins.map((a) => ({ name: a.full_name, t: teamStats(teamOf(a.id)) })).filter((x) => x.t.members);
        const allRows = members.flatMap((m) => byOwner.get(m.id) ?? []);
        const sc = (rs: Row[]) => avg(rs.filter((r) => r.status === "closed" && r.score !== null).map((r) => Number(r.score)));
        const average = sc(allRows.filter(inPeriod)), previousAverage = sc(allRows.filter(inPrev));
        const active = new Set(allRows.filter(inPeriod).map((r) => r.owner_id)).size;
        const o: OrgStats = { members: members.length, activeMembers: active, average, previousAverage,
          change: average !== null && previousAverage !== null ? r1(average - previousAverage) : null,
          teams: teams.map((x) => ({ name: x.name, members: x.t.members, average: x.t.average })).sort((a, b) => (b.average ?? -1) - (a.average ?? -1)),
          inactive: members.length - active };
        stats = o;
        if (!o.activeMembers) delivered = false;
        const tl = new Map(o.teams.map((x, i) => [x.name, `Team ${String.fromCharCode(65 + (i % 26))}`]));
        const raw = !delivered ? null : await aiNote(ORG_PROMPT, { period: period.type, members: o.members, activeMembers: o.activeMembers, average: o.average, previousAverage: o.previousAverage, change: o.change,
          teams: o.teams.map((x) => ({ team: tl.get(x.name), members: x.members, average: x.average })) });
        ai = raw ? [...tl.entries()].reduce((txt, [name, l]) => txt.replace(new RegExp(`\\b${l}\\b`, "g"), `${name}'s team`), raw) : null;
        fallback = `${o.activeMembers} of ${o.members} members used checklists, with an organisation average of ${o.average ?? "—"}%${o.change !== null ? ` (${o.change >= 0 ? "up" : "down"} ${Math.abs(o.change)} points)` : ""}.`;
      }

      const { data: ins } = await db.from("performance_summaries").upsert({
        user_id: p.id, scope, period_type: period.type, period_start: period.start, period_end: period.end,
        stats, ai_text: delivered ? ai ?? fallback : null, ai_used: Boolean(ai), delivered,
      }, { onConflict: "user_id,scope,period_type,period_start", ignoreDuplicates: true }).select("id");
      const id = ins?.[0]?.id;
      if (id && delivered) {
        const what = period.type === "weekly" ? "weekly" : "monthly";
        await db.rpc("notify_summary_ready", { p_user: p.id, p_period_type: period.type, p_period_start: period.start, p_summary: id,
          p_title: scope === "member" ? `Your ${what} summary is ready` : scope === "team" ? `Your team's ${what} summary is ready` : `Organisation ${what} summary is ready`,
          p_body: (ai ?? fallback).split(/(?<=\.)\s/)[0]!.slice(0, 200) });
      }
      made++;
    }
    out[period.type] = made;
  }
  return out;
}
