import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { PerformanceView } from "@/components/performance/PerformanceView";
import { ProfileView } from "@/components/profile/ProfileView";
import { ChecklistCard } from "@/components/checklists/ChecklistCard";
import { loadChecklists } from "@/server/checklists";
import { ActiveToggle, CorrectionButton, MakeAdminButton, RemoveMemberButton, TransferButton } from "@/components/governance/Forms";
import { CONSEQUENCE_ICON, consequenceText } from "@/lib/labels";
import { fmtDate, pct } from "@/lib/format";

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
    const { open, closed } = await loadChecklists({ ownerId: id, closedSinceDays: 14 });
    body = (
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 font-heading text-heading-md text-ink">Open checklists <span className="text-body-md font-normal text-muted-text">· read-only</span></h2>
          {open.length === 0 ? <Card><EmptyState icon="event_busy" title="No open checklists" /></Card>
            : <div className="grid gap-4 xl:grid-cols-2">{open.map((c) => <ChecklistCard key={c.id} checklist={c} editable={false} spinFor={false} />)}</div>}
        </section>
        <section>
          <h2 className="mb-3 font-heading text-heading-md text-ink">Graded <span className="text-body-md font-normal text-muted-text">· last 14 days</span></h2>
          {closed.length === 0 ? <Card><EmptyState icon="history" title="Nothing graded in the last 14 days" /></Card>
            : <div className="grid gap-4 xl:grid-cols-2">{closed.map((c) => <ChecklistCard key={c.id} checklist={c} editable={false} spinFor={false} />)}</div>}
        </section>
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
        { key: "work", href: `${base}?tab=work`, label: "Checklists", icon: "checklist" },
        { key: "accountability", href: `${base}?tab=accountability`, label: "Accountability", icon: "cyclone" },
        { key: "profile", href: `${base}?tab=profile`, label: "Profile & changes", icon: "badge" },
      ]} />
      {body}
    </>
  );
}
