import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, EmptyState, Icon, PageHeader, Pagination, StatTile, cn } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/client";
import { setFeedbackStatus } from "@/server/actions/feedback";
import { fmtDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Feedback" };
const PAGE = 20;
const TYPE: Record<string, { label: string; icon: string; tone: "purple" | "red" | "green" | "neutral" }> = {
  suggestion: { label: "Suggestion", icon: "lightbulb", tone: "purple" },
  problem: { label: "Something isn't working", icon: "bug_report", tone: "red" },
  compliment: { label: "Compliment", icon: "favorite", tone: "green" },
  other: { label: "Other", icon: "chat", tone: "neutral" },
};

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; page?: string }> }) {
  await requireUser(["super_admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = ["new", "read", "done"].includes(sp.status ?? "") ? sp.status! : "";
  const type = Object.keys(TYPE).includes(sp.type ?? "") ? sp.type! : "";
  const supabase = await createClient();
  let q = supabase.from("feedback").select("id,created_at,type,rating,message,name,email,page,status,user_id", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (status) q = q.eq("status", status);
  if (type) q = q.eq("type", type);
  const [list, all] = await Promise.all([q, supabase.from("feedback").select("status,rating")]);
  const rows = all.data ?? [];
  const rated = rows.filter((r) => r.rating);
  const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : null;
  const href = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(status && { status }), ...(type && { type }), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/super-admin/feedback${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader eyebrow="Talk to the developer" title="Feedback"
        description="Messages from visitors and members: what they like, what isn't working and what to improve."
        actions={<ButtonLink href="/api/reports/export?type=feedback&format=csv" variant="outline" icon="download">Download CSV</ButtonLink>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total feedback" value={rows.length} icon="forum" />
        <StatTile label="New (unread)" value={rows.filter((r) => r.status === "new").length} icon="mark_email_unread" tone="amber" href={href({ status: "new", page: "" })} />
        <StatTile label="Done" value={rows.filter((r) => r.status === "done").length} icon="task_alt" tone="green" />
        <StatTile label="Average rating" value={avg === null ? "—" : `${avg.toFixed(1)} ★`} sub={`${rated.length} rated`} icon="star" tone="blue" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-body-sm">
        {[["", "All"], ["new", "New"], ["read", "Read"], ["done", "Done"]].map(([k, l]) => (
          <Link key={k} href={href({ status: k, page: "" })} className={cn("rounded-lg px-3 py-1.5", status === k ? "bg-secondary font-semibold text-on-secondary" : "bg-surface text-muted-text hover:text-ink")}>{l}</Link>
        ))}
        <span className="mx-1 w-px bg-border-subtle" />
        {[["", "All types"], ...Object.entries(TYPE).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <Link key={k} href={href({ type: k, page: "" })} className={cn("rounded-lg px-3 py-1.5", type === k ? "bg-secondary font-semibold text-on-secondary" : "bg-surface text-muted-text hover:text-ink")}>{l}</Link>
        ))}
      </div>

      {(list.data ?? []).length === 0 ? (
        <Card><EmptyState icon="forum" title="No feedback here yet">Feedback appears here as soon as someone uses the “Talk to the developer” button.</EmptyState></Card>
      ) : (
        <div className="space-y-3">
          {(list.data ?? []).map((f) => {
            const t = TYPE[f.type] ?? TYPE.other!;
            return (
              <Card key={f.id} className={cn("p-4 sm:p-5", f.status === "new" && "border-l-4 border-l-accent-amber")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={t.tone}><Icon name={t.icon} className="text-[14px]" />{t.label}</Badge>
                    {f.rating && <span className="text-body-md text-accent-amber" aria-label={`${f.rating} out of 5 stars`}>{"★".repeat(f.rating)}<span className="text-border-strong">{"★".repeat(5 - f.rating)}</span></span>}
                    <Badge tone={f.status === "new" ? "amber" : f.status === "done" ? "green" : "neutral"}>{f.status === "new" ? "New" : f.status === "done" ? "Done" : "Read"}</Badge>
                  </div>
                  <span className="text-body-sm text-muted-text" title={fmtDateTime(f.created_at)}>{timeAgo(f.created_at)}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-body-lg text-ink">{f.message}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
                  <div className="text-body-sm text-muted-text">
                    {f.name ? <><strong className="text-ink">{f.name}</strong>{f.user_id ? " · Member" : " · Visitor"}</> : <strong className="text-ink">{f.user_id ? "Member" : "Visitor"}</strong>}
                    {f.email && <> · <a href={`mailto:${f.email}?subject=${encodeURIComponent("Re: your Winners Team feedback")}`} className="text-secondary hover:underline">{f.email}</a></>}
                    {f.page && <> · from <span className="font-mono">{f.page}</span></>}
                  </div>
                  <div className="flex gap-2">
                    {f.status !== "read" && <ConfirmAction action={setFeedbackStatus} fields={{ id: f.id, status: "read" }} label="Mark read" icon="drafts" variant="ghost" />}
                    {f.status !== "done" && <ConfirmAction action={setFeedbackStatus} fields={{ id: f.id, status: "done" }} label="Done" icon="task_alt" variant="outline" />}
                    {f.status === "done" && <ConfirmAction action={setFeedbackStatus} fields={{ id: f.id, status: "new" }} label="Reopen" icon="undo" variant="ghost" />}
                  </div>
                </div>
              </Card>
            );
          })}
          <Pagination page={page} pageSize={PAGE} total={list.count ?? 0} hrefFor={(p) => href({ page: p })} />
        </div>
      )}
    </>
  );
}
