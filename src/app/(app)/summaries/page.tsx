import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, Icon, PageHeader, cn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { SummaryView, type SummaryRow } from "@/components/summaries/SummaryView";
import { SCOPE_LABEL, periodLabel } from "@/lib/summaries";
import { createSummariesNow } from "@/server/actions/summaries";

export const metadata: Metadata = { title: "Summaries" };

export default async function SummariesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const me = await requireUser();
  const { id } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("performance_summaries").select("id,scope,period_type,period_start,period_end,stats,ai_text,ai_used,created_at")
    .eq("user_id", me.id).eq("delivered", true).order("period_start", { ascending: false }).order("period_type").limit(60);
  const list = (data ?? []) as SummaryRow[];
  const current = list.find((s) => s.id === id) ?? list[0] ?? null;

  return (
    <>
      <PageHeader eyebrow="Dashboard & overviews" title="Weekly & Monthly Summaries"
        description="Every Monday at 7 AM (last week) and on the 1st at 7 AM (last month): your results and a short note from LEX on what went well and what to focus on next."
        actions={me.role === "super_admin" ? <ActionForm action={createSummariesNow}><SubmitButton variant="outline" icon="auto_awesome" pendingText="Creating…">Create summaries now</SubmitButton></ActionForm> : undefined} />
      {!current ? (
        <Card><EmptyState icon="summarize" title="No summaries yet">Your first summary arrives next Monday at 7 AM, once you have checklists graded during the week.</EmptyState></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Past summaries" className="space-y-2 lg:sticky lg:top-24 lg:self-start">
            {list.map((s) => (
              <Link key={s.id} href={`/summaries?id=${s.id}`} className={cn("block rounded-xl border px-3 py-2.5 transition-colors",
                s.id === current.id ? "border-secondary bg-surface-container-low" : "border-border-subtle bg-surface hover:border-secondary/40")}>
                <div className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-muted-text">
                  <Icon name={s.period_type === "weekly" ? "date_range" : "calendar_month"} className="text-[15px]" />{s.period_type}
                  {s.scope !== "member" && <Badge tone="purple" className="ml-auto">{SCOPE_LABEL[s.scope]}</Badge>}
                </div>
                <div className="mt-0.5 text-body-md font-semibold text-ink">{periodLabel(s.period_type, s.period_start, s.period_end)}</div>
              </Link>
            ))}
          </nav>
          <Card className="p-5"><SummaryView s={current} /></Card>
        </div>
      )}
    </>
  );
}
