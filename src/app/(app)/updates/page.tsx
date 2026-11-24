import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, Icon, PageHeader, Tabs, cn } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { DeclineForm, PublishForm, ShareUpdateForm } from "@/components/posts/UpdateForms";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Team Updates" };
type Post = { id: string; author_id: string; kind: string; title: string; body: string; link: string | null; attachment_path: string | null; status: string;
  review_note: string | null; audience: string | null; published_at: string | null; created_at: string; recipients: number | null; author: { full_name: string } | null };

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isSuper = me.role === "super_admin";
  const tabs = [{ key: "feed", label: "Team updates", icon: "campaign" }, ...(isSuper ? [{ key: "inbox", label: "Review inbox", icon: "inbox" }] : [{ key: "share", label: "Share an update", icon: "add_comment" }])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "feed";
  const supabase = await createClient();
  const sel = "id,author_id,kind,title,body,link,attachment_path,status,review_note,audience,published_at,created_at,recipients,author:profiles!update_posts_author_id_fkey(full_name)";
  const [feed, pending, mine, everyone, admins] = await Promise.all([
    supabase.from("update_posts").select(sel).eq("status", "published").order("published_at", { ascending: false }).limit(50),
    isSuper ? supabase.from("update_posts").select(sel).eq("status", "pending").order("created_at") : Promise.resolve({ data: [] }),
    !isSuper ? supabase.from("update_posts").select(sel).eq("author_id", me.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isSuper ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "approved") : Promise.resolve({ count: 0 }),
    isSuper ? supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "approved").in("role", ["administrator", "super_admin"]) : Promise.resolve({ count: 0 }),
  ]);
  const counts = { everyone: Math.max(0, (everyone.count ?? 1) - 1), admins: Math.max(0, (admins.count ?? 1) - 1) };
  const all = [...(feed.data ?? []), ...(pending.data ?? []), ...(mine.data ?? [])] as unknown as Post[];
  const files = [...new Set(all.map((p) => p.attachment_path).filter(Boolean) as string[])];
  const signed = files.length ? (await supabase.storage.from("posts").createSignedUrls(files, 3600)).data ?? [] : [];
  const url = new Map(signed.map((s) => [s.path ?? "", s.signedUrl]));

  const body = (p: Post) => (
    <>
      <p className="mt-2 whitespace-pre-wrap text-body-md text-body-text">{p.body}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
        {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 font-semibold text-secondary hover:underline"><Icon name="open_in_new" className="text-[16px]" />Open link</a>}
        {p.attachment_path && url.get(p.attachment_path) && <a href={url.get(p.attachment_path) ?? undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-semibold text-secondary hover:underline"><Icon name="attach_file" className="text-[16px]" />Attachment</a>}
      </div>
    </>
  );
  const kind = (k: string) => <Badge tone={k === "service" ? "blue" : "purple"}>{k === "service" ? "Service update" : "Platform update"}</Badge>;

  return (
    <>
      <PageHeader eyebrow="Community" title="Team Updates"
        description={isSuper ? "Updates shared by members and administrators wait in your review inbox. Edit and publish them to everyone." : "News for the whole team. Have something useful? Share an update and the Super Admin will publish it to everyone."} />
      <Tabs active={tab} items={tabs.map((t) => ({ ...t, label: t.key === "inbox" && (pending.data ?? []).length ? `${t.label} (${(pending.data ?? []).length})` : t.label, href: `/updates?tab=${t.key}` }))} />

      {tab === "feed" && ((feed.data ?? []).length === 0 ? <Card><EmptyState icon="campaign" title="No updates yet">Published updates appear here.</EmptyState></Card> : (
        <div className="space-y-3">
          {(feed.data as unknown as Post[]).map((p) => (
            <Card key={p.id} className={cn("p-5", sp.id === p.id && "ring-2 ring-secondary")}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2">{kind(p.kind)}{p.audience === "admins" && <Badge tone="neutral">Administrators</Badge>}</div>
                <span className="text-body-sm text-muted-text">{timeAgo(p.published_at!)}</span></div>
              <h3 className="mt-2 font-heading text-heading-md text-ink">{p.title}</h3>
              {body(p)}
              <p className="mt-3 border-t border-border-subtle pt-2 text-body-sm text-muted-text">Shared by <strong className="text-ink">{p.author?.full_name}</strong> · published by the Super Admin</p>
            </Card>
          ))}
        </div>
      ))}

      {tab === "share" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="p-5"><ShareUpdateForm /></Card>
          <Card className="p-5">
            <h3 className="font-heading text-heading-md text-ink">Your updates</h3>
            {(mine.data ?? []).length === 0 ? <p className="mt-3 text-body-md text-muted-text">You haven&apos;t shared any yet.</p> : (
              <ul className="mt-3 space-y-2">
                {(mine.data as unknown as Post[]).map((p) => (
                  <li key={p.id} className="rounded-lg bg-surface-alt/60 px-3 py-2">
                    <div className="flex items-start justify-between gap-2"><span className="text-body-md text-ink">{p.title}</span>
                      <Badge tone={p.status === "published" ? "green" : p.status === "pending" ? "amber" : "neutral"}>{p.status === "pending" ? "Waiting for review" : p.status === "published" ? "Published" : "Not published"}</Badge></div>
                    {p.review_note && <p className="mt-1 text-body-sm text-muted-text">Note: {p.review_note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "inbox" && ((pending.data ?? []).length === 0 ? <Card><EmptyState icon="inbox" title="Nothing to review">Updates shared by members and administrators will appear here.</EmptyState></Card> : (
        <div className="space-y-3">
          {(pending.data as unknown as Post[]).map((p) => (
            <Card key={p.id} className="border-l-4 border-l-accent-amber p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">{kind(p.kind)}<span className="text-body-sm text-muted-text">from <strong className="text-ink">{p.author?.full_name}</strong> · {timeAgo(p.created_at)}</span></div>
              <h3 className="mt-2 font-heading text-heading-md text-ink">{p.title}</h3>
              {body(p)}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                <ModalButton label="Review & publish" title="Publish this update" icon="campaign" variant="secondary" size="sm" wide><PublishForm u={p} counts={counts} /></ModalButton>
                <ModalButton label="Don't publish" title="Don't publish" icon="block" variant="ghost" size="sm"><DeclineForm id={p.id} /></ModalButton>
              </div>
            </Card>
          ))}
        </div>
      ))}
    </>
  );
}
