import { Badge, Icon, Progress, RingGauge, cn } from "@/components/ui";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/labels";
import { pct, num } from "@/lib/format";
import type { CategoryScore, Performance } from "@/server/queries";

function detail(c: CategoryScore) {
  if (!c.applicable) return "Not applicable this period";
  switch (c.category) {
    case "daily_todo": case "additional_tasks": return `${num(c.completed)}/${num(c.total)} tasks completed`;
    case "prospecting": return `${num(c.completed)} of ${num(c.total)} target activities`;
    default: return `${num(c.completed)}/${num(c.total)} goals achieved`;
  }
}

export function CategoryGrid({ perf }: { perf: Performance }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {perf.categories.map((c) => {
        const over = c.raw_pct !== null && c.capped_pct !== null && c.raw_pct > c.capped_pct;
        return (
          <div key={c.category} className={cn("rounded-xl border border-border-subtle bg-surface-alt/50 p-3.5", c.category === "additional_tasks" && "sm:col-span-2", !c.applicable && "opacity-60")}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded px-1 text-[11px] font-bold" style={{ color: CATEGORY_COLOR[c.category], background: `${CATEGORY_COLOR[c.category]}1a` }}>{num(c.weight)}%</span>
                <span className="truncate text-label-md text-ink">{CATEGORY_LABEL[c.category]}</span>
              </div>
              <span className="font-heading text-heading-md text-ink">{c.applicable ? pct(c.capped_pct) : "N/A"}</span>
            </div>
            <Progress value={c.capped_pct ?? 0} color={CATEGORY_COLOR[c.category]} className="mt-2.5" label={CATEGORY_LABEL[c.category]} />
            <div className="mt-2 flex items-center justify-between text-body-sm text-muted-text">
              <span>{detail(c)}</span>
              {over ? <Badge tone="green">Overachieved {pct(c.raw_pct)}</Badge>
                : c.applicable ? <span className="text-faint-text">Effective weight {num(c.effective_weight)}%</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CompositeCard({ perf, title = "Composite Performance", periodLabel }: { perf: Performance; title?: string; periodLabel: string }) {
  const tier = perf.overall === null ? "No data yet" : perf.overall >= 90 ? "Target achieved" : perf.overall >= 75 ? "On track" : perf.overall >= 50 ? "Needs attention" : "At risk";
  return (
    <div className="flex h-full flex-col">
      <div className="eyebrow">Weighted score · {periodLabel}</div>
      <h2 className="font-heading text-heading-lg text-ink">{title}</h2>
      <div className="flex flex-1 items-center justify-center py-5"><RingGauge value={perf.overall} label="Weighted score" sub={tier} size={170} /></div>
      <div className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 text-body-sm text-muted-text">
        <span className="flex items-center gap-1.5"><Icon name="functions" className="text-[16px]" />Weighted formula</span>
        <span className="font-mono">{perf.categories.filter((c) => c.applicable).length} of 5 categories</span>
      </div>
    </div>
  );
}
