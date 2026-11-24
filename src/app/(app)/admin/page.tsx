import Link from "next/link";
import { UpcomingEvents } from "@/components/posts/UpcomingEvents";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, StatTile } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { TeamTable, type TeamRow } from "@/components/team/TeamTable";
import { AnnouncementForm } from "@/components/governance/Forms";
import { CONSEQUENCE_ICON, consequenceText } from "@/lib/labels";
import { fmtDate, greeting, pct, timeAgo, todayInOrg } from "@/lib/format";

export const metadata: Metadata = { title: "Team Dashboard" };

export default async function AdminDashboard() {
  const me = await requireUser(["administrator"]);
  const supabase = await createClient();
  const today = todayInOrg();
  const [daily, weekly, quote, changes, ledger, tasksToday] = await Promise.all([
    supabase.rpc("team_performance", { p_type: "daily", p_date: today }),
    supabase.rpc("team_performance", { p_type: "weekly", p_date: today }),
    supabase.rpc("latest_quote"),
    supabase.from("profile_change_log").select("id,section,changes,created_at,profile:profiles!profile_change_log_profile_id_fkey(id,full_name)").neq("profile_id", me.id).order("created_at", { ascending: false }).limit(6),
    supabase.from("accountability_ledger").select("id,category,quantity,status,assigned_at,member:profiles!accountability_ledger_user_id_fkey(full_name)").order("assigned_at", { ascending: false }).limit(6),
    supabase.from("checklists").select("status,owner_id,deadline").eq("status", "open").neq("owner_id", me.id)
      .gte("deadline", `${today}T00:00:00+01:00`).lte("deadline", `${today}T23:59:59+01:00`),
  ]);
  const w = (weekly.data ?? []) as TeamRow[];
  const d = (daily.data ?? []) as TeamRow[];
  const avg = (rows: TeamRow[]) => { const s = rows.map((r) => r.overall).filter((v): v is number => v !== null).map(Number); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
  const outstanding = (tasksToday.data ?? []).length;
  const atRisk = w.filter((r) => r.overall !== null && Number(r.overall) < 75).sort((a, b) => Number(a.overall) - Number(b.overall));
  const q = quote.data?.[0];

  return (
    <div className="space-y-5">
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-body-sm text-muted-text"><Badge tone="purple">Administrator</Badge>{fmtDate(today, { weekday: "long", day: "numeric", month: "long" })}</div>
            <h1 className="mt-2 font-heading text-display-lg-mobile text-ink md:text-display-lg">{greeting()}, {me.full_name.split(" ")[0]}</h1>
            <p className="text-body-md text-muted-text">You manage {w.length} team member{w.length === 1 ? "" : "s"}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ModalButton label="Team announcement" title="Send an announcement to your team" icon="campaign" variant="secondary"><AnnouncementForm canOrg={false} /></ModalButton>
            <ButtonLink href="/reports" variant="outline" icon="insights">Team reports</ButtonLink>
          </div>
        </div>
        {q && <p className="mt-4 rounded-lg bg-surface-alt px-4 py-2.5 text-body-md italic text-ink">“{q.text}” <span className="not-italic text-muted-text">— {q.author}</span></p>}
      </Card>
      <UpcomingEvents />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Team size" value={w.length} icon="groups" href="/team" />
        <StatTile label="Today's team average" value={pct(avg(d))} sub="Live, all checklists" icon="today" tone="blue" />
        <StatTile label="This week's team score" value={pct(avg(w))} icon="date_range" tone="green" />
        <StatTile label="Open checklists due today" value={outstanding} sub="Across your team" icon="pending_actions" tone="amber" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <div className="p-5 pb-3"><CardHeader icon="monitoring" title="Assigned-member performance" eyebrow="This week · live" action={<Link href="/team" className="text-body-sm font-semibold text-secondary">All members →</Link>} /></div>
          <TeamTable rows={w} limit={12} />
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <CardHeader icon="warning" title="Needs attention" eyebrow="Below 75% this week" />
            <ul className="mt-3 space-y-2">
              {atRisk.length === 0 && <li className="text-body-md text-muted-text">Everyone is on track. 🎉</li>}
              {atRisk.slice(0, 6).map((r) => (
                <li key={r.user_id}><Link href={`/team/${r.user_id}`} className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 hover:bg-surface-container-low">
                  <span className="text-body-md text-ink">{r.full_name}</span><Badge tone={Number(r.overall) < 50 ? "red" : "amber"}>{pct(r.overall)}</Badge></Link></li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <CardHeader icon="badge" title="Profile updates" eyebrow="Assigned members" />
            <ul className="mt-3 space-y-2.5">
              {(changes.data ?? []).length === 0 && <li className="text-body-md text-muted-text">No recent profile changes.</li>}
              {(changes.data ?? []).map((c) => {
                const p = c.profile as unknown as { id: string; full_name: string };
                return <li key={c.id} className="text-body-sm"><Link href={`/team/${p.id}`} className="font-semibold text-ink hover:underline">{p.full_name}</Link> <span className="text-muted-text">updated {c.section} · {timeAgo(c.created_at)}</span></li>;
              })}
            </ul>
          </Card>
          <Card className="p-5">
            <CardHeader icon="cyclone" title="Accountability outcomes" action={<Link href="/accountability" className="text-body-sm font-semibold text-secondary">Ledger →</Link>} />
            <ul className="mt-3 space-y-2">
              {(ledger.data ?? []).length === 0 && <EmptyState icon="verified" title="No outcomes yet" />}
              {(ledger.data ?? []).map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-body-sm">
                  <Icon name={CONSEQUENCE_ICON[l.category]} className="text-[18px] text-secondary" />
                  <span className="min-w-0 flex-1 truncate"><span className="text-ink">{(l.member as unknown as { full_name: string }).full_name}</span> · {consequenceText(l.category, l.quantity)}</span>
                  <Badge tone={l.status === "completed" ? "green" : "amber"}>{l.status.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
