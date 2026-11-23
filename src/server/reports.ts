import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { CATEGORY_LABEL, CONSEQUENCE_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { normalisePerformance, type PeriodType } from "@/server/queries";
import { addDays, fmtDate, monthEnd, monthStart, weekStart } from "@/lib/format";
import { KIND, type ChecklistKind } from "@/lib/checklists";

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
      .select("assigned_at,category,quantity,unit,currency,status,completed_at,accommodation_active,selected_by,member:profiles!accountability_ledger_user_id_fkey(full_name),event:accountability_events(period_type,period_start,performance_pct,level,triggering_category,checklist:checklists(title,kind,deadline))")
      .order("assigned_at", { ascending: false }).order("id").range(a, b));
    return {
      title: "Accountability ledger", subtitle: scope,
      columns: ["Team member", "Checklist", "Deadline / period", "Score %", "Level", "List type", "Consequence", "Quantity", "Unit", "Accommodation", "Selected by", "Assigned at", "Status", "Completed at"],
      rows: (data ?? []).map((l) => {
        const e = l.event as unknown as { period_type: string; period_start: string; performance_pct: number; level: string; triggering_category: keyof typeof CATEGORY_LABEL; checklist: { title: string; deadline: string } | null };
        return [(l.member as unknown as { full_name: string } | null)?.full_name ?? "", e.checklist?.title ?? `${e.period_type} period`,
          e.checklist ? fmtDate(e.checklist.deadline, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : e.period_start,
          n2(e.performance_pct), e.level, CATEGORY_LABEL[e.triggering_category],
          CONSEQUENCE_LABEL[l.category], n2(l.quantity), l.unit, l.accommodation_active ? "Yes" : "No", l.selected_by === "system_auto" ? "System (window passed)" : "Member", l.assigned_at, l.status, l.completed_at];
      }),
    };
  }

  if (type === "checklists" || type === "checklist_items") {
    const r = periodRange(period, date);
    const from = `${r.from}T00:00:00+01:00`, to = `${r.to}T23:59:59.999+01:00`; // organisation time (Africa/Lagos)
    type Row = { id: string; title: string; kind: ChecklistKind; deadline: string; status: string; closed_reason: string | null; score: number | null;
      owner: { full_name: string } | null; items: { title: string; progress: number; target: number | null; achieved: number; position: number }[];
      event: { level: string; ledger: { category: string; quantity: number; selected_by: string }[] } | { level: string; ledger: { category: string; quantity: number; selected_by: string }[] }[] | null };
    const data = await fetchAll((a, b) => supabase.from("checklists")
      .select("id,title,kind,deadline,status,closed_reason,score,owner:profiles!checklists_owner_id_fkey(full_name),items:checklist_items(title,progress,target,achieved,position),event:accountability_events(level,ledger:accountability_ledger(category,quantity,selected_by))")
      .gte("deadline", from).lte("deadline", to).order("deadline").order("id").range(a, b), 50_000) as unknown as Row[];
    const when = (v: string) => fmtDate(v, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const kindName = (k: ChecklistKind) => KIND[k].page.replace(/^My /, "");
    if (type === "checklist_items") {
      return {
        title: "Checklist items", subtitle: `${scope} · deadlines in ${r.label}`,
        columns: ["Team member", "Type", "Checklist", "Deadline", "Item", "Progress %", "Done", "Target"],
        rows: data.flatMap((c) => [...(c.items ?? [])].sort((x, y) => x.position - y.position).map((i) => [
          c.owner?.full_name ?? "", kindName(c.kind), c.title, when(c.deadline), i.title, n2(i.progress),
          c.kind === "prospecting" ? i.achieved : null, c.kind === "prospecting" ? i.target : null])),
      };
    }
    return {
      title: "Checklists", subtitle: `${scope} · deadlines in ${r.label}`,
      columns: ["Team member", "Type", "Checklist", "Deadline", "Status", "Items", "Score %", "Outcome"],
      rows: data.map((c) => {
        const ev = Array.isArray(c.event) ? c.event[0] ?? null : c.event;
        const led = ev?.ledger?.[0];
        const outcome = c.status === "open" ? "Open" : c.score === null ? "Not graded (no items)" : !ev ? "No consequence"
          : led ? `${CONSEQUENCE_LABEL[led.category as keyof typeof CONSEQUENCE_LABEL] ?? led.category}: ${n2(led.quantity)} (${led.selected_by === "system_auto" ? "spun by system" : "spun by member"})` : "Spin pending";
        return [c.owner?.full_name ?? "", kindName(c.kind), c.title, when(c.deadline),
          c.status === "open" ? "Open" : c.closed_reason === "submitted" ? "Submitted early" : "Graded at deadline",
          (c.items ?? []).length, c.status === "open" ? null : n2(c.score), outcome];
      }),
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
