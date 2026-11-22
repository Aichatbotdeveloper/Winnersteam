import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, EmptyState, Icon, PageHeader, Pagination, Tabs } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/client";
import { markUpdate } from "@/server/actions/serviceUpdates";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Service Updates" };
const PAGE = 15;

export default async function ServiceUpdatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const tab = ["unread", "saved"].includes(sp.tab ?? "") ? sp.tab! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("user_service_updates")
    .select("update_id,reason,read_at,saved_at,delivered_at,update:service_updates(id,title,url,published_at,excerpt,ai_summary,recommended_action,relevance_note,source:service_update_sources(name),category:service_categories(name))", { count: "exact" })
    .eq("user_id", me.id).order("delivered_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (tab === "unread") q = q.is("read_at", null);
  if (tab === "saved") q = q.not("saved_at", "is", null);
  const [{ data, count }, services, sources] = await Promise.all([
    q,
    supabase.from("profile_services").select("name, category:service_categories(name)").eq("profile_id", me.id),
    supabase.from("service_update_sources").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const cats = [...new Set((services.data ?? []).map((s) => (s.category as unknown as { name: string } | null)?.name).filter(Boolean))];
  type U = { id: string; title: string; url: string; published_at: string | null; excerpt: string | null; ai_summary: string | null; recommended_action: string | null; relevance_note: string | null; source: { name: string } | null; category: { name: string } | null };

  return (
    <>
      <PageHeader eyebrow="Service intelligence" title="Professional Service Updates"
        description="Updates from approved, reputable sources matched to the service categories in your profile. Every item links to its original source."
        actions={me.role === "super_admin" ? <ButtonLink href="/settings/sources" variant="outline" icon="rss_feed">Manage sources</ButtonLink> : undefined} />
      <Card className="mb-5 flex flex-wrap items-center gap-2 p-4 text-body-md">
        <Icon name="tune" className="text-secondary" />
        <span className="text-muted-text">Personalised for:</span>
        {cats.length ? cats.map((c) => <Badge key={c} tone="purple">{c}</Badge>) : <span className="text-muted-text">no service categories yet — <Link href="/profile" className="font-semibold text-secondary">add services to your profile</Link>.</span>}
      </Card>
      <Tabs active={tab} items={[{ key: "all", href: "/service-updates", label: "All", icon: "feed" }, { key: "unread", href: "/service-updates?tab=unread", label: "Unread", icon: "mark_email_unread" }, { key: "saved", href: "/service-updates?tab=saved", label: "Saved", icon: "bookmark" }]} />
      {(data ?? []).length === 0 ? (
        <EmptyState icon="feed" title={tab === "saved" ? "No saved updates" : "No updates yet"}>
          {(sources.count ?? 0) === 0 ? "No approved update sources have been configured by the Super Admin yet." : cats.length === 0 ? "Add services with categories to your profile to receive matching updates." : "New items appear here after the next scheduled update run."}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((row) => {
            const u = row.update as unknown as U;
            return (
              <Card key={row.update_id} className={`p-5 ${row.read_at ? "" : "border-l-4 border-l-secondary"}`}>
                <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-text">
                  {u.category && <Badge tone="blue">{u.category.name}</Badge>}
                  <span>{u.source?.name}</span><span>·</span><span>{u.published_at ? fmtDate(u.published_at) : "Date not provided by source"}</span>
                  {!row.read_at && <Badge tone="purple" dot>New</Badge>}
                </div>
                <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 block font-heading text-heading-md text-ink hover:underline">{u.title}</a>
                {u.ai_summary ? (
                  <p className="mt-2 text-body-md text-body-text"><Badge tone="purple" className="mr-1.5">AI summary</Badge>{u.ai_summary}</p>
                ) : u.excerpt && <p className="mt-2 line-clamp-3 text-body-md text-muted-text">{u.excerpt}</p>}
                {u.recommended_action && <p className="mt-2 flex gap-1.5 rounded-lg bg-accent-emerald/10 px-3 py-2 text-body-sm text-on-tertiary-fixed-variant"><Icon name="lightbulb" className="text-[16px]" />Suggested action: {u.recommended_action}</p>}
                <p className="mt-2 text-body-sm text-faint-text">Why you&apos;re seeing this: {row.reason}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-body-sm font-semibold text-on-primary">Read original <Icon name="open_in_new" className="text-[15px]" /></a>
                  <ConfirmAction action={markUpdate} label={row.saved_at ? "Saved" : "Save"} icon={row.saved_at ? "bookmark_added" : "bookmark_add"} fields={{ id: row.update_id, op: row.saved_at ? "unsave" : "save" }} />
                  <ConfirmAction action={markUpdate} label={row.read_at ? "Mark unread" : "Mark read"} variant="ghost" fields={{ id: row.update_id, op: row.read_at ? "unread" : "read" }} />
                </div>
              </Card>
            );
          })}
          <Card><Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={(p) => `/service-updates?tab=${tab}&page=${p}`} /></Card>
        </div>
      )}
    </>
  );
}
