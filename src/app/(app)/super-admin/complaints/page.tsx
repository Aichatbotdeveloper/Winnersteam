import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, Icon, PageHeader, StatTile, cn } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { ManageComplaintForm, StatusBadge } from "@/components/posts/ComplaintForms";
import { COMPLAINT_CATEGORY } from "@/lib/complaints";
import { fmtDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Complaints" };

export default async function ComplaintsAdmin({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser(["super_admin"]);
  const sp = await searchParams;
  const status = ["new", "reviewing", "resolved"].includes(sp.status ?? "") ? sp.status! : "";
  const supabase = await createClient();
  let q = supabase.from("complaints").select("id,created_at,anonymous,category,body,attachment_path,status,private_notes,reply,replied_at,sender:profiles(full_name,role)").order("created_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const [list, all] = await Promise.all([q, supabase.from("complaints").select("status,anonymous")]);
  const rows = all.data ?? [];
  const items = (list.data ?? []) as unknown as { id: string; created_at: string; anonymous: boolean; category: string; body: string; attachment_path: string | null; status: string;
    private_notes: string | null; reply: string | null; replied_at: string | null; sender: { full_name: string; role: string } | null }[];
  const files = items.map((c) => c.attachment_path).filter(Boolean) as string[];
  const signed = files.length ? (await supabase.storage.from("complaint-files").createSignedUrls(files, 3600)).data ?? [] : [];
  const url = new Map(signed.map((s) => [s.path ?? "", s.signedUrl]));

  return (
    <>
      <PageHeader eyebrow="Private to the Super Admin" title="Complaints"
        description="Complaints lodged by members and administrators. Nobody else can see this page or these records." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="New" value={rows.filter((r) => r.status === "new").length} icon="report" tone="amber" />
        <StatTile label="Under review" value={rows.filter((r) => r.status === "reviewing").length} icon="manage_search" tone="blue" />
        <StatTile label="Resolved" value={rows.filter((r) => r.status === "resolved").length} icon="task_alt" tone="green" />
        <StatTile label="Anonymous" value={rows.filter((r) => r.anonymous).length} icon="visibility_off" tone="neutral" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-body-sm">
        {[["", "All"], ["new", "New"], ["reviewing", "Under review"], ["resolved", "Resolved"]].map(([k, l]) => (
          <Link key={k} href={k ? `/super-admin/complaints?status=${k}` : "/super-admin/complaints"} className={cn("rounded-lg px-3 py-1.5", status === k ? "bg-secondary font-semibold text-on-secondary" : "bg-surface text-muted-text hover:text-ink")}>{l}</Link>
        ))}
      </div>
      {items.length === 0 ? <Card><EmptyState icon="verified_user" title="No complaints here">Complaints appear here as soon as they are lodged.</EmptyState></Card> : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c.id} className={cn("p-5", c.status === "new" && "border-l-4 border-l-accent-amber")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2"><Badge tone="purple">{COMPLAINT_CATEGORY[c.category]}</Badge><StatusBadge s={c.status} />
                  {c.anonymous ? <Badge tone="neutral"><Icon name="visibility_off" className="text-[14px]" />Anonymous</Badge>
                    : <Badge tone="blue">{c.sender?.full_name} · {c.sender?.role === "administrator" ? "Administrator" : "Member"}</Badge>}</div>
                <span className="text-body-sm text-muted-text" title={fmtDateTime(c.created_at)}>{c.anonymous ? `around ${fmtDateTime(c.created_at)}` : timeAgo(c.created_at)}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-body-lg text-ink">{c.body}</p>
              {c.attachment_path && url.get(c.attachment_path) && <a href={url.get(c.attachment_path) ?? undefined} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-body-sm font-semibold text-secondary hover:underline"><Icon name="attach_file" className="text-[16px]" />Evidence</a>}
              {(c.private_notes || c.reply) && (
                <div className="mt-3 grid gap-2 border-t border-border-subtle pt-3 text-body-md sm:grid-cols-2">
                  {c.private_notes && <p><span className="block text-label-sm uppercase text-muted-text">Your private notes</span>{c.private_notes}</p>}
                  {c.reply && <p><span className="block text-label-sm uppercase text-secondary">Your reply</span>{c.reply}</p>}
                </div>
              )}
              <div className="mt-3 flex justify-end"><ModalButton label="Update" title="Update complaint" icon="edit" variant="outline" size="sm"><ManageComplaintForm c={c} /></ModalButton></div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
