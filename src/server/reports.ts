import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { CATEGORY_LABEL, CONSEQUENCE_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { normalisePerformance, type PeriodType } from "@/server/queries";
import { addDays, fmtDate, monthEnd, monthStart, weekStart } from "@/lib/format";
import { PROSPECTING_LABEL } from "@/lib/labels";

export type Report = { title: string; subtitle: string; columns: string[]; rows: (string | number | null)[][] };
const CATS = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];
/**
 * Supabase returns at most 1,000 rows per request, so read in pages until done
 * (capped) — otherwise large organisation reports would be silently truncated.
 */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, cap = 20_000): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

function periodRange(period: PeriodType, date: string) {
  if (period === "daily") return { from: date, to: date, label: fmtDate(date) };
  if (period === "weekly") { const s = weekStart(date); return { from: s, to: addDays(s, 6), label: `week of ${fmtDate(s)}` }; }
  const s = monthStart(date); return { from: s, to: monthEnd(date), label: fmtDate(s, { month: "long", year: "numeric" }) };
}

const n2 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

/** All report data is read with the caller's session, so RLS decides what is included. */
export async function buildReport(me: Profile, type: string, period: PeriodType, date: string, adminFilter?: string | null): Promise<Report> {
  const supabase = await createClient();
  const scope = me.role === "super_admin" ? "Organisation-wide" : me.role === "administrator" ? "Assigned team" : "Personal";

  if (type === "performance") {
    if (me.role === "team_member") {
      const { data } = await supabase.rpc("performance_history", { p_user: me.id, p_type: period, p_limit: 52 });
      return {
        title: `${period[0]!.toUpperCase() + period.slice(1)} performance history`, subtitle: `${scope} · ${me.full_name}`,
        columns: ["Period start", "Period end", "Overall %", ...CATS.map((c) => `${CATEGORY_LABEL[c]} %`), "Version"],
        rows: (data ?? []).map((r) => [r.period_start, r.period_end, n2(r.overall_score), ...CATS.map((c) => n2((r.categories as Record<string, unknown> | null)?.[c])), r.version]),
      };
    }
    const { data, error } = await supabase.rpc("team_performance", { p_type: period, p_date: date, p_admin: adminFilter ?? undefined });
    if (error) throw new Error(error.message);
    return {
      title: `Team performance — ${period}`, subtitle: `${scope} · period containing ${fmtDate(date)}`,
      columns: ["Team member", "Job title", "Administrator", "Overall %", ...CATS.map((c) => `${CATEGORY_LABEL[c]} %`)],
      rows: (data ?? []).map((r) => {
        const p = normalisePerformance({ overall: r.overall, categories: r.categories });
        return [r.full_name, r.job_title, r.administrator_name, n2(r.overall), ...CATS.map((c) => { const x = p.categories.find((y) => y.category === c); return x?.applicable ? n2(x.capped_pct) : null; })];
      }),
    };
  }

  if (type === "accountability") {
    const data = await fetchAll((a, b) => supabase.from("accountability_ledger")
      .select("assigned_at,category,quantity,unit,currency,status,completed_at,accommodation_active,selected_by,member:profiles!accountability_ledger_user_id_fkey(full_name),event:accountability_events(period_type,period_start,performance_pct,level,triggering_category)")
      .order("assigned_at", { ascending: false }).order("id").range(a, b));
    return {
      title: "Accountability ledger", subtitle: scope,
      columns: ["Team member", "Period", "Period start", "Performance %", "Level", "Trigger", "Consequence", "Quantity", "Unit", "Accommodation", "Selected by", "Assigned at", "Status", "Completed at"],
      rows: (data ?? []).map((l) => {
        const e = l.event as unknown as { period_type: string; period_start: string; performance_pct: number; level: string; triggering_category: keyof typeof CATEGORY_LABEL };
        return [(l.member as unknown as { full_name: string } | null)?.full_name ?? "", e.period_type, e.period_start, n2(e.performance_pct), e.level, CATEGORY_LABEL[e.triggering_category],
          CONSEQUENCE_LABEL[l.category], n2(l.quantity), l.unit, l.accommodation_active ? "Yes" : "No", l.selected_by, l.assigned_at, l.status, l.completed_at];
      }),
    };
  }

  if (type === "tasks") {
    const from = new Date(date + "T00:00:00Z"); from.setUTCDate(from.getUTCDate() - 30);
    const data = await fetchAll((a, b) => supabase.from("tasks").select("title,kind,priority,status,due_date,completed_at,owner:profiles!tasks_owner_id_fkey(full_name)")
      .is("deleted_at", null).gte("due_date", from.toISOString().slice(0, 10)).lte("due_date", date).order("due_date", { ascending: false }).order("id").range(a, b), 50_000);
    return {
      title: "Tasks (last 30 days)", subtitle: scope,
      columns: ["Owner", "Task", "List", "Priority", "Status", "Due date", "Completed at"],
      rows: (data ?? []).map((t) => [(t.owner as unknown as { full_name: string } | null)?.full_name ?? "", t.title, t.kind, t.priority, t.status, t.due_date, t.completed_at]),
    };
  }

  if (type === "users" && me.role !== "team_member") {
    const data = await fetchAll((a, b) => supabase.from("profiles").select("full_name,email,role,status,job_title,team_name,created_at").order("full_name").order("id").range(a, b));
    return {
      title: "User directory", subtitle: scope,
      columns: ["Name", "E-mail", "Role", "Status", "Job title", "Team", "Registered"],
      rows: (data ?? []).map((p) => [p.full_name, p.email, ROLE_LABEL[p.role], STATUS_LABEL[p.status], p.job_title, p.team_name, p.created_at.slice(0, 10)]),
    };
  }
  if (type === "prospecting") {
    const r = periodRange(period, date);
    const ws = weekStart(r.from);
    const [targets, acts] = await Promise.all([
      fetchAll((a, b) => supabase.from("prospecting_targets").select("owner_id,activity,period,period_start,target,owner:profiles!prospecting_targets_owner_id_fkey(full_name)")
        .gte("period_start", period === "daily" ? r.from : ws).lte("period_start", r.to).order("id").range(a, b), 50_000),
      fetchAll((a, b) => supabase.from("prospecting_activities").select("owner_id,activity,quantity,owner:profiles!prospecting_activities_owner_id_fkey(full_name)")
        .gte("occurred_on", r.from).lte("occurred_on", r.to).order("id").range(a, b), 50_000),
    ]);
    // Same rule as the performance engine: a weekly target replaces that week's daily targets.
    type Row = { name: string; target: number; actual: number };
    const rows = new Map<string, Row>();
    const key = (o: string, act: string) => `${o}|${act}`;
    const weekly = new Set(targets.filter((t) => t.period === "weekly").map((t) => `${t.owner_id}|${t.activity}|${t.period_start}`));
    for (const t of targets) {
      // daily: that day's daily targets. weekly/monthly: weekly targets starting in range,
      // plus daily targets in range whose week has no weekly target.
      const inRange = t.period === "weekly"
        ? period !== "daily" && t.period_start >= r.from && t.period_start <= r.to
        : t.period_start >= r.from && t.period_start <= r.to && (period === "daily" || !weekly.has(`${t.owner_id}|${t.activity}|${weekStart(t.period_start)}`));
      if (!inRange) continue;
      const k = key(t.owner_id, t.activity);
      const row = rows.get(k) ?? { name: (t.owner as unknown as { full_name: string } | null)?.full_name ?? "", target: 0, actual: 0 };
      row.target += t.target; rows.set(k, row);
    }
    for (const x of acts) {
      const k = key(x.owner_id, x.activity);
      const row = rows.get(k) ?? { name: (x.owner as unknown as { full_name: string } | null)?.full_name ?? "", target: 0, actual: 0 };
      row.actual += x.quantity; rows.set(k, row);
    }
    const list = [...rows.entries()].map(([k, v]) => ({ activity: k.split("|")[1] as keyof typeof PROSPECTING_LABEL, ...v }))
      .sort((x, y) => x.name.localeCompare(y.name) || x.activity.localeCompare(y.activity));
    return {
      title: "Prospecting achievement", subtitle: `${scope} · ${r.label}`,
      columns: ["Team member", "Activity", "Target", "Actual", "Achievement %", "Scored % (capped)"],
      rows: list.map((v) => [v.name, PROSPECTING_LABEL[v.activity] ?? v.activity, v.target || null, v.actual,
        v.target ? n2((v.actual / v.target) * 100) : null, v.target ? n2(Math.min(v.actual / v.target, 1) * 100) : null]),
    };
  }

  if (type === "goals") {
    const r = periodRange(period === "daily" ? "weekly" : period, date);
    const [weekly, monthly] = await Promise.all([
      fetchAll((a, b) => supabase.from("weekly_goals").select("title,unit,target,achieved,week_start,deadline,owner:profiles!weekly_goals_owner_id_fkey(full_name)")
        .is("deleted_at", null).gte("week_start", r.from).lte("week_start", r.to).order("week_start").order("id").range(a, b), 50_000),
      period === "monthly"
        ? fetchAll((a, b) => supabase.from("monthly_goals").select("title,unit,target,achieved,month_start,deadline,owner:profiles!monthly_goals_owner_id_fkey(full_name)")
          .is("deleted_at", null).eq("month_start", r.from).order("id").range(a, b), 50_000)
        : Promise.resolve([]),
    ]);
    const row = (kind: string, start: string, g: { title: string; unit: string; target: number; achieved: number; deadline: string; owner: unknown }) => {
      const pct = Number(g.target) ? (Number(g.achieved) / Number(g.target)) * 100 : null;
      return [(g.owner as { full_name: string } | null)?.full_name ?? "", kind, start, g.title, n2(g.target), n2(g.achieved), g.unit, g.deadline,
        n2(pct), pct === null ? null : n2(Math.min(pct, 100)), pct !== null && pct >= 100 ? "Achieved" : "Not achieved"];
    };
    return {
      title: "Goal history", subtitle: `${scope} · ${r.label}`,
      columns: ["Team member", "Goal type", "Period start", "Goal", "Target", "Achieved", "Unit", "Deadline", "Achievement %", "Scored % (capped)", "Result"],
      rows: [...weekly.map((g) => row("Weekly", g.week_start, g)), ...monthly.map((g) => row("Monthly", g.month_start, g))]
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[2]).localeCompare(String(y[2]))),
    };
  }

  if (type === "development") {
    const [reading, recs] = await Promise.all([
      fetchAll((a, b) => supabase.from("reading_progress").select("user_id,status,progress_pct,started_at,completed_at,updated_at,book:books(title,author,improvement_area),reader:profiles!reading_progress_user_id_fkey(full_name)")
        .order("updated_at", { ascending: false }).order("book_id").range(a, b)),
      fetchAll((a, b) => supabase.from("book_recommendations").select("weakness,reason,created_at,dismissed_at,book:books(title,author),member:profiles!book_recommendations_user_id_fkey(full_name)")
        .order("created_at", { ascending: false }).order("id").range(a, b)),
    ]);
    type B = { title: string; author: string; improvement_area?: string } | null;
    return {
      title: "Personal development progress", subtitle: `${scope} · reading list and recommendations`,
      columns: ["Team member", "Type", "Book", "Author", "Status", "Progress %", "Improvement area / reason", "Started / recommended", "Completed / dismissed"],
      rows: [
        ...reading.map((x) => [(x.reader as unknown as { full_name: string } | null)?.full_name ?? "", "Reading list", (x.book as unknown as B)?.title ?? "", (x.book as unknown as B)?.author ?? "",
          x.status.replace(/_/g, " "), x.progress_pct, (x.book as unknown as B)?.improvement_area ?? null, x.started_at?.slice(0, 10) ?? null, x.completed_at?.slice(0, 10) ?? null]),
        ...recs.map((x) => [(x.member as unknown as { full_name: string } | null)?.full_name ?? "", "Recommendation", (x.book as unknown as B)?.title ?? "", (x.book as unknown as B)?.author ?? "",
          x.dismissed_at ? "dismissed" : "recommended", null, `${x.weakness}: ${x.reason}`, x.created_at.slice(0, 10), x.dismissed_at?.slice(0, 10) ?? null]),
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    };
  }
  throw new Error("Unknown report type");
}
