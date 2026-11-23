import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPerformance } from "@/server/queries";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, Progress, cn } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { CategoryGrid, CompositeCard } from "@/components/performance/Breakdown";
import { TaskList, type TaskItem } from "@/components/tasks/TaskList";
import { TaskForm } from "@/components/tasks/TaskForm";
import { LexIcon } from "@/components/brand/Logo";
import { CONSEQUENCE_ICON, PROSPECTING_LABEL, consequenceText } from "@/lib/labels";
import { fmtDate, greeting, monthStart, nowTimeInOrg, num, pct, todayInOrg, weekStart } from "@/lib/format";
import { avatarUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Dashboard" };

export default async function MemberDashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const me = await requireUser();
  if (me.role !== "team_member") redirect(homeFor(me.role));
  const sp = await searchParams;
  const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "weekly") as "daily" | "weekly" | "monthly";
  const today = todayInOrg();
  const ws = weekStart(today);
  const ms = monthStart(today);
  const supabase = await createClient();

  const [perf, admin, tasks, cats, wGoals, mGoals, targets, acts, quote, services, reading, update, openEvent, recentLedger, streakSnaps] = await Promise.all([
    getPerformance(me.id, period),
    supabase.rpc("my_administrator"),
    supabase.from("tasks").select("*, category:task_categories(name,color)").eq("owner_id", me.id).eq("due_date", today).is("deleted_at", null).order("status").order("due_time", { nullsFirst: false }),
    supabase.from("task_categories").select("id,name,kind").eq("active", true).order("name"),
    supabase.from("weekly_goals").select("target,achieved").eq("owner_id", me.id).eq("week_start", ws).is("deleted_at", null),
    supabase.from("monthly_goals").select("target,achieved,unit").eq("owner_id", me.id).eq("month_start", ms).is("deleted_at", null),
    supabase.from("prospecting_targets").select("activity,target").eq("owner_id", me.id).eq("period", "daily").eq("period_start", today),
    supabase.from("prospecting_activities").select("activity,quantity").eq("owner_id", me.id).eq("occurred_on", today),
    supabase.rpc("latest_quote"),
    supabase.from("profile_services").select("name").eq("profile_id", me.id).order("position"),
    supabase.from("reading_progress").select("progress_pct,status,book:books(title,author)").eq("user_id", me.id).eq("status", "reading").order("updated_at", { ascending: false }).limit(1),
    supabase.from("user_service_updates").select("reason,update:service_updates(title,url,published_at,ai_summary,excerpt)").eq("user_id", me.id).order("delivered_at", { ascending: false }).limit(1),
    supabase.from("accountability_events").select("id,period_type,performance_pct,level,accountability_ledger(id)").eq("user_id", me.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("accountability_ledger").select("category,quantity,status").eq("user_id", me.id).neq("status", "completed").order("assigned_at", { ascending: false }).limit(1),
    supabase.from("performance_snapshots").select("period_start,overall_score").eq("user_id", me.id).eq("period_type", "daily").eq("is_current", true).order("period_start", { ascending: false }).limit(60),
  ]);

  const taskItems = (tasks.data ?? []) as unknown as TaskItem[];
  const done = taskItems.filter((t) => t.status === "completed").length;
  const tgt = new Map((targets.data ?? []).map((t) => [t.activity, t.target]));
  const actual = new Map<string, number>();
  for (const a of acts.data ?? []) actual.set(a.activity, (actual.get(a.activity) ?? 0) + a.quantity);
  const tgtTotal = [...tgt.values()].reduce((s, n) => s + n, 0);
  const actTotal = [...actual.values()].reduce((s, n) => s + n, 0);
  const avg = (rows: { target: number; achieved: number }[]) => rows.length ? rows.reduce((s, g) => s + Math.min(g.achieved / g.target, 1), 0) / rows.length * 100 : null;
  const wAvg = avg(wGoals.data ?? []); const mAvg = avg(mGoals.data ?? []);
  const pendingSpin = (openEvent.data ?? []).find((e) => !e.accountability_ledger);
  let streak = 0;
  for (const s of streakSnaps.data ?? []) { if (s.overall_score !== null && Number(s.overall_score) >= 90) streak++; else if (s.overall_score !== null) break; }
  const q = quote.data?.[0];
  const rd = reading.data?.[0] as unknown as { progress_pct: number; book: { title: string; author: string } } | undefined;
  const up = update.data?.[0] as unknown as { reason: string; update: { title: string; url: string; published_at: string | null; ai_summary: string | null; excerpt: string | null } } | undefined;
  const led = recentLedger.data?.[0];
  const myAvatar = await avatarUrl(me.avatar_path);
  const adminName = admin.data?.[0]?.full_name;

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <Card className="overflow-hidden p-5 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-text">
              <Badge tone="purple" dot>Active session</Badge>
              <span>{fmtDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
            <h1 className="mt-2 font-heading text-display-lg-mobile text-ink md:text-display-lg">{greeting()}, {me.full_name.split(" ")[0]}</h1>
            <p className="mt-1 text-body-md text-muted-text">
              {adminName ? <>Reporting to <strong className="text-ink">{adminName}</strong></> : "Awaiting administrator assignment"}
              {me.team_name ? <> · {me.team_name}</> : null}{me.job_title ? <> · {me.job_title}</> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-xl bg-accent-amber/10 px-4 py-2.5">
              <div className="eyebrow !text-warning-text">Target streak</div>
              <div className="flex items-center gap-1.5 font-heading text-heading-md text-ink"><Icon name="local_fire_department" className="text-accent-amber" />{streak}-day streak</div>
            </div>
            <div className="rounded-xl bg-surface-container-low px-4 py-2.5">
              <div className="eyebrow !text-secondary">Today&apos;s tasks</div>
              <div className="font-heading text-heading-md text-ink">{done}/{taskItems.length} <span className="text-body-sm font-normal text-muted-text">completed</span></div>
            </div>
          </div>
        </div>
        {q && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-alt/60 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="font-heading text-[28px] leading-none text-secondary">“</span>
              <div className="min-w-0">
                <p className="text-body-md italic text-ink">{q.text}</p>
                <p className="mt-0.5 text-body-sm text-muted-text">— {q.author} · <span className="uppercase text-secondary">{q.category.replace("_", " ")}</span></p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Performance */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-5"><CompositeCard perf={perf} periodLabel={period} /></Card>
        <Card className="p-5">
          <CardHeader eyebrow="Weighted breakdown" title="Active Weight Distribution" action={
            <div className="flex rounded-lg bg-surface-alt p-0.5 text-body-sm">
              {(["daily", "weekly", "monthly"] as const).map((p) => (
                <Link key={p} href={`/dashboard?period=${p}`} className={cn("rounded-md px-2.5 py-1 capitalize", p === period ? "bg-surface font-semibold text-ink shadow-card" : "text-muted-text")}>{p}</Link>
              ))}
            </div>} />
          <div className="mt-4"><CategoryGrid perf={perf} /></div>
        </Card>
      </div>

      {/* Daily tasks */}
      <Card className="p-5">
        <CardHeader icon="checklist" title={<span className="flex flex-wrap items-center gap-2">Daily Execution Sprint <Badge tone="purple">{done} Done · {taskItems.length - done} Pending</Badge></span>}
          action={<ModalButton label="Add New Task" title="New task" icon="add" size="sm"><TaskForm categories={(cats.data ?? []) as never} today={today} /></ModalButton>} />
        <p className="ml-12 mt-0.5 text-body-sm text-muted-text">Completion feeds your {perf.weights.daily_todo}% daily to-do weight.</p>
        <div className="mt-4">
          <TaskList tasks={taskItems} today={today} categories={(cats.data ?? []) as never} nowTime={nowTimeInOrg()}
            empty={<EmptyState icon="add_task" title="No tasks planned for today">Add your daily to-do list to start tracking your progress.</EmptyState>} />
        </div>
        <div className="mt-3 text-right"><Link href="/tasks" className="text-body-sm font-semibold text-secondary hover:underline">Open full task manager →</Link></div>
      </Card>

      {/* Prospecting + goals */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr_1fr]">
        <Card className="p-5">
          <CardHeader eyebrow="Outreach & acquisition" title="Prospecting Tracker" action={<Badge tone="green">Daily target: {tgtTotal}</Badge>} />
          {tgt.size === 0 ? (
            <div className="mt-4"><EmptyState icon="contact_page" title="No targets set for today" action={<ButtonLink href="/prospecting" size="sm" icon="flag">Set targets</ButtonLink>} /></div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[...tgt.entries()].map(([a, t]) => (
                  <div key={a} className="rounded-lg bg-surface-alt px-3 py-2 text-center">
                    <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-text">{PROSPECTING_LABEL[a]}</div>
                    <div className="font-heading text-[22px] font-bold text-ink">{actual.get(a) ?? 0}<span className="text-body-sm font-normal text-faint-text">/{t}</span></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 text-body-sm">
                <span className="flex items-center gap-1.5 text-muted-text"><span className="h-2 w-2 rounded-full bg-accent-blue" />{tgtTotal ? Math.round((actTotal / tgtTotal) * 100) : 0}% of daily activity goal</span>
                <Link href="/prospecting" className="font-semibold text-secondary">Log activity →</Link>
              </div>
            </>
          )}
        </Card>
        {[["Weekly Goals", wAvg, wGoals.data?.length ?? 0, "/weekly-goals", "var(--color-accent-blue)", "Week of " + fmtDate(ws, { day: "numeric", month: "short" })],
          ["Monthly Goals", mAvg, mGoals.data?.length ?? 0, "/monthly-goals", "var(--color-accent-purple)", fmtDate(ms, { month: "long", year: "numeric" })]].map(([t, v, n, href, color, sub]) => (
          <Card key={t as string} className="flex flex-col p-5">
            <div className="eyebrow">{sub as string}</div>
            <div className="mt-1 flex items-baseline justify-between">
              <h2 className="font-heading text-heading-md text-ink">{t as string}</h2>
              <span className="font-heading text-heading-md" style={{ color: color as string }}>{pct(v as number | null)}</span>
            </div>
            <p className="mt-1 text-body-sm text-muted-text">{n as number} active goal{n === 1 ? "" : "s"}</p>
            <Progress value={(v as number | null) ?? 0} color={color as string} className="mt-auto" />
            <Link href={href as string} className="mt-3 text-body-sm font-semibold text-secondary">Update progress →</Link>
          </Card>
        ))}
      </div>

      {/* Profile summary */}
      <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={me.full_name} src={myAvatar} size={56} />
          <div className="min-w-0">
            <div className="font-heading text-heading-md text-ink">{me.full_name}</div>
            <div className="text-body-md text-muted-text">{me.job_title ?? "Team Member"}{adminName ? ` · Assigned leader: ${adminName}` : ""}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-body-sm text-muted-text">Services:
              {(services.data ?? []).length === 0 ? <span>none listed yet</span> : (services.data ?? []).map((s) => <Badge key={s.name}>{s.name}</Badge>)}
            </div>
          </div>
        </div>
        <ButtonLink href="/profile" variant="outline" icon="edit">Edit unified profile</ButtonLink>
      </Card>

      {/* Growth row */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="flex flex-col p-5">
          <CardHeader eyebrow="Leadership reading" title="Currently reading" />
          {rd ? (
            <div className="mt-4 flex-1">
              <div className="font-heading text-body-lg text-ink">{rd.book.title}</div>
              <div className="text-body-sm text-muted-text">{rd.book.author}</div>
              <div className="mt-3 flex items-center gap-2"><Progress value={rd.progress_pct} color="var(--color-accent-emerald)" /><span className="text-body-sm font-semibold">{rd.progress_pct}%</span></div>
            </div>
          ) : <p className="mt-4 flex-1 text-body-md text-muted-text">You&apos;re not reading anything right now.</p>}
          <ButtonLink href="/books" variant="outline" size="sm" icon="menu_book" className="mt-4 self-start">{rd ? "Update progress" : "Browse recommendations"}</ButtonLink>
        </Card>
        <Card className="flex flex-col p-5">
          <CardHeader eyebrow="Service intelligence" title="Latest service update" />
          {up ? (
            <div className="mt-4 flex-1">
              <a href={up.update.url} target="_blank" rel="noopener noreferrer" className="font-heading text-body-lg text-ink hover:underline">{up.update.title}</a>
              <p className="mt-1 line-clamp-3 text-body-sm text-muted-text">{up.update.ai_summary ?? up.update.excerpt}</p>
              <p className="mt-2 text-[11px] text-faint-text">{up.reason}</p>
            </div>
          ) : <p className="mt-4 flex-1 text-body-md text-muted-text">No updates yet. Add services with categories to your profile to personalise this feed.</p>}
          <Link href="/service-updates" className="mt-4 text-body-sm font-semibold text-secondary">Open service updates →</Link>
        </Card>
        <Card className="flex flex-col p-5">
          <CardHeader eyebrow="Accountability protocol" title={pendingSpin ? "Spin required" : led ? "Outcome active" : "All clear"} />
          <div className="mt-4 flex-1 text-body-md text-muted-text">
            {pendingSpin ? <>Your {pendingSpin.period_type} score was <strong className="text-ink">{pct(pendingSpin.performance_pct)}</strong>. Spin the wheel to reveal your assigned outcome.</>
              : led ? <span className="flex items-center gap-2"><Icon name={CONSEQUENCE_ICON[led.category]} className="text-secondary" />{consequenceText(led.category, led.quantity)} · <Badge tone="amber">{led.status.replace("_", " ")}</Badge></span>
              : <>No open accountability items. Keep your score at 90% or above to stay clear.</>}
          </div>
          <ButtonLink href="/accountability" variant={pendingSpin ? "secondary" : "outline"} size="sm" icon="cyclone" className="mt-4 self-start">{pendingSpin ? "Spin the wheel" : "View accountability"}</ButtonLink>
        </Card>
      </div>

      {/* LEX banner */}
      <section className="rounded-xl bg-obsidian p-5 text-white shadow-float dark:ring-1 dark:ring-white/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <LexIcon size={40} />
            <div>
              <div className="flex items-center gap-2 font-heading text-heading-md text-white">LEX Personal Copilot <span className="rounded bg-accent px-1.5 text-[10px] font-bold text-obsidian">READY</span></div>
              <p className="text-body-sm text-faint-text">Ask how anything works — tasks, goals, scoring, accountability or your profile.</p>
            </div>
          </div>
          <ButtonLink href="/lex" variant="secondary" icon="forum">Ask LEX</ButtonLink>
        </div>
      </section>
      <p className="text-center text-body-sm text-faint-text">Scores update live as you work. Closed days are evaluated after midnight ({num(perf.weights.daily_todo)}/{num(perf.weights.weekly_goals)}/{num(perf.weights.prospecting)}/{num(perf.weights.monthly_goals)}/{num(perf.weights.additional_tasks)} weighting).</p>
    </div>
  );
}
