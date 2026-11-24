import Link from "next/link";
import { UpcomingEvents } from "@/components/posts/UpcomingEvents";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, Progress, StatTile, Table, Td, Th, scoreColor } from "@/components/ui";
import { ModalButton } from "@/components/ui/client";
import { AnnouncementForm, ApproveForm, InviteAdminButton, RejectButton } from "@/components/governance/Forms";
import { normalisePerformance } from "@/server/queries";
import type { TeamRow } from "@/components/team/TeamTable";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "@/lib/labels";
import { fmtDate, greeting, pct, timeAgo, todayInOrg } from "@/lib/format";

export const metadata: Metadata = { title: "Executive Dashboard" };

export default async function SuperAdminDashboard() {
  const me = await requireUser(["super_admin"]);
  const supabase = await createClient();
  const today = todayInOrg();
  const [counts, pending, admins, weekly, audit, quote, ledgerOpen] = await Promise.all([
    supabase.from("profiles").select("role,status"),
    supabase.from("profiles").select("id,full_name,email,job_title,created_at,email_verified_at,registration_requests!registration_requests_profile_id_fkey(requested_specialisation)").eq("status", "pending").order("created_at").limit(8),
    supabase.rpc("list_administrators"),
    supabase.rpc("team_performance", { p_type: "weekly", p_date: today }),
    supabase.from("audit_logs").select("id,action,created_at,actor:profiles!audit_logs_actor_id_fkey(full_name),target:profiles!audit_logs_target_user_id_fkey(full_name)").order("created_at", { ascending: false }).limit(7),
    supabase.rpc("latest_quote"),
    supabase.from("accountability_ledger").select("id", { count: "exact", head: true }).neq("status", "completed"),
  ]);
  const all = counts.data ?? [];
  const active = all.filter((p) => p.status === "approved");
  const rows = (weekly.data ?? []) as TeamRow[];
  const scores = rows.map((r) => r.overall).filter((v): v is number => v !== null).map(Number);
  const orgAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  // Category averages across the organisation
  const catAvg = Object.keys(CATEGORY_LABEL).filter((k) => k !== "additional_tasks").map((k) => {
    const v = rows.map((r) => normalisePerformance({ overall: r.overall, categories: r.categories }).categories.find((c) => c.category === k)).filter((c) => c?.applicable).map((c) => c!.capped_pct ?? 0);
    return { k: k as keyof typeof CATEGORY_LABEL, v: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  });
  const byAdmin = new Map<string, number[]>();
  for (const r of rows) if (r.overall !== null) byAdmin.set(r.administrator_name ?? "Unassigned", [...(byAdmin.get(r.administrator_name ?? "Unassigned") ?? []), Number(r.overall)]);
  const tiers = [
    ["High performers (90%+)", scores.filter((s) => s >= 90).length, "green"],
    ["On track (75–89%)", scores.filter((s) => s >= 75 && s < 90).length, "blue"],
    ["Moderate (50–74%)", scores.filter((s) => s >= 50 && s < 75).length, "amber"],
    ["High risk (<50%)", scores.filter((s) => s < 50).length, "red"],
  ] as const;
  const q = quote.data?.[0];
  const adminList = (admins.data ?? []).filter((a) => a.status === "approved");

  return (
    <div className="space-y-5">
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><h1 className="font-heading text-display-lg-mobile text-ink md:text-display-lg">{greeting()}, {me.full_name.split(" ")[0]}</h1><Badge tone="purple">Super Admin</Badge></div>
            <p className="mt-1 text-body-md text-muted-text">{fmtDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · <span className="text-on-tertiary-container">● Live data</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/super-admin/registrations" variant="success" icon="how_to_reg">Approve registrations ({(pending.data ?? []).length})</ButtonLink>
            <InviteAdminButton />
            <ButtonLink href="/super-admin/assignments" variant="outline" icon="swap_horiz">Transfer member</ButtonLink>
            <ModalButton label="Announce" title="Organisation announcement" icon="campaign" variant="outline"><AnnouncementForm canOrg /></ModalButton>
            <ButtonLink href="/audit-logs" variant="outline" icon="policy">Audit log</ButtonLink>
          </div>
        </div>
        {q && <p className="mt-4 rounded-lg bg-surface-alt px-4 py-2.5 text-body-md italic text-ink">“{q.text}” <span className="not-italic text-muted-text">— {q.author}</span></p>}
      </Card>
      <UpcomingEvents />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total accounts" value={all.length} sub={`${active.filter((p) => p.role === "administrator").length} admins · ${active.filter((p) => p.role === "team_member").length} active members`} icon="group" href="/super-admin/users" />
        <StatTile label="Pending queue" value={all.filter((p) => p.status === "pending").length} sub="Awaiting review" icon="hourglass_top" tone="amber" href="/super-admin/registrations" />
        <StatTile label="Org achievement" value={pct(orgAvg)} sub="This week, average of checklists" icon="monitoring" tone="green" href="/super-admin/analytics" />
        <StatTile label="Administrators" value={adminList.length} icon="admin_panel_settings" tone="blue" href="/super-admin/administrators" />
        <StatTile label="Open accountability" value={ledgerOpen.count ?? 0} icon="cyclone" tone="red" href="/accountability" />
        <StatTile label="Deactivated / removed" value={all.filter((p) => p.status === "deactivated" || p.status === "removed").length} icon="person_off" tone="neutral" />
      </div>

      <Card className="p-5">
        <CardHeader icon="account_tree" title="Administrative Command Structure" eyebrow={`${adminList.length} teams`} action={<Link href="/super-admin/assignments" className="text-body-sm font-semibold text-secondary">Reassign or balance →</Link>} />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {adminList.length === 0 && <EmptyState icon="admin_panel_settings" title="No administrators yet" action={<InviteAdminButton />} />}
          {adminList.map((a) => {
            const s = byAdmin.get(a.full_name) ?? [];
            const v = s.length ? s.reduce((x, y) => x + y, 0) / s.length : null;
            return (
              <div key={a.id} className="rounded-xl border border-border-subtle bg-surface-alt/50 p-4">
                <div className="flex items-center gap-2.5"><Avatar name={a.full_name} size={34} className="bg-obsidian" /><div className="min-w-0"><div className="truncate text-label-md text-ink">{a.full_name}</div><div className="text-body-sm text-muted-text">{Number(a.member_count)} members</div></div>
                  <span className="ml-auto font-heading text-heading-md" style={{ color: scoreColor(v) }}>{pct(v)}</span></div>
                <Progress value={v ?? 0} color={scoreColor(v)} className="mt-3" />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-5 pb-3"><CardHeader icon="how_to_reg" title="Pending Registration Review & Assignment Queue" eyebrow={`${(pending.data ?? []).length} awaiting decision`} action={<Link href="/super-admin/registrations" className="text-body-sm font-semibold text-secondary">Full queue →</Link>} /></div>
        {(pending.data ?? []).length === 0 ? <div className="px-5 pb-5"><EmptyState icon="inbox" title="No pending registrations" /></div> : (
          <Table>
            <thead><tr><Th>Candidate</Th><Th>Registered</Th><Th>Specialisation</Th><Th>E-mail</Th><Th>Approve & assign</Th><Th /></tr></thead>
            <tbody>{(pending.data ?? []).map((p, i) => (
              <tr key={p.id}>
                <Td><div className="font-medium text-ink">{p.full_name}</div><div className="text-body-sm text-muted-text">{p.email}</div></Td>
                <Td className="text-muted-text">{timeAgo(p.created_at)}</Td>
                <Td>{(p.registration_requests as unknown as { requested_specialisation: string | null } | null)?.requested_specialisation ?? "—"}</Td>
                <Td>{p.email_verified_at ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Unverified</Badge>}</Td>
                <Td><ApproveForm memberId={p.id} admins={adminList as never} suggested={[...adminList].sort((x, y) => Number(x.member_count) - Number(y.member_count))[i % Math.max(adminList.length, 1)]?.id} /></Td>
                <Td><RejectButton memberId={p.id} name={p.full_name} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader icon="functions" title="Checklist scores" eyebrow="Organisation average, this week" action={<span className="font-heading text-[28px] font-bold text-on-tertiary-container">{pct(orgAvg)}</span>} />
          <div className="mt-4 space-y-3">
            {catAvg.map(({ k, v }) => (
              <div key={k}><div className="flex justify-between text-body-md"><span className="text-ink">{CATEGORY_LABEL[k]}</span><span className="font-semibold">{pct(v)}</span></div>
                <Progress value={v ?? 0} color={CATEGORY_COLOR[k]} className="mt-1.5 h-2" /></div>
            ))}
          </div>
          <Link href="/settings" className="mt-4 inline-block text-body-sm font-semibold text-secondary">How scoring works →</Link>
        </Card>
        <Card className="p-5">
          <CardHeader icon="donut_small" title="Performance Tier Distribution" eyebrow={`${scores.length} members with data`} />
          <div className="mt-4 space-y-2.5">
            {tiers.map(([l, n, tone]) => (
              <div key={l} className="flex items-center justify-between rounded-xl bg-surface-alt px-4 py-3">
                <span className="text-body-md text-ink">{l}</span>
                <span className="flex items-center gap-2"><Badge tone={tone}>{n} members</Badge><span className="font-heading text-heading-md">{scores.length ? Math.round((n / scores.length) * 100) : 0}%</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <CardHeader icon="policy" title="System Activity & Governance Trail" action={<Link href="/audit-logs" className="text-body-sm font-semibold text-secondary">Full audit log →</Link>} />
        <ul className="mt-4 divide-y divide-border-subtle">
          {(audit.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5 text-body-md">
              <Icon name="history" className="text-faint-text" />
              <span className="flex-1"><span className="font-mono text-body-sm text-secondary">{a.action}</span> {(a.actor as unknown as { full_name: string } | null)?.full_name ?? "System"}{(a.target as unknown as { full_name: string } | null)?.full_name ? <> → {(a.target as unknown as { full_name: string }).full_name}</> : null}</span>
              <span className="text-body-sm text-faint-text">{timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
