import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, Icon, PageHeader, Progress, Tabs } from "@/components/ui";
import { PerformanceView } from "@/components/performance/PerformanceView";
import { ProfileView } from "@/components/profile/ProfileView";
import { TaskList, type TaskItem } from "@/components/tasks/TaskList";
import { ActiveToggle, CorrectionButton, MakeAdminButton, RemoveMemberButton, TransferButton } from "@/components/governance/Forms";
import { CONSEQUENCE_ICON, PROSPECTING_LABEL, consequenceText } from "@/lib/labels";
import { addDays, fmtDate, nowTimeInOrg, num, pct, todayInOrg, weekStart, monthStart } from "@/lib/format";

export const metadata: Metadata = { title: "Team member" };

export default async function MemberDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; period?: string }> }) {
  const me = await requireUser(["administrator", "super_admin"]);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  // RLS: administrators only see currently assigned members; others → 404.
  const { data: member } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!member) notFound();
  const tab = ["performance", "work", "accountability", "profile"].includes(sp.tab ?? "") ? sp.tab! : "performance";
  const today = todayInOrg();
  const base = `/team/${id}`;
  const isSuper = me.role === "super_admin";
  const [assignment, admins] = await Promise.all([
    supabase.from("admin_assignments").select("administrator_id, administrator:profiles!admin_assignments_administrator_id_fkey(full_name), started_at").eq("member_id", id).is("ended_at", null).maybeSingle(),
    isSuper ? supabase.rpc("list_administrators") : Promise.resolve({ data: [] }),
  ]);
  const adminName = (assignment.data?.administrator as unknown as { full_name: string } | null)?.full_name;

  let body: React.ReactNode = null;
  if (tab === "performance") {
    const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "weekly") as "daily" | "weekly" | "monthly";
    body = <PerformanceView userId={id} period={period} basePath={`${base}?tab=performance`} />;
  } else if (tab === "work") {
    const [tasks, wg, mg, tgt, act] = await Promise.all([
      supabase.from("tasks").select("*, category:task_categories(name,color)").eq("owner_id", id).is("deleted_at", null).gte("due_date", addDays(today, -6)).lte("due_date", today).order("due_date", { ascending: false }),
      supabase.from("weekly_goals").select("*").eq("owner_id", id).eq("week_start", weekStart(today)).is("deleted_at", null),
      supabase.from("monthly_goals").select("*").eq("owner_id", id).eq("month_start", monthStart(today)).is("deleted_at", null),
      supabase.from("prospecting_targets").select("activity,target").eq("owner_id", id).eq("period", "daily").eq("period_start", today),
      supabase.from("prospecting_activities").select("activity,quantity").eq("owner_id", id).eq("occurred_on", today),
    ]);
    const all = (tasks.data ?? []) as unknown as TaskItem[];
    const todays = all.filter((t) => t.due_date === today);
    const outstanding = all.filter((t) => t.status !== "completed");
    const actual = new Map<string, number>();
    for (const a of act.data ?? []) actual.set(a.activity, (actual.get(a.activity) ?? 0) + a.quantity);
    body = (
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 lg:col-span-2">
          <CardHeader icon="checklist" title={`Today's tasks (${todays.filter((t) => t.status === "completed").length}/${todays.length} done)`} eyebrow="Read-only monitoring" />
          <div className="mt-3"><TaskList tasks={todays} today={today} categories={[]} readOnly nowTime={nowTimeInOrg()} empty={<EmptyState icon="event_busy" title="No tasks planned today" />} /></div>
          <p className="mt-3 text-body-sm text-muted-text">{outstanding.length} incomplete task(s) in the last 7 days.</p>
        </Card>
        {[["Weekly goals", wg.data ?? []], ["Monthly goals", mg.data ?? []]].map(([title, goals]) => (
          <Card key={title as string} className="p-5">
            <CardHeader icon="flag" title={title as string} />
            <div className="mt-3 space-y-3">
              {(goals as { id: string; title: string; target: number; achieved: number; unit: string }[]).length === 0 && <p className="text-body-md text-muted-text">No goals set.</p>}
              {(goals as { id: string; title: string; target: number; achieved: number; unit: string }[]).map((g) => (
                <div key={g.id}><div className="flex justify-between text-body-md"><span className="text-ink">{g.title}</span><span>{num(g.achieved)}/{num(g.target)} {g.unit}</span></div>
                  <Progress value={(g.achieved / g.target) * 100} className="mt-1" /></div>
              ))}
            </div>
          </Card>
        ))}
        <Card className="p-5 lg:col-span-2">
          <CardHeader icon="contact_page" title="Prospecting today" />
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(tgt.data ?? []).length === 0 && <p className="text-body-md text-muted-text">No prospecting targets set for today.</p>}
            {(tgt.data ?? []).map((t) => (
              <div key={t.activity} className="rounded-lg bg-surface-alt px-3 py-2"><div className="text-body-sm text-muted-text">{PROSPECTING_LABEL[t.activity]}</div>
                <div className="font-heading text-heading-md text-ink">{actual.get(t.activity) ?? 0}<span className="text-body-sm text-faint-text">/{t.target}</span></div></div>
            ))}
          </div>
        </Card>
      </div>
    );
  } else if (tab === "accountability") {
    const { data: led } = await supabase.from("accountability_ledger").select("*, event:accountability_events(period_type,period_start,performance_pct,level)").eq("user_id", id).order("assigned_at", { ascending: false }).limit(50);
    body = (
      <Card className="p-5">
        <CardHeader icon="cyclone" title="Accountability history" eyebrow={member.physical_accommodation ? "Physical accommodation: ACTIVE" : undefined} />
        <ul className="mt-4 space-y-2">
          {(led ?? []).length === 0 && <EmptyState icon="verified" title="No accountability outcomes" />}
          {(led ?? []).map((l) => {
            const e = l.event as unknown as { period_type: string; period_start: string; performance_pct: number; level: string };
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle px-3 py-2.5 text-body-md">
                <Icon name={CONSEQUENCE_ICON[l.category]} className="text-secondary" />
                <span className="flex-1 text-ink">{consequenceText(l.category, l.quantity)}</span>
                <span className="text-body-sm text-muted-text">{e.period_type} {fmtDate(e.period_start)} · {pct(e.performance_pct)} · {e.level}</span>
                <Badge tone={l.status === "completed" ? "green" : "amber"}>{l.status.replace("_", " ")}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  } else {
    body = <ProfileView profile={member} editable={false} />;
  }

  return (
    <>
      <PageHeader eyebrow={<Link href="/team" className="hover:underline">← Team members</Link>} title={member.full_name}
        description={<>{member.job_title ?? "Team Member"} · Administrator: <strong className="text-ink">{adminName ?? "Unassigned"}</strong>{assignment.data?.started_at ? ` since ${fmtDate(assignment.data.started_at)}` : ""}</>}
        actions={member.role === "team_member" ? <>
          {isSuper && member.status === "approved" && <TransferButton memberId={id} name={member.full_name} admins={(admins.data ?? []) as never} currentAdmin={assignment.data?.administrator_id} />}
          {isSuper && <CorrectionButton userId={id} />}
          {isSuper && member.status === "approved" && <MakeAdminButton userId={id} name={member.full_name} />}
          {isSuper && ["approved", "deactivated", "removed"].includes(member.status) && <ActiveToggle userId={id} active={member.status === "approved"} name={member.full_name} />}
          {member.status !== "removed" && <RemoveMemberButton memberId={id} name={member.full_name} />}
        </> : undefined} />
      {member.status !== "approved" && <p className="mb-4 rounded-lg bg-accent-amber/10 px-3 py-2 text-body-md text-warning-text">Account status: {member.status}{member.status_reason ? ` — ${member.status_reason}` : ""}</p>}
      <Tabs active={tab} items={[
        { key: "performance", href: `${base}?tab=performance`, label: "Performance", icon: "monitoring" },
        { key: "work", href: `${base}?tab=work`, label: "Tasks & goals", icon: "checklist" },
        { key: "accountability", href: `${base}?tab=accountability`, label: "Accountability", icon: "cyclone" },
        { key: "profile", href: `${base}?tab=profile`, label: "Profile & changes", icon: "badge" },
      ]} />
      {body}
    </>
  );
}
