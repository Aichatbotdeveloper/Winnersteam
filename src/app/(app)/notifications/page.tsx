import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, Icon, PageHeader, Pagination, Tabs, cn } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/client";
import { PushToggle } from "@/components/notifications/PushToggle";
import { markAllRead, markNotificationRead, savePreferences } from "@/server/actions/notifications";
import { NOTIFICATION_CATEGORIES } from "@/lib/labels";
import { env } from "@/lib/env";
import { fmtDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Notifications" };
const PAGE = 25;
const ICON: Record<string, string> = { reminders: "alarm", deadlines: "event_busy", performance: "monitoring", accountability: "cyclone", registration: "how_to_reg",
  assignment: "account_tree", profile: "badge", service_updates: "feed", announcements: "campaign", system: "settings" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; category?: string; unread?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "preferences" ? "preferences" : "inbox";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  const tabs = <Tabs active={tab} items={[{ key: "inbox", href: "/notifications", label: "Notification centre", icon: "inbox" }, { key: "preferences", href: "/notifications?tab=preferences", label: "Preferences", icon: "tune" }]} />;

  if (tab === "preferences") {
    const { data: pref } = await supabase.from("notification_preferences").select("*").eq("user_id", me.id).maybeSingle();
    const ch = (pref?.channels ?? {}) as Record<string, { in_app?: boolean; email?: boolean; push?: boolean }>;
    return (
      <>
        <PageHeader eyebrow="Notifications & reminders" title="Notification preferences" description="Choose how each type of notification reaches you. Account and registration messages are always delivered." />
        {tabs}
        <Card className="mb-5 p-5"><CardHeader icon="notifications_active" title="Browser push" /><div className="mt-3"><PushToggle vapidKey={env.vapidPublicKey} /></div></Card>
        <Card className="p-5">
          <ActionForm action={savePreferences}>
            <div className="mb-4 flex flex-wrap gap-6 text-body-md">
              <label className="flex items-center gap-2"><input type="checkbox" name="email_enabled" defaultChecked={pref?.email_enabled ?? true} className="accent-secondary" />E-mail notifications (master switch)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="push_enabled" defaultChecked={pref?.push_enabled ?? false} className="accent-secondary" />Browser push (master switch)</label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-body-md">
                <thead><tr className="border-b border-border-subtle text-label-sm uppercase tracking-wider text-muted-text"><th className="py-2">Category</th><th className="py-2 text-center">In-app</th><th className="py-2 text-center">E-mail</th><th className="py-2 text-center">Push</th></tr></thead>
                <tbody>
                  {NOTIFICATION_CATEGORIES.map(([key, label, desc]) => (
                    <tr key={key} className="border-b border-border-subtle">
                      <td className="py-3"><div className="flex items-center gap-2 text-ink"><Icon name={ICON[key] ?? "notifications"} className="text-[18px] text-secondary" />{label}</div><div className="text-body-sm text-muted-text">{desc}</div></td>
                      {(["in_app", "email", "push"] as const).map((c) => (
                        <td key={c} className="py-3 text-center"><input type="checkbox" name={`${key}.${c}`} defaultChecked={ch[key]?.[c] ?? true} aria-label={`${label} ${c}`} className="h-4 w-4 accent-secondary" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end"><SubmitButton icon="save">Save preferences</SubmitButton></div>
          </ActionForm>
        </Card>
      </>
    );
  }

  let q = supabase.from("notifications").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.category && NOTIFICATION_CATEGORIES.some(([k]) => k === sp.category) || sp.category === "registration" || sp.category === "system") q = q.eq("category", sp.category!);
  if (sp.unread === "1") q = q.is("read_at", null);
  const { data, count } = await q;
  const qs = (o: Record<string, string | undefined>) => "/notifications?" + new URLSearchParams(Object.entries({ category: sp.category, unread: sp.unread, ...o }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader eyebrow="Notifications & reminders" title="Notification centre" description="Reminders, deadlines, accountability outcomes, assignments, profile changes, service updates and announcements."
        actions={<ActionForm action={markAllRead} showMessage={false}><SubmitButton variant="outline" icon="done_all">Mark all read</SubmitButton></ActionForm>} />
      {tabs}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={qs({ category: undefined })} className={cn("rounded-lg px-2.5 py-1 text-body-sm", !sp.category ? "bg-secondary text-on-secondary" : "bg-surface text-muted-text shadow-card")}>All</Link>
        {[...NOTIFICATION_CATEGORIES.map(([k, l]) => [k, l] as const), ["registration", "Registration"] as const, ["system", "System"] as const].map(([k, l]) => (
          <Link key={k} href={qs({ category: k, page: undefined })} className={cn("rounded-lg px-2.5 py-1 text-body-sm", sp.category === k ? "bg-secondary text-on-secondary" : "bg-surface text-muted-text shadow-card")}>{l}</Link>
        ))}
        <Link href={qs({ unread: sp.unread === "1" ? undefined : "1", page: undefined })} className={cn("ml-auto rounded-lg px-2.5 py-1 text-body-sm", sp.unread === "1" ? "bg-primary text-on-primary" : "bg-surface text-muted-text shadow-card")}>Unread only</Link>
      </div>
      <Card className="overflow-hidden">
        {(data ?? []).length === 0 ? <div className="p-5"><EmptyState icon="notifications_none" title="No notifications">You&apos;re all caught up.</EmptyState></div> : (
          <ul>
            {(data ?? []).map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 border-b border-border-subtle px-5 py-4", !n.read_at && "bg-surface-container-low/50")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-alt text-secondary"><Icon name={ICON[n.category] ?? "notifications"} className="text-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.link ? <Link href={n.link} className="text-label-md text-ink hover:underline">{n.title}</Link> : <span className="text-label-md text-ink">{n.title}</span>}
                    <Badge>{n.category.replace("_", " ")}</Badge>
                    {!n.read_at && <Badge tone="purple" dot>New</Badge>}
                  </div>
                  {n.body && <p className="mt-0.5 text-body-md text-muted-text">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-faint-text" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}{n.email_status === "sent" ? " · e-mailed" : ""}{n.push_status === "sent" ? " · pushed" : ""}</p>
                </div>
                {!n.read_at && <ConfirmAction action={markNotificationRead} label="Mark read" variant="ghost" fields={{ id: n.id }} />}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={(p) => qs({ page: String(p) })} />
      </Card>
    </>
  );
}
