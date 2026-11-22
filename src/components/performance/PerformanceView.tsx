import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerformance, type PeriodType } from "@/server/queries";
import { BarChart, Badge, Card, CardHeader, EmptyState, Table, Td, Th, cn } from "@/components/ui";
import { CategoryGrid, CompositeCard } from "./Breakdown";
import { CATEGORY_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime, num, pct } from "@/lib/format";

export async function PerformanceView({ userId, period, date, basePath }: { userId: string; period: PeriodType; date?: string; basePath: string }) {
  const supabase = await createClient();
  const [perf, hist, versions] = await Promise.all([
    getPerformance(userId, period, date),
    supabase.rpc("performance_history", { p_user: userId, p_type: period, p_limit: period === "daily" ? 14 : period === "weekly" ? 8 : 6 }),
    supabase.from("performance_snapshots").select("period_type,period_start,overall_score,version,computed_at,correction_reason,is_current")
      .eq("user_id", userId).gt("version", 1).order("computed_at", { ascending: false }).limit(10),
  ]);
  const series = [...(hist.data ?? [])].reverse();
  const label = (d: string) => period === "monthly" ? fmtDate(d, { month: "short" }) : fmtDate(d, { day: "numeric", month: "numeric" });
  const sep = basePath.includes("?") ? "&" : "?";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-surface p-0.5 text-body-sm shadow-card">
          {(["daily", "weekly", "monthly"] as const).map((p) => (
            <Link key={p} href={`${basePath}${sep}period=${p}`} className={cn("rounded-md px-3 py-1.5 capitalize", p === period ? "bg-secondary font-semibold text-on-secondary" : "text-muted-text hover:text-ink")}>{p}</Link>
          ))}
        </div>
        <span className="text-body-sm text-muted-text">Period: {fmtDate(perf.period_start)}{perf.period_end !== perf.period_start ? ` – ${fmtDate(perf.period_end)}` : ""} · live calculation</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-5"><CompositeCard perf={perf} periodLabel={period} /></Card>
        <Card className="p-5"><CardHeader eyebrow="Weighted breakdown matrix" title="Category scores" /><div className="mt-4"><CategoryGrid perf={perf} /></div></Card>
      </div>
      <Card className="p-5">
        <CardHeader icon="bar_chart" title="Historical performance" eyebrow={`Recorded ${period} snapshots`} />
        <div className="mt-4">
          {series.length === 0 ? <EmptyState icon="query_stats" title="No recorded periods yet">Snapshots are recorded automatically after each period closes.</EmptyState>
            : <BarChart data={series.map((s) => ({ label: label(s.period_start), value: s.overall_score === null ? null : Number(s.overall_score) }))} />}
        </div>
        {series.length > 0 && (
          <Table className="mt-4">
            <thead><tr><Th>Period</Th><Th>Overall</Th>{Object.values(CATEGORY_LABEL).map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
            <tbody>
              {[...series].reverse().map((s) => {
                const c = (s.categories ?? {}) as Record<string, number | null>;
                return (
                  <tr key={s.period_start}>
                    <Td className="whitespace-nowrap">{fmtDate(s.period_start)}{s.version > 1 && <Badge tone="purple" className="ml-1">v{s.version}</Badge>}</Td>
                    <Td><Badge tone={s.overall_score === null ? "neutral" : Number(s.overall_score) >= 90 ? "green" : Number(s.overall_score) >= 75 ? "blue" : Number(s.overall_score) >= 50 ? "amber" : "red"}>{pct(s.overall_score)}</Badge></Td>
                    {Object.keys(CATEGORY_LABEL).map((k) => <Td key={k} className="text-muted-text">{c[k] === undefined || c[k] === null ? "—" : pct(c[k])}</Td>)}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader icon="functions" title="How this score is calculated" />
          <ul className="mt-3 space-y-1.5 text-body-md text-muted-text">
            <li>• Weights: {Object.entries(perf.weights).map(([k, v]) => `${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]} ${num(v)}%`).join(" · ")}.</li>
            <li>• Tasks: completed ÷ total due × 100. Goals & prospecting: achieved ÷ target × 100.</li>
            <li>• Each category is capped at 100% for scoring; overachievement is shown separately.</li>
            <li>• Categories with nothing due are excluded and remaining weights are scaled proportionally.</li>
            <li>• Daily: to-dos, prospecting, additional tasks. Weekly adds weekly goals. Monthly adds monthly goals.</li>
          </ul>
        </Card>
        <Card className="p-5">
          <CardHeader icon="history_edu" title="Corrections" eyebrow="Every correction creates a new audited version" />
          {(versions.data ?? []).length === 0 ? <p className="mt-3 text-body-md text-muted-text">No corrections have been made.</p> : (
            <ul className="mt-3 space-y-2">
              {(versions.data ?? []).map((v) => (
                <li key={`${v.period_start}-${v.version}`} className="rounded-lg bg-surface-alt px-3 py-2 text-body-sm">
                  <div className="text-ink">{v.period_type} {fmtDate(v.period_start)} → v{v.version}: {pct(v.overall_score)}</div>
                  <div className="text-muted-text">{v.correction_reason ?? "Recomputed"} · {fmtDateTime(v.computed_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
