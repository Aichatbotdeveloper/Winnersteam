import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, StatTile, Table, Td, Th } from "@/components/ui";
import { ConfirmAction, ModalButton } from "@/components/ui/client";
import { LogActivityForm, TargetsForm } from "@/components/prospecting/Forms";
import { deleteProspecting } from "@/server/actions/productivity";
import { PROSPECTING_LABEL } from "@/lib/labels";
import { addDays, fmtDate, pct, todayInOrg, weekStart } from "@/lib/format";
import type { Database } from "@/lib/database.types";

export const metadata: Metadata = { title: "Prospecting" };
type Act = Database["public"]["Enums"]["prospecting_activity"];

export default async function ProspectingPage() {
  const me = await requireUser();
  const today = todayInOrg();
  const ws = weekStart(today);
  const supabase = await createClient();
  const [targets, weekActs, todayLog, recentTargets] = await Promise.all([
    supabase.from("prospecting_targets").select("activity,period,period_start,target").eq("owner_id", me.id)
      .or(`and(period.eq.daily,period_start.gte.${ws},period_start.lte.${addDays(ws, 6)}),and(period.eq.weekly,period_start.eq.${ws})`),
    supabase.from("prospecting_activities").select("activity,quantity,occurred_on").eq("owner_id", me.id).gte("occurred_on", addDays(today, -13)),
    supabase.from("prospecting_activities").select("*").eq("owner_id", me.id).eq("occurred_on", today).order("created_at", { ascending: false }),
    supabase.from("prospecting_targets").select("activity,target,period_start").eq("owner_id", me.id).eq("period", "daily").lt("period_start", today).order("period_start", { ascending: false }).limit(7),
  ]);
  const tRows = targets.data ?? [];
  const dailyToday: Record<string, number> = Object.fromEntries(tRows.filter((t) => t.period === "daily" && t.period_start === today).map((t) => [t.activity, t.target]));
  const weekly: Record<string, number> = Object.fromEntries(tRows.filter((t) => t.period === "weekly").map((t) => [t.activity, t.target]));
  const lastDate = recentTargets.data?.[0]?.period_start;
  const suggestion: Record<string, number> = Object.fromEntries((recentTargets.data ?? []).filter((t) => t.period_start === lastDate).map((t) => [t.activity, t.target]));

  const sum = (from: string, to: string) => {
    const m = new Map<Act, number>();
    for (const a of weekActs.data ?? []) if (a.occurred_on >= from && a.occurred_on <= to) m.set(a.activity, (m.get(a.activity) ?? 0) + a.quantity);
    return m;
  };
  const todayActual = sum(today, today);
  const weekActual = sum(ws, addDays(ws, 6));
  // Weekly target per activity: weekly target if set, otherwise sum of the week's daily targets.
  const weekTarget = new Map<Act, number>();
  for (const a of Object.keys(PROSPECTING_LABEL) as Act[]) {
    const w = weekly[a] ?? tRows.filter((t) => t.period === "daily" && t.activity === a).reduce((s, t) => s + t.target, 0);
    if (w > 0) weekTarget.set(a, w);
  }
  const score = (tg: Map<Act, number> | Record<string, number>, act: Map<Act, number>) => {
    const entries = tg instanceof Map ? [...tg.entries()] : Object.entries(tg) as [Act, number][];
    const total = entries.reduce((s, [, n]) => s + n, 0);
    if (!total) return { capped: null, raw: null };
    const capped = entries.reduce((s, [a, n]) => s + Math.min(act.get(a) ?? 0, n), 0) / total * 100;
    const raw = entries.reduce((s, [a]) => s + (act.get(a) ?? 0), 0) / total * 100;
    return { capped, raw };
  };
  const dScore = score(dailyToday, todayActual);
  const wScore = score(weekTarget, weekActual);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));

  return (
    <>
      <PageHeader eyebrow="Outreach & acquisition" title="Prospecting Management"
        description="Set daily and weekly targets, log activity as it happens and watch your achievement update automatically."
        actions={<>
          <ModalButton label="Daily targets" title={`Prospecting targets — ${fmtDate(today)}`} icon="flag" variant="outline" wide><TargetsForm period="daily" periodStart={today} current={dailyToday} suggestion={suggestion} /></ModalButton>
          <ModalButton label="Weekly targets" title={`Weekly targets — w/c ${fmtDate(ws)}`} icon="date_range" variant="outline" wide><TargetsForm period="weekly" periodStart={ws} current={weekly} /></ModalButton>
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Today's achievement" value={pct(dScore.capped)} sub={dScore.raw !== null && dScore.raw > 100 ? `Actual ${pct(dScore.raw)} (overachieved)` : "Capped per activity"} icon="today" />
        <StatTile label="Week's achievement" value={pct(wScore.capped)} sub={wScore.raw !== null ? `Actual ${pct(wScore.raw)}` : "No weekly targets"} icon="date_range" tone="blue" />
        <StatTile label="Logged today" value={[...todayActual.values()].reduce((s, n) => s + n, 0)} icon="call" tone="green" />
        <StatTile label="Logged this week" value={[...weekActual.values()].reduce((s, n) => s + n, 0)} icon="stacked_bar_chart" tone="amber" />
      </div>

      <Card className="mb-5 p-5">
        <CardHeader icon="add_call" title="Log prospecting activity" eyebrow="Entries are recorded for today" />
        <div className="mt-4"><LogActivityForm /></div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader icon="flag" title="Today vs target" />
          <div className="mt-4 space-y-3">
            {Object.keys(dailyToday).length === 0 && <EmptyState icon="flag" title="No daily targets set">Use “Daily targets” to set today&apos;s targets.</EmptyState>}
            {(Object.entries(dailyToday) as [Act, number][]).map(([a, t]) => {
              const v = todayActual.get(a) ?? 0;
              return (
                <div key={a}>
                  <div className="flex justify-between text-body-md"><span className="text-ink">{PROSPECTING_LABEL[a]}</span><span className="font-semibold">{v} / {t}{v > t && <Badge tone="green" className="ml-2">+{v - t}</Badge>}</span></div>
                  <Progress value={(v / t) * 100} color={v >= t ? "var(--color-accent-emerald)" : "var(--color-accent-amber)"} className="mt-1.5" />
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <CardHeader icon="date_range" title="This week vs target" eyebrow={`w/c ${fmtDate(ws)}`} />
          <div className="mt-4 space-y-3">
            {weekTarget.size === 0 && <EmptyState icon="date_range" title="No weekly targets" />}
            {[...weekTarget.entries()].map(([a, t]) => {
              const v = weekActual.get(a) ?? 0;
              return (
                <div key={a}>
                  <div className="flex justify-between text-body-md"><span className="text-ink">{PROSPECTING_LABEL[a]} {weekly[a] ? <Badge tone="blue">weekly target</Badge> : <Badge>sum of daily</Badge>}</span><span className="font-semibold">{v} / {t}</span></div>
                  <Progress value={(v / t) * 100} color="var(--color-accent-blue)" className="mt-1.5" />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="list_alt" title="Today's activity log" /></div>
        {(todayLog.data ?? []).length === 0 ? <div className="px-5 pb-5"><EmptyState icon="call" title="Nothing logged yet today" /></div> : (
          <Table>
            <thead><tr><Th>Time</Th><Th>Activity</Th><Th>Qty</Th><Th>Prospect / note</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {(todayLog.data ?? []).map((l) => (
                <tr key={l.id}>
                  <Td className="text-muted-text">{fmtDate(l.created_at, { hour: "2-digit", minute: "2-digit" })}</Td>
                  <Td className="font-medium text-ink">{PROSPECTING_LABEL[l.activity]}</Td>
                  <Td>{l.quantity}</Td>
                  <Td className="text-muted-text">{l.prospect_name ?? "—"}</Td>
                  <Td className="text-right"><ConfirmAction action={deleteProspecting} label="Remove" icon="delete" variant="ghost" confirm="Remove this entry?" fields={{ id: l.id }} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="calendar_view_week" title="Last 14 days" /></div>
        <Table>
          <thead><tr><Th>Activity</Th>{days.map((d) => <Th key={d} className="px-2 text-center">{fmtDate(d, { day: "numeric", month: "numeric" })}</Th>)}</tr></thead>
          <tbody>
            {(Object.keys(PROSPECTING_LABEL) as Act[]).map((a) => (
              <tr key={a}>
                <Td className="whitespace-nowrap text-ink">{PROSPECTING_LABEL[a]}</Td>
                {days.map((d) => { const v = sum(d, d).get(a) ?? 0; return <Td key={d} className={`px-2 text-center ${v ? "font-semibold text-ink" : "text-faint-text"}`}>{v || "·"}</Td>; })}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
