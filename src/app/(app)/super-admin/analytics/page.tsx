import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BarChart, Card, CardHeader, EmptyState, PageHeader, Progress, Table, Td, Th, buttonClass, cn, scoreColor } from "@/components/ui";
import { addDays, fmtDate, pct, todayInOrg } from "@/lib/format";
import Link from "next/link";

export const metadata: Metadata = { title: "Organisation Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireUser(["super_admin"]);
  const sp = await searchParams;
  const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "daily") as "daily" | "weekly" | "monthly";
  const today = todayInOrg();
  const from = addDays(today, period === "daily" ? -14 : period === "weekly" ? -63 : -186);
  const supabase = await createClient();
  const [cmp, snaps] = await Promise.all([
    supabase.rpc("administrator_comparison", { p_type: period, p_from: from, p_to: today }),
    supabase.from("performance_snapshots").select("period_start,overall_score").eq("period_type", period).eq("is_current", true).gte("period_start", from).not("overall_score", "is", null).limit(20000),
  ]);
  const byPeriod = new Map<string, number[]>();
  for (const s of snaps.data ?? []) byPeriod.set(s.period_start, [...(byPeriod.get(s.period_start) ?? []), Number(s.overall_score)]);
  const trend = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ label: fmtDate(d, period === "monthly" ? { month: "short" } : { day: "numeric", month: "numeric" }), value: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }));
  return (
    <>
      <PageHeader eyebrow="Organisation-wide intelligence" title="Organisation Analytics" description="Historical performance from recorded snapshots, and administrator team comparisons."
        actions={<div className="flex rounded-lg bg-surface p-0.5 shadow-card">{(["daily", "weekly", "monthly"] as const).map((p) => <Link key={p} href={`?period=${p}`} className={cn("rounded-md px-3 py-1.5 text-body-sm capitalize", p === period ? "bg-secondary text-on-secondary" : "text-muted-text")}>{p}</Link>)}</div>} />
      <Card className="mb-5 p-5">
        <CardHeader icon="show_chart" title="Organisation average over time" eyebrow={`${(snaps.data ?? []).length} recorded ${period} snapshots`} />
        <div className="mt-4">{trend.length ? <BarChart data={trend} height={160} /> : <EmptyState icon="query_stats" title="No recorded snapshots in this range" />}</div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3"><CardHeader icon="leaderboard" title="Administrator team comparison" eyebrow={`${fmtDate(from)} – ${fmtDate(today)}`} /><a className={buttonClass("outline", "sm")} href={`/api/reports/export?type=performance&period=${period}&format=xlsx`}>Export Excel</a></div>
        <Table>
          <thead><tr><Th>Administrator</Th><Th>Members</Th><Th>Average score</Th><Th>Snapshots</Th></tr></thead>
          <tbody>{[...(cmp.data ?? [])].sort((a, b) => Number(b.avg_score ?? -1) - Number(a.avg_score ?? -1)).map((r) => (
            <tr key={r.administrator_id}><Td className="font-medium text-ink">{r.administrator_name}</Td><Td>{Number(r.members)}</Td>
              <Td><div className="flex w-48 items-center gap-2"><Progress value={Number(r.avg_score ?? 0)} color={scoreColor(r.avg_score === null ? null : Number(r.avg_score))} /><span className="text-label-md">{pct(r.avg_score)}</span></div></Td>
              <Td className="text-muted-text">{Number(r.snapshots)}</Td></tr>
          ))}</tbody>
        </Table>
      </Card>
    </>
  );
}
