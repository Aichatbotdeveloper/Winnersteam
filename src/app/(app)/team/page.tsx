import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { TeamTable, type TeamRow } from "@/components/team/TeamTable";

export const metadata: Metadata = { title: "Team Members" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ q?: string; period?: string }> }) {
  const me = await requireUser(["administrator", "super_admin"]);
  const sp = await searchParams;
  const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "weekly") as "daily" | "weekly" | "monthly";
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_performance", { p_type: period });
  const q = (sp.q ?? "").toLowerCase();
  const rows = ((data ?? []) as TeamRow[]).filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.job_title ?? "").toLowerCase().includes(q));
  return (
    <>
      <PageHeader eyebrow={me.role === "super_admin" ? "All active team members" : "Your assigned team"} title="Team Members"
        description="Open a member to view their profile, tasks, goals, prospecting, performance history and accountability." />
      <Card className="mb-4 p-3">
        <form className="flex flex-wrap gap-2" action="/team">
          <input name="q" defaultValue={sp.q} placeholder="Search by name or job title" className="input max-w-sm" />
          <select name="period" defaultValue={period} className="input w-auto"><option value="daily">Today</option><option value="weekly">This week</option><option value="monthly">This month</option></select>
          <button className="rounded-lg bg-primary px-3 text-label-md text-on-primary">Apply</button>
        </form>
      </Card>
      <Card className="overflow-hidden"><TeamTable rows={rows} showAdmin={me.role === "super_admin"} /></Card>
    </>
  );
}
