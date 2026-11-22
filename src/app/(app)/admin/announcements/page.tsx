import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AnnouncementForm } from "@/components/governance/Forms";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const me = await requireUser(["administrator", "super_admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("announcements").select("*, author:profiles!announcements_author_id_fkey(full_name)").order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <PageHeader eyebrow="Governance" title="Announcements" description={me.role === "super_admin" ? "Message the whole organisation or only the members assigned to you." : "Send announcements to your assigned team. Members receive them in-app and by e-mail per their preferences."} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="h-fit p-5"><CardHeader icon="campaign" title="New announcement" /><div className="mt-4"><AnnouncementForm canOrg={me.role === "super_admin"} /></div></Card>
        <Card className="p-5">
          <CardHeader icon="history" title="Sent announcements" />
          <ul className="mt-4 space-y-3">
            {(data ?? []).length === 0 && <EmptyState icon="campaign" title="No announcements yet" />}
            {(data ?? []).map((a) => (
              <li key={a.id} className="rounded-xl border border-border-subtle p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-heading text-body-lg text-ink">{a.title}</span><Badge tone={a.scope === "organisation" ? "purple" : "blue"}>{a.scope}</Badge><Badge>{a.recipients} recipients</Badge></div>
                <p className="mt-1 whitespace-pre-line text-body-md text-muted-text">{a.body}</p>
                <p className="mt-1 text-[11px] text-faint-text">{(a.author as unknown as { full_name: string }).full_name} · {fmtDateTime(a.created_at)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
