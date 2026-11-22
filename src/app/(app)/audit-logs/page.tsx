import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, PageHeader, Pagination, Table, Td, Th, buttonClass } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit Logs" };
const PAGE = 40;
const GROUPS: Record<string, string> = { registration: "Registrations", account: "Accounts", administrator: "Administrators", assignment: "Assignments", profile: "Profile changes",
  task: "Task changes", performance: "Performance", accountability: "Accountability", settings: "Configuration", service_updates: "Service updates", quotes: "Quotes", books: "Books", lex: "LEX", announcement: "Announcements", reminders: "Reminders" };

function summarise(v: unknown) {
  if (!v || typeof v !== "object") return "";
  return Object.entries(v as Record<string, unknown>).slice(0, 4).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ").slice(0, 220);
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ group?: string; page?: string; from?: string; to?: string }> }) {
  const me = await requireUser(["administrator", "super_admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*, actor:profiles!audit_logs_actor_id_fkey(full_name), target:profiles!audit_logs_target_user_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.group && GROUPS[sp.group]) q = q.like("action", `${sp.group}.%`);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q = q.gte("created_at", sp.from);
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q = q.lte("created_at", sp.to + "T23:59:59");
  const { data, count } = await q;
  const qs = (p: number) => `/audit-logs?${new URLSearchParams(Object.entries({ group: sp.group, from: sp.from, to: sp.to, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader eyebrow={me.role === "super_admin" ? "Organisation-wide governance stream" : "Administrator-scoped team audit"} title="Audit Logs"
        description="Append-only record of registrations, approvals, assignments, removals, profile and task changes, performance corrections, accountability selections and configuration changes. Entries cannot be edited or deleted." />
      <Card className="mb-4 p-3">
        <form className="flex flex-wrap items-end gap-2" action="/audit-logs">
          <label><span className="label">Area</span><select name="group" defaultValue={sp.group ?? ""} className="input w-auto"><option value="">All activity</option>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span className="label">From</span><input type="date" name="from" defaultValue={sp.from} className="input w-auto" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={sp.to} className="input w-auto" /></label>
          <button className={buttonClass("primary")}>Filter</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {(data ?? []).length === 0 ? <div className="p-5"><EmptyState icon="policy" title="No audit records" /></div> : (
          <Table>
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Affected</Th><Th>Change</Th><Th>Outcome</Th></tr></thead>
            <tbody>{(data ?? []).map((a) => (
              <tr key={a.id} className="align-top">
                <Td className="whitespace-nowrap text-body-sm text-muted-text">{fmtDateTime(a.created_at)}</Td>
                <Td><div className="text-ink">{(a.actor as unknown as { full_name: string } | null)?.full_name ?? "System"}</div>{a.actor_role && <div className="text-body-sm text-muted-text">{ROLE_LABEL[a.actor_role]}</div>}</Td>
                <Td><code className="rounded bg-surface-alt px-1.5 py-0.5 text-[12px] text-secondary">{a.action}</code></Td>
                <Td className="text-body-sm"><div className="text-ink">{(a.target as unknown as { full_name: string } | null)?.full_name ?? "—"}</div><div className="text-muted-text">{a.entity_type}</div></Td>
                <Td className="max-w-md text-body-sm text-muted-text">
                  {a.old_value && <div><span className="text-faint-text">before </span>{summarise(a.old_value)}</div>}
                  {a.new_value && <div><span className="text-faint-text">after </span>{summarise(a.new_value)}</div>}
                  {a.metadata && Object.keys(a.metadata as object).length > 0 && <div className="text-faint-text">{summarise(a.metadata)}</div>}
                </Td>
                <Td><Badge tone={a.outcome === "success" ? "green" : "red"}>{a.outcome}</Badge></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={qs} />
      </Card>
    </>
  );
}
