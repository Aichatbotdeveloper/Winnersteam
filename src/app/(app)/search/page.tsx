import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireUser();
  const raw = ((await searchParams).q ?? "").trim().slice(0, 80);
  const term = raw.replace(/[%_,()]/g, "");
  const supabase = await createClient();
  const like = `%${term}%`;
  const [tasks, wg, mg, people] = term.length < 2 ? [null, null, null, null] : await Promise.all([
    supabase.from("tasks").select("id,title,due_date,status,kind,owner_id").eq("owner_id", me.id).is("deleted_at", null).ilike("title", like).order("due_date", { ascending: false }).limit(15),
    supabase.from("weekly_goals").select("id,title,week_start").eq("owner_id", me.id).is("deleted_at", null).ilike("title", like).limit(10),
    supabase.from("monthly_goals").select("id,title,month_start").eq("owner_id", me.id).is("deleted_at", null).ilike("title", like).limit(10),
    me.role !== "team_member" ? supabase.from("profiles").select("id,full_name,job_title,role").neq("id", me.id).or(`full_name.ilike.${like},email.ilike.${like}`).limit(15) : Promise.resolve({ data: [] }),
  ]);
  const total = (tasks?.data?.length ?? 0) + (wg?.data?.length ?? 0) + (mg?.data?.length ?? 0) + (people?.data?.length ?? 0);
  return (
    <>
      <PageHeader eyebrow="Search" title={raw ? `Results for “${raw}”` : "Search"} description="Searches your tasks and goals; administrators also search the members they can access." />
      {term.length < 2 ? <EmptyState icon="search" title="Type at least two characters in the search bar" /> : total === 0 ? <EmptyState icon="search_off" title="No matches" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(people?.data?.length ?? 0) > 0 && <Card className="p-5"><CardHeader icon="group" title="People" /><ul className="mt-3 space-y-1">{people!.data!.map((p) => <li key={p.id}><Link href={p.role === "team_member" ? `/team/${p.id}` : "/super-admin/administrators"} className="flex justify-between rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{p.full_name}</span><span className="text-body-sm text-muted-text">{p.job_title}</span></Link></li>)}</ul></Card>}
          {(tasks?.data?.length ?? 0) > 0 && <Card className="p-5"><CardHeader icon="checklist" title="Tasks" /><ul className="mt-3 space-y-1">{tasks!.data!.map((t) => <li key={t.id}><Link href={t.kind === "daily" ? "/tasks?filter=history" : "/additional-tasks?filter=history"} className="flex justify-between rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{t.title}</span><span className="flex gap-2 text-body-sm text-muted-text">{fmtDate(t.due_date)}<Badge tone={t.status === "completed" ? "green" : "amber"}>{t.status}</Badge></span></Link></li>)}</ul></Card>}
          {((wg?.data?.length ?? 0) + (mg?.data?.length ?? 0)) > 0 && <Card className="p-5"><CardHeader icon="flag" title="Goals" /><ul className="mt-3 space-y-1">
            {wg!.data!.map((g) => <li key={g.id}><Link href="/weekly-goals" className="flex justify-between rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{g.title}</span><span className="text-body-sm text-muted-text">week of {fmtDate(g.week_start)}</span></Link></li>)}
            {mg!.data!.map((g) => <li key={g.id}><Link href="/monthly-goals" className="flex justify-between rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{g.title}</span><span className="text-body-sm text-muted-text">{fmtDate(g.month_start, { month: "long", year: "numeric" })}</span></Link></li>)}
          </ul></Card>}
        </div>
      )}
    </>
  );
}
