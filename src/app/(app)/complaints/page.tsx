import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import { ComplaintForm, StatusBadge } from "@/components/posts/ComplaintForms";
import { COMPLAINT_CATEGORY } from "@/lib/complaints";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Lodge a complaint" };

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const me = await requireUser();
  if (me.role === "super_admin") redirect("/super-admin/complaints");
  const { code } = await searchParams;
  const supabase = await createClient();
  const [mine, found] = await Promise.all([
    supabase.rpc("my_complaints"),
    code ? supabase.rpc("complaint_status", { p_code: code.slice(0, 20) }) : Promise.resolve({ data: null }),
  ]);
  const look = (found.data ?? [])[0] as { category: string; status: string; reply: string | null; replied_at: string | null; lodged: string } | undefined;

  return (
    <>
      <PageHeader eyebrow="Speak up safely" title="Lodge a complaint"
        description="If something is wrong, unfair or being manipulated, tell the Super Admin. Only the Super Admin can read complaints, and you can stay anonymous." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5"><ComplaintForm /></Card>
        <div className="space-y-5">
          <Card className="p-5">
            <CardHeader icon="key" title="Check with your code" />
            <form className="mt-3 flex gap-2" action="/complaints">
              <input name="code" defaultValue={code ?? ""} placeholder="WT-XXXX-XXXX" maxLength={20} className="input font-mono uppercase" aria-label="Reference code" />
              <button className="rounded-lg bg-secondary px-3 text-label-md text-on-secondary">Check</button>
            </form>
            {code && (look ? (
              <div className="mt-3 rounded-lg bg-surface-alt/60 p-3 text-body-md">
                <div className="flex items-center justify-between"><span className="text-ink">{COMPLAINT_CATEGORY[look.category]}</span><StatusBadge s={look.status} /></div>
                <div className="text-body-sm text-muted-text">Lodged {fmtDate(look.lodged)}</div>
                {look.reply ? <p className="mt-2 rounded-lg bg-surface p-2 text-ink"><span className="block text-label-sm uppercase text-secondary">Reply from the Super Admin</span>{look.reply}</p>
                  : <p className="mt-2 text-body-sm text-muted-text">No reply yet.</p>}
              </div>
            ) : <p className="mt-3 text-body-sm text-accent-red">No complaint matches that code.</p>)}
          </Card>
          {(mine.data ?? []).length > 0 && (
            <Card className="p-5">
              <CardHeader icon="history" title="Your complaints" eyebrow="Ones you sent with your name" />
              <ul className="mt-3 space-y-2">
                {(mine.data as { id: string; category: string; status: string; reply: string | null; created_at: string }[]).map((c) => (
                  <li key={c.id} className="rounded-lg bg-surface-alt/60 p-3">
                    <div className="flex items-center justify-between gap-2"><span className="text-body-md text-ink">{COMPLAINT_CATEGORY[c.category]}</span><StatusBadge s={c.status} /></div>
                    <div className="text-body-sm text-muted-text">{fmtDate(c.created_at)}</div>
                    {c.reply && <p className="mt-2 rounded-lg bg-surface p-2 text-body-md text-ink"><span className="block text-label-sm uppercase text-secondary">Reply</span>{c.reply}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="flex gap-1.5 text-body-sm text-muted-text"><Icon name="info" className="text-[16px]" />Anonymous complaints don&apos;t appear here, because they aren&apos;t linked to your account. Use your code.</p>
        </div>
      </div>
    </>
  );
}
