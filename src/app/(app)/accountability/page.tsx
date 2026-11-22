import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, PageHeader, Pagination, StatTile, Table, Td, Th, cn } from "@/components/ui";
import { SpinWheel } from "@/components/accountability/SpinWheel";
import { AccommodationToggle, LedgerStatusForm } from "@/components/accountability/Forms";
import { CATEGORY_LABEL, CONSEQUENCE_COLOR, CONSEQUENCE_ICON, CONSEQUENCE_LABEL, CONSEQUENCE_LIMITS, LEVEL_STYLE, consequenceText } from "@/lib/labels";
import { fmtDate, fmtDateTime, naira, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Accountability" };
const PAGE = 20;

export default async function AccountabilityPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string; category?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const isMember = me.role === "team_member";

  // Ledger (RLS scopes rows: own / assigned team / organisation)
  let lq = supabase.from("accountability_ledger")
    .select("*, event:accountability_events(period_type,period_start,performance_pct,level,triggering_category), member:profiles!accountability_ledger_user_id_fkey(full_name)", { count: "exact" })
    .order("assigned_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.status && ["assigned", "in_progress", "completed"].includes(sp.status)) lq = lq.eq("status", sp.status as "assigned");
  if (sp.category && Object.keys(CONSEQUENCE_LABEL).includes(sp.category)) lq = lq.eq("category", sp.category as "frog_jumps");

  const [ledger, settings, openEvents, accHistory, stats] = await Promise.all([
    lq,
    supabase.from("accountability_settings").select("*").single(),
    isMember ? supabase.from("accountability_events").select("*, accountability_ledger(id,revealed_at,winning_index)").eq("user_id", me.id).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
    isMember ? supabase.from("accommodation_changes").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    supabase.from("accountability_ledger").select("status,category,quantity"),
  ]);
  const s = settings.data!;
  type Ev = { id: string; period_type: string; period_start: string; performance_pct: number; level: "low" | "moderate" | "high"; triggering_category: keyof typeof CATEGORY_LABEL; accountability_ledger: { id: string; revealed_at: string | null; winning_index: number } | null };
  const events = (openEvents.data ?? []) as unknown as Ev[];
  const due = events.find((e) => !e.accountability_ledger) ?? events.find((e) => e.accountability_ledger && !e.accountability_ledger.revealed_at);
  const wheel = due ? (await supabase.rpc("get_wheel", { p_event: due.id })).data as { sectors: never[]; drawn: boolean; winning_index?: number; accommodation: boolean } : null;
  const all = stats.data ?? [];
  const open = all.filter((x) => x.status !== "completed");
  const fines = all.filter((x) => x.category === "financial_fine").reduce((t, x) => t + Number(x.quantity), 0);
  const href = (p: number) => `/accountability?page=${p}${sp.status ? `&status=${sp.status}` : ""}${sp.category ? `&category=${sp.category}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Governance & accountability" title={isMember ? "Accountability & Spin Wheel" : "Accountability Ledger"}
        description={isMember ? "When a closed period falls below target, an accountability spin becomes available. The outcome is selected securely on the server and assigned immediately."
          : me.role === "super_admin" ? "Organisation-wide accountability outcomes. Outcomes are assigned automatically — there is no approval step." : "Accountability outcomes for your assigned team members."}
        actions={<>
          {me.role === "super_admin" && <ButtonLink href="/settings/accountability" variant="outline" icon="tune">Sector editor & thresholds</ButtonLink>}
          <ButtonLink href={`/api/reports/export?type=accountability&format=csv`} variant="outline" icon="download">Export CSV</ButtonLink>
        </>} />

      {isMember && (
        <>
          {due && (
            <div className="mb-5 flex gap-3 rounded-xl border-l-4 border-accent-amber bg-surface p-4 shadow-card">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-amber/10 text-accent-amber"><Icon name="warning" /></span>
              <div>
                <Badge tone="amber">Accountability triggered</Badge>
                <p className="mt-1 text-body-md text-ink">
                  {due.period_type[0]!.toUpperCase() + due.period_type.slice(1)} period starting {fmtDate(due.period_start)}: achievement <strong>{pct(due.performance_pct)}</strong> ·
                  level <span className={cn("rounded px-1.5 text-label-sm", LEVEL_STYLE[due.level].cls)}>{LEVEL_STYLE[due.level].label}</span> ·
                  weakest category <strong>{CATEGORY_LABEL[due.triggering_category]}</strong>.
                </p>
                <p className="text-body-sm text-muted-text">{due.accountability_ledger ? "The system has already drawn your outcome automatically — reveal it below." : `If you do not spin within ${s.auto_draw_after_hours} hours, the system draws automatically.`}</p>
              </div>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
            <Card className="p-5">
              <SpinWheel eventId={due?.id ?? null} sectors={(wheel?.sectors ?? []) as never} drawn={Boolean(wheel?.drawn)}
                canSpin={Boolean(due)} accommodation={me.physical_accommodation} />
            </Card>
            <div className="space-y-5">
              <Card className="p-5">
                <CardHeader icon="accessible" title="Physical Accommodation Override" />
                <p className="mt-2 text-body-md text-muted-text">If you cannot safely perform physical activity, turn this on. It takes effect immediately — no approval needed. Frog jumps and leg raising are then excluded; the wheel only selects office signatures or a financial fine.</p>
                <div className={cn("mt-3 flex items-center justify-between rounded-lg px-3 py-2.5", me.physical_accommodation ? "bg-accent-emerald/10" : "bg-surface-alt")}>
                  <span className="text-label-md text-ink">Status</span>
                  <Badge tone={me.physical_accommodation ? "green" : "neutral"}>{me.physical_accommodation ? "ACTIVE" : "INACTIVE"}</Badge>
                </div>
                <div className="mt-3"><AccommodationToggle enabled={me.physical_accommodation} /></div>
                {(accHistory.data ?? []).length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border-subtle pt-3 text-body-sm text-muted-text">
                    {(accHistory.data as { id: number; enabled: boolean; note: string | null; created_at: string }[]).map((h) => (
                      <li key={h.id}>{h.enabled ? "Enabled" : "Disabled"} · {fmtDateTime(h.created_at)}{h.note ? ` · “${h.note}”` : ""}</li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-5">
                <CardHeader icon="stairs" title="Accountability levels" eyebrow="Configured by the Super Admin" />
                <ul className="mt-3 space-y-2 text-body-md">
                  <li className="flex justify-between"><span>{s.threshold_none}% – 100%</span><Badge tone="green">No consequence</Badge></li>
                  <li className="flex justify-between"><span>{s.threshold_low}% – {Number(s.threshold_none) - 0.01}%</span><Badge tone="amber">Low</Badge></li>
                  <li className="flex justify-between"><span>{s.threshold_moderate}% – {Number(s.threshold_low) - 0.01}%</span><Badge tone="amber">Moderate</Badge></li>
                  <li className="flex justify-between"><span>0% – {Number(s.threshold_moderate) - 0.01}%</span><Badge tone="red">High</Badge></li>
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}

      <div className="my-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total outcomes" value={all.length} icon="cyclone" />
        <StatTile label="Open (not completed)" value={open.length} icon="pending" tone="amber" />
        <StatTile label="Completed" value={all.length - open.length} icon="task_alt" tone="green" />
        <StatTile label="Fines recorded" value={naira(fines)} sub="Recorded only — never auto-deducted" icon="payments" tone="blue" />
      </div>

      <Card className="mb-5 p-5">
        <CardHeader icon="category" title="Permitted consequences" eyebrow="Only these four categories exist" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(CONSEQUENCE_LABEL) as (keyof typeof CONSEQUENCE_LABEL)[]).map((k) => (
            <div key={k} className="flex items-center gap-3 rounded-xl border border-border-subtle p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: CONSEQUENCE_COLOR[k] }}><Icon name={CONSEQUENCE_ICON[k]} /></span>
              <div>
                <div className="text-label-md text-ink">{CONSEQUENCE_LABEL[k]}{CONSEQUENCE_LIMITS[k].physical && <span className="ml-1 text-[10px] font-normal text-muted-text">(physical)</span>}</div>
                <div className="text-body-sm text-muted-text">{k === "financial_fine" ? `${naira(200)} – ${naira(5000)}` : `${CONSEQUENCE_LIMITS[k].min}–${CONSEQUENCE_LIMITS[k].max} ${CONSEQUENCE_LIMITS[k].unit}`}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <CardHeader icon="receipt_long" title={isMember ? "My Accountability Ledger" : "Team Accountability Ledger"} />
          <form className="flex flex-wrap gap-2" action="/accountability">
            <select name="status" defaultValue={sp.status ?? ""} className="input w-auto py-1.5 text-body-sm" aria-label="Filter by status">
              <option value="">All statuses</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="input w-auto py-1.5 text-body-sm" aria-label="Filter by category">
              <option value="">All categories</option>
              {Object.entries(CONSEQUENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="rounded-lg border border-border-subtle px-3 text-body-sm hover:bg-surface-alt">Filter</button>
          </form>
        </div>
        {(ledger.data ?? []).length === 0 ? <div className="px-5 pb-5"><EmptyState icon="verified" title="No accountability records">Outcomes appear here as soon as they are selected.</EmptyState></div> : (
          <>
            <Table>
              <thead><tr>{!isMember && <Th>Team member</Th>}<Th>Period</Th><Th>Trigger</Th><Th>Outcome</Th><Th>Selected</Th><Th>Status</Th><Th>Update</Th></tr></thead>
              <tbody>
                {(ledger.data ?? []).map((l) => {
                  const ev = l.event as unknown as { period_type: string; period_start: string; performance_pct: number; level: "low"; triggering_category: keyof typeof CATEGORY_LABEL };
                  return (
                    <tr key={l.id}>
                      {!isMember && <Td className="font-medium text-ink">{(l.member as unknown as { full_name: string } | null)?.full_name ?? "—"}</Td>}
                      <Td className="whitespace-nowrap text-muted-text">{ev.period_type} · {fmtDate(ev.period_start)}</Td>
                      <Td><div className="text-ink">{CATEGORY_LABEL[ev.triggering_category]}</div><div className="text-body-sm text-muted-text">{pct(ev.performance_pct)} · <span className={cn("rounded px-1", LEVEL_STYLE[ev.level].cls)}>{LEVEL_STYLE[ev.level].label}</span></div></Td>
                      <Td>
                        <span className="flex items-center gap-1.5 font-medium text-ink"><Icon name={CONSEQUENCE_ICON[l.category]} className="text-[18px]" />{consequenceText(l.category, l.quantity)}</span>
                        {l.accommodation_active && <Badge tone="green" className="mt-1">Accommodation</Badge>}
                      </Td>
                      <Td className="whitespace-nowrap text-body-sm text-muted-text">{fmtDateTime(l.assigned_at)}<div>{l.selected_by === "user_spin" ? "Spun by member" : "Auto-drawn by system"}</div></Td>
                      <Td><Badge tone={l.status === "completed" ? "green" : l.status === "in_progress" ? "blue" : "amber"} dot>{l.status.replace("_", " ")}</Badge>{l.completion_note && <div className="mt-1 max-w-48 truncate text-body-sm text-muted-text">“{l.completion_note}”</div>}</Td>
                      <Td>{l.status !== "completed" ? <LedgerStatusForm id={l.id} status={l.status} /> : <span className="text-body-sm text-muted-text">{fmtDate(l.completed_at)}</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={ledger.count ?? 0} hrefFor={href} />
          </>
        )}
      </Card>
      {!isMember && <p className="mt-3 text-body-sm text-muted-text">Fines are recorded for transparency under office policy and applicable law. <Link href="/settings/accountability" className="text-secondary">Nothing is ever deducted automatically.</Link></p>}
    </>
  );
}
