import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { KIND, fmtDeadline, type ChecklistKind } from "@/lib/checklists";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireUser();
  const raw = ((await searchParams).q ?? "").trim().slice(0, 80);
  const term = raw.replace(/[%_,()]/g, "");
  const supabase = await createClient();
  const like = `%${term}%`;
  const [lists, items, people] = term.length < 2 ? [null, null, null] : await Promise.all([
    supabase.from("checklists").select("id,title,kind,deadline,status,score").eq("owner_id", me.id).ilike("title", like).order("deadline", { ascending: false }).limit(15),
    supabase.from("checklist_items").select("id,title,progress,checklist:checklists!inner(title,kind,deadline,status)").eq("owner_id", me.id).ilike("title", like).limit(15),
    me.role !== "team_member" ? supabase.from("profiles").select("id,full_name,job_title,role").neq("id", me.id).or(`full_name.ilike.${like},email.ilike.${like}`).limit(15) : Promise.resolve({ data: [] }),
  ]);
  const total = (lists?.data?.length ?? 0) + (items?.data?.length ?? 0) + (people?.data?.length ?? 0);
  type It = { id: string; title: string; progress: number; checklist: { title: string; kind: ChecklistKind; deadline: string; status: string } };
  return (
    <>
      <PageHeader eyebrow="Search" title={raw ? `Results for “${raw}”` : "Search"} description="Searches your checklists and their items; administrators also search the members they can access." />
      {term.length < 2 ? <EmptyState icon="search" title="Type at least two characters in the search bar" /> : total === 0 ? <EmptyState icon="search_off" title="No matches" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(people?.data?.length ?? 0) > 0 && <Card className="p-5"><CardHeader icon="group" title="People" /><ul className="mt-3 space-y-1">{people!.data!.map((p) => <li key={p.id}><Link href={p.role === "team_member" ? `/team/${p.id}` : "/super-admin/administrators"} className="flex justify-between rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{p.full_name}</span><span className="text-body-sm text-muted-text">{p.job_title}</span></Link></li>)}</ul></Card>}
          {(lists?.data?.length ?? 0) > 0 && <Card className="p-5"><CardHeader icon="checklist" title="Checklists" /><ul className="mt-3 space-y-1">{lists!.data!.map((c) => <li key={c.id}><Link href={KIND[c.kind as ChecklistKind].path} className="flex justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{c.title}</span><span className="flex shrink-0 gap-2 text-body-sm text-muted-text">{fmtDeadline(c.deadline)}<Badge tone={c.status === "open" ? "purple" : "neutral"}>{c.status === "open" ? "open" : `${Number(c.score ?? 0)}%`}</Badge></span></Link></li>)}</ul></Card>}
          {(items?.data?.length ?? 0) > 0 && <Card className="p-5"><CardHeader icon="list" title="Items" /><ul className="mt-3 space-y-1">{(items!.data as unknown as It[]).map((i) => <li key={i.id}><Link href={KIND[i.checklist.kind].path} className="flex justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-alt"><span className="text-ink">{i.title}<span className="block text-body-sm text-muted-text">in {i.checklist.title}</span></span><Badge tone={Number(i.progress) >= 100 ? "green" : "purple"}>{Math.round(Number(i.progress))}%</Badge></Link></li>)}</ul></Card>}
        </div>
      )}
    </>
  );
}
