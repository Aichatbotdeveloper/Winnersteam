import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, StatTile, Table, Td, Th } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { GoalActions, GoalForm, GoalProgress, type Goal } from "@/components/goals/GoalForms";
import { addDays, fmtDate, monthEnd, monthStart, num, pct, todayInOrg, weekStart } from "@/lib/format";

export async function GoalsPage({ kind }: { kind: "weekly" | "monthly" }) {
  const me = await requireUser();
  const today = todayInOrg();
  const start = kind === "weekly" ? weekStart(today) : monthStart(today);
  const end = kind === "weekly" ? addDays(start, 6) : monthEnd(start);
  const table = kind === "weekly" ? "weekly_goals" : "monthly_goals";
  const col = kind === "weekly" ? "week_start" : "month_start";
  const supabase = await createClient();
  // Both goal tables share the same shape apart from the period column.
  const q = () => supabase.from(table as "weekly_goals").select("*").eq("owner_id", me.id).is("deleted_at", null);
  const [cur, hist] = await Promise.all([
    q().eq(col as "week_start", start).order("created_at"),
    q().lt(col as "week_start", start).order(col as "week_start", { ascending: false }).limit(60),
  ]);
  const goals = (cur.data ?? []) as unknown as (Goal & Record<string, unknown>)[];
  const capped = goals.map((g) => Math.min(Number(g.achieved) / Number(g.target), 1) * 100);
  const raw = goals.map((g) => (Number(g.achieved) / Number(g.target)) * 100);
  const avg = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : null);
  const achievedCount = goals.filter((g) => Number(g.achieved) >= Number(g.target)).length;
  const periodLabel = kind === "weekly" ? `${fmtDate(start, { day: "numeric", month: "short" })} – ${fmtDate(end)}` : fmtDate(start, { month: "long", year: "numeric" });

  const history = new Map<string, Record<string, unknown>[]>();
  for (const h of hist.data ?? []) history.set(String((h as Record<string, unknown>)[col]), [...(history.get(String((h as Record<string, unknown>)[col])) ?? []), h as Record<string, unknown>]);

  return (
    <>
      <PageHeader eyebrow={`${kind === "weekly" ? "Week" : "Month"} · ${periodLabel}`} title={kind === "weekly" ? "Weekly Goals" : "Monthly Goals"}
        description={kind === "weekly" ? "Set measurable targets for this week (Monday–Sunday) and update your progress. Each goal counts equally; scores cap at 100%."
          : "Define measurable monthly objectives, monitor achievement and track what remains. Monthly goals never erase incomplete daily tasks."}
        actions={<ModalButton label={`New ${kind} goal`} title={`New ${kind} goal`} icon="add"><GoalForm kind={kind} periodStart={start} periodEnd={end} /></ModalButton>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active goals" value={goals.length} icon="track_changes" />
        <StatTile label="Achieved" value={`${achievedCount}/${goals.length}`} icon="emoji_events" tone="green" />
        <StatTile label="Scored achievement" value={pct(avg(capped))} sub="Capped at 100% per goal" icon="percent" tone="blue" />
        <StatTile label="Actual achievement" value={pct(avg(raw))} sub="Including overachievement" icon="trending_up" tone="amber" />
      </div>
      <Card className="p-5">
        <CardHeader icon="flag" title={`This ${kind === "weekly" ? "week" : "month"}'s goals`} />
        <div className="mt-4 space-y-3">
          {goals.length === 0 && <EmptyState icon="flag" title={`No ${kind} goals yet`}>Create your first measurable goal for this {kind === "weekly" ? "week" : "month"}.</EmptyState>}
          {goals.map((g) => {
            const p = (Number(g.achieved) / Number(g.target)) * 100;
            const remaining = Math.max(Number(g.target) - Number(g.achieved), 0);
            return (
              <div key={g.id} className="rounded-xl border border-border-subtle p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-body-lg text-ink">{g.title}</span>
                      {p >= 100 ? <Badge tone="green">Achieved</Badge> : g.deadline < today ? <Badge tone="red">Deadline passed</Badge> : <Badge tone="amber">In progress</Badge>}
                    </div>
                    {g.description && <p className="mt-0.5 text-body-sm text-muted-text">{g.description}</p>}
                    <p className="mt-1 text-body-sm text-muted-text">Target {num(g.target)} {g.unit} · Achieved {num(g.achieved)} · Remaining {num(remaining)} · Due {fmtDate(g.deadline)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GoalProgress kind={kind} goal={g} />
                    <GoalActions kind={kind} goal={g} periodStart={start} periodEnd={end} />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={p} color={p >= 100 ? "var(--color-accent-emerald)" : "var(--color-secondary)"} />
                  <span className="w-16 text-right font-heading text-label-md text-ink">{pct(p)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="mt-5 overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="history" title="Previous periods" eyebrow="Locked after the period closes" /></div>
        {history.size === 0 ? <div className="px-5 pb-5"><EmptyState icon="history" title="No history yet" /></div> : (
          <Table>
            <thead><tr><Th>{kind === "weekly" ? "Week" : "Month"}</Th><Th>Goal</Th><Th>Target</Th><Th>Achieved</Th><Th>Result</Th></tr></thead>
            <tbody>
              {[...history.entries()].flatMap(([p, rows]) => rows.map((r, i) => {
                const pr = (Number(r.achieved) / Number(r.target)) * 100;
                return (
                  <tr key={String(r.id)}>
                    <Td className="text-muted-text">{i === 0 ? (kind === "weekly" ? `w/c ${fmtDate(p)}` : fmtDate(p, { month: "long", year: "numeric" })) : ""}</Td>
                    <Td className="font-medium text-ink">{String(r.title)}</Td>
                    <Td>{num(r.target as number)} {String(r.unit)}</Td>
                    <Td>{num(r.achieved as number)}</Td>
                    <Td><Badge tone={pr >= 100 ? "green" : pr >= 75 ? "blue" : pr >= 50 ? "amber" : "red"}>{pct(pr)}</Badge></Td>
                  </tr>
                );
              }))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
