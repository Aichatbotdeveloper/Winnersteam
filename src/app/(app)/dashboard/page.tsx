import Link from "next/link";
import { UpcomingEvents } from "@/components/posts/UpcomingEvents";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPerformance } from "@/server/queries";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, Progress, cn } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { CategoryGrid, CompositeCard } from "@/components/performance/Breakdown";
import { ChecklistCard } from "@/components/checklists/ChecklistCard";
import { NewChecklistForm } from "@/components/checklists/NewChecklistForm";
import { checklistLabel, defaultDeadline, fmtDeadline, type ChecklistKind } from "@/lib/checklists";
import { loadChecklists, syncMyChecklists } from "@/server/checklists";
import { LexIcon } from "@/components/brand/Logo";
import { CONSEQUENCE_ICON, consequenceText } from "@/lib/labels";
import { fmtDate, greeting, pct, todayInOrg } from "@/lib/format";
import { avatarUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Dashboard" };

export default async function MemberDashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const me = await requireUser();
  if (me.role !== "team_member") redirect(homeFor(me.role));
  const sp = await searchParams;
  const period = (["daily", "weekly", "monthly"].includes(sp.period ?? "") ? sp.period : "weekly") as "daily" | "weekly" | "monthly";
  const today = todayInOrg();
  const supabase = await createClient();
  await syncMyChecklists();

  const [perf, admin, lists, quote, services, reading, update, openEvent, recentLedger, streakSnaps] = await Promise.all([
    getPerformance(me.id, period),
    supabase.rpc("my_administrator"),
    loadChecklists({ ownerId: me.id, openOnly: true }),
    supabase.rpc("latest_quote"),
    supabase.from("profile_services").select("name").eq("profile_id", me.id).order("position"),
    supabase.from("reading_progress").select("progress_pct,status,book:books(title,author)").eq("user_id", me.id).eq("status", "reading").order("updated_at", { ascending: false }).limit(1),
    supabase.from("user_service_updates").select("reason,update:service_updates(title,url,published_at,ai_summary,excerpt)").eq("user_id", me.id).order("delivered_at", { ascending: false }).limit(1),
    supabase.from("accountability_events").select("id,period_type,performance_pct,level,auto_draw_at,checklist:checklists(title,kind),accountability_ledger(id)").eq("user_id", me.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("accountability_ledger").select("category,quantity,status").eq("user_id", me.id).neq("status", "completed").order("assigned_at", { ascending: false }).limit(1),
    supabase.from("performance_snapshots").select("period_start,overall_score").eq("user_id", me.id).eq("period_type", "daily").eq("is_current", true).order("period_start", { ascending: false }).limit(60),
  ]);

  const open = lists.open;
  const dueToday = open.filter((c) => todayInOrg(new Date(c.deadline)) === today).length;
  type Ev = { id: string; period_type: string; performance_pct: number; auto_draw_at: string | null; checklist: { title: string; kind: ChecklistKind } | null; accountability_ledger: unknown };
  const pendingSpins = ((openEvent.data ?? []) as unknown as Ev[]).filter((e) => !e.accountability_ledger || (Array.isArray(e.accountability_ledger) && !e.accountability_ledger.length))
    .sort((a, b) => (a.checklist ? 0 : 1) - (b.checklist ? 0 : 1) || String(a.auto_draw_at ?? "").localeCompare(String(b.auto_draw_at ?? "")));
  const pendingSpin = pendingSpins[0];
  const spinText = (e: Ev) => e.checklist ? `Your ${checklistLabel(e.checklist.title, e.checklist.kind)} scored ${Number(e.performance_pct)}%. Spin the wheel` : `Your ${e.period_type} score was ${pct(e.performance_pct)}. Spin the wheel`;
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
              <div className="eyebrow !text-secondary">Open checklists</div>
              <div className="font-heading text-heading-md text-ink">{open.length} <span className="text-body-sm font-normal text-muted-text">· {dueToday} due today</span></div>
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

      {pendingSpins.length > 0 && (
        <section className="space-y-2" aria-label="Spins waiting">
          {pendingSpins.map((e) => (
            <div key={e.id} className="flex flex-col gap-3 rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Icon name="casino" className="mt-0.5 text-[24px] text-accent-amber" />
                <div>
                  <div className="font-heading text-body-lg text-ink">{spinText(e)}</div>
                  {e.auto_draw_at && <div className="text-body-sm text-muted-text">Spin by {fmtDeadline(e.auto_draw_at)}, or the system will spin for you.</div>}
                </div>
              </div>
              <ButtonLink href={`/accountability?event=${e.id}`} variant="secondary" icon="cyclone">Spin the wheel</ButtonLink>
            </div>
          ))}
        </section>
      )}

      <UpcomingEvents />

      {/* Performance */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-5"><CompositeCard perf={perf} periodLabel={period} /></Card>
        <Card className="p-5">
          <CardHeader eyebrow="By list type" title="Average per list type" action={
            <div className="flex rounded-lg bg-surface-alt p-0.5 text-body-sm">
              {(["daily", "weekly", "monthly"] as const).map((p) => (
                <Link key={p} href={`/dashboard?period=${p}`} className={cn("rounded-md px-2.5 py-1 capitalize", p === period ? "bg-surface font-semibold text-ink shadow-card" : "text-muted-text")}>{p}</Link>
              ))}
            </div>} />
          <div className="mt-4"><CategoryGrid perf={perf} /></div>
        </Card>
      </div>

      {/* Open checklists */}
      <section aria-labelledby="open-lists">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="open-lists" className="font-heading text-heading-lg text-ink">Open checklists</h2>
          <ModalButton label="New checklist" title="New to-do checklist" icon="add" size="sm"><NewChecklistForm kind="todo" defaultDeadline={defaultDeadline("todo")} /></ModalButton>
        </div>
        {open.length === 0 ? (
          <Card><EmptyState icon="playlist_add" title="No open checklists">Create a to-do checklist with a title and a deadline to start tracking your day.</EmptyState></Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {open.slice(0, 6).map((c) => <ChecklistCard key={c.id} checklist={c} editable spinFor />)}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-body-sm font-semibold text-secondary">
          <Link href="/tasks" className="hover:underline">To-do checklists →</Link>
          <Link href="/weekly-goals" className="hover:underline">Weekly goals →</Link>
          <Link href="/monthly-goals" className="hover:underline">Monthly goals →</Link>
          <Link href="/prospecting" className="hover:underline">Prospecting →</Link>
        </div>
      </section>

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
            {pendingSpin ? <strong className="text-ink">{spinText(pendingSpin)}</strong>
              : led ? <span className="flex items-center gap-2"><Icon name={CONSEQUENCE_ICON[led.category]} className="text-secondary" />{consequenceText(led.category, led.quantity)} · <Badge tone="amber">{led.status.replace("_", " ")}</Badge></span>
              : <>No open accountability items. Each checklist that scores 90% or more is clear.</>}
          </div>
          <ButtonLink href={pendingSpin ? `/accountability?event=${pendingSpin.id}` : "/accountability"} variant={pendingSpin ? "secondary" : "outline"} size="sm" icon="cyclone" className="mt-4 self-start">{pendingSpin ? "Spin the wheel" : "View accountability"}</ButtonLink>
        </Card>
      </div>

      {/* LEX banner */}
      <section className="rounded-xl bg-obsidian p-5 text-white shadow-float dark:ring-1 dark:ring-white/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <LexIcon size={40} />
            <div>
              <div className="flex items-center gap-2 font-heading text-heading-md text-white">LEX Personal Copilot <span className="rounded bg-accent px-1.5 text-[10px] font-bold text-obsidian">READY</span></div>
              <p className="text-body-sm text-faint-text">Ask how anything works — checklists, scoring, accountability or your profile.</p>
            </div>
          </div>
          <ButtonLink href="/lex" variant="secondary" icon="forum">Ask LEX</ButtonLink>
        </div>
      </section>
      <p className="text-center text-body-sm text-faint-text">Scores update live as you work. Each checklist is graded on its own at its deadline, or when you press Submit now.</p>
    </div>
  );
}
