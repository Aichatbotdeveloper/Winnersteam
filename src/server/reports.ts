import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { CATEGORY_LABEL, CONSEQUENCE_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { normalisePerformance, type PeriodType } from "@/server/queries";
import { fmtDate } from "@/lib/format";

export type Report = { title: string; subtitle: string; columns: string[]; rows: (string | number | null)[][] };
const CATS = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];
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
    const { data } = await supabase.from("accountability_ledger")
      .select("assigned_at,category,quantity,unit,currency,status,completed_at,accommodation_active,selected_by,member:profiles!accountability_ledger_user_id_fkey(full_name),event:accountability_events(period_type,period_start,performance_pct,level,triggering_category)")
      .order("assigned_at", { ascending: false }).limit(5000);
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
    const { data } = await supabase.from("tasks").select("title,kind,priority,status,due_date,completed_at,owner:profiles!tasks_owner_id_fkey(full_name)")
      .is("deleted_at", null).gte("due_date", from.toISOString().slice(0, 10)).lte("due_date", date).order("due_date", { ascending: false }).limit(10000);
    return {
      title: "Tasks (last 30 days)", subtitle: scope,
      columns: ["Owner", "Task", "List", "Priority", "Status", "Due date", "Completed at"],
      rows: (data ?? []).map((t) => [(t.owner as unknown as { full_name: string } | null)?.full_name ?? "", t.title, t.kind, t.priority, t.status, t.due_date, t.completed_at]),
    };
  }

  if (type === "users" && me.role !== "team_member") {
    const { data } = await supabase.from("profiles").select("full_name,email,role,status,job_title,team_name,created_at").order("full_name").limit(5000);
    return {
      title: "User directory", subtitle: scope,
      columns: ["Name", "E-mail", "Role", "Status", "Job title", "Team", "Registered"],
      rows: (data ?? []).map((p) => [p.full_name, p.email, ROLE_LABEL[p.role], STATUS_LABEL[p.status], p.job_title, p.team_name, p.created_at.slice(0, 10)]),
    };
  }
  throw new Error("Unknown report type");
}
