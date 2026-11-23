import { Icon, Progress, RingGauge, cn } from "@/components/ui";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/labels";
import { pct, num } from "@/lib/format";
import type { CategoryScore, Performance } from "@/server/queries";

const SHOWN = ["daily_todo", "weekly_goals", "prospecting", "monthly_goals"] as const;

function detail(c: CategoryScore) {
  if (!c.applicable) return "No checklists due this period";
  return `${num(c.total)} checklist${c.total === 1 ? "" : "s"} · ${num(c.completed)} graded`;
}

/** Average score per list type (each checklist still counts on its own). */
export function CategoryGrid({ perf }: { perf: Performance }) {
  const cats = SHOWN.map((k) => perf.categories.find((c) => c.category === k)).filter(Boolean) as CategoryScore[];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cats.map((c) => (
        <div key={c.category} className={cn("rounded-xl border border-border-subtle bg-surface-alt/50 p-3.5", !c.applicable && "opacity-60")}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[c.category] }} />
              <span className="truncate text-label-md text-ink">{CATEGORY_LABEL[c.category]}</span>
            </span>
            <span className="font-heading text-heading-md text-ink">{c.applicable ? pct(c.capped_pct) : "—"}</span>
          </div>
          <Progress value={c.capped_pct ?? 0} color={CATEGORY_COLOR[c.category]} className="mt-2.5" label={CATEGORY_LABEL[c.category]} />
          <div className="mt-2 text-body-sm text-muted-text">{detail(c)}</div>
        </div>
      ))}
    </div>
  );
}

export function CompositeCard({ perf, title = "Average score", periodLabel }: { perf: Performance; title?: string; periodLabel: string }) {
  const n = perf.categories.reduce((s, c) => s + (c.total ?? 0), 0);
  const tier = perf.overall === null ? "No checklists yet" : perf.overall >= 90 ? "Excellent" : perf.overall >= 75 ? "On track" : perf.overall >= 50 ? "Needs attention" : "At risk";
  return (
    <div className="flex h-full flex-col">
      <div className="eyebrow">Average score · {periodLabel}</div>
      <h2 className="font-heading text-heading-lg text-ink">{title}</h2>
      <div className="flex flex-1 items-center justify-center py-5"><RingGauge value={perf.overall} label="Average" sub={tier} size={170} /></div>
      <div className="flex items-start gap-1.5 rounded-lg bg-surface-alt px-3 py-2 text-body-sm text-muted-text">
        <Icon name="info" className="mt-0.5 text-[16px]" />
        <span>Average of {n} checklist{n === 1 ? "" : "s"} due this {periodLabel === "daily" ? "day" : periodLabel === "weekly" ? "week" : "month"}. For information only — each checklist is graded on its own.</span>
      </div>
    </div>
  );
}
