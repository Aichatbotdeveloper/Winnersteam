import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { TransferButton } from "@/components/governance/Forms";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Team Assignments" };
const PAGE = 30;

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ admin?: string; q?: string; page?: string }> }) {
  await requireUser(["super_admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("profiles").select("id,full_name,job_title,team_name,admin_assignments!admin_assignments_member_id_fkey(administrator_id,started_at,ended_at)", { count: "exact" })
    .eq("role", "team_member").eq("status", "approved").order("full_name").range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.q) q = q.ilike("full_name", `%${sp.q.replace(/[%_]/g, "")}%`);
  const [members, admins, history] = await Promise.all([
    q,
    supabase.rpc("list_administrators"),
    supabase.from("audit_logs").select("id,action,created_at,old_value,new_value,metadata,target:profiles!audit_logs_target_user_id_fkey(full_name)").in("action", ["assignment.transferred", "assignment.created"]).order("created_at", { ascending: false }).limit(15),
  ]);
  const adminList = (admins.data ?? []).filter((a) => a.status === "approved");
  const adminName = new Map((admins.data ?? []).map((a) => [a.id, a.full_name]));
  const rows = (members.data ?? []).map((m) => {
    const active = (m.admin_assignments as unknown as { administrator_id: string; started_at: string; ended_at: string | null }[]).find((a) => !a.ended_at);
    return { ...m, adminId: active?.administrator_id ?? null, since: active?.started_at ?? null };
  }).filter((m) => !sp.admin || m.adminId === sp.admin);

  return (
    <>
      <PageHeader eyebrow="Governance & hierarchy" title="Team Assignments & Reassignment" description="Each team member has exactly one active administrator. Only the Super Admin can transfer members; history is never reset." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {adminList.map((a) => (
          <Link key={a.id} href={`/super-admin/assignments?admin=${a.id}`} className={`card p-4 hover:shadow-float ${sp.admin === a.id ? "ring-2 ring-secondary" : ""}`}>
            <div className="text-label-md text-ink">{a.full_name}</div><div className="mt-1 font-heading text-[24px] font-bold">{Number(a.member_count)}</div><div className="text-body-sm text-muted-text">assigned members</div>
          </Link>
        ))}
      </div>
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <CardHeader icon="account_tree" title="Member assignments" eyebrow={sp.admin ? `Filtered: ${adminName.get(sp.admin)}` : "All active members"} />
          <form className="flex gap-2" action="/super-admin/assignments">{sp.admin && <input type="hidden" name="admin" value={sp.admin} />}<input name="q" defaultValue={sp.q} placeholder="Search member" className="input w-56 py-1.5" /><button className="rounded-lg border border-border-subtle px-3 text-body-sm">Search</button>{sp.admin && <Link href="/super-admin/assignments" className="self-center text-body-sm text-secondary">Clear</Link>}</form>
        </div>
        {rows.length === 0 ? <div className="px-5 pb-5"><EmptyState icon="groups" title="No members" /></div> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Current administrator</Th><Th>Since</Th><Th className="text-right">Transfer</Th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <Td><Link href={`/team/${m.id}`} className="font-medium text-ink hover:underline">{m.full_name}</Link><div className="text-body-sm text-muted-text">{m.job_title ?? "—"}</div></Td>
                <Td>{m.adminId ? adminName.get(m.adminId) : <Badge tone="amber">Unassigned</Badge>}</Td>
                <Td className="text-muted-text">{m.since ? fmtDate(m.since) : "—"}</Td>
                <Td className="text-right"><TransferButton memberId={m.id} name={m.full_name} admins={adminList as never} currentAdmin={m.adminId} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={members.count ?? 0} hrefFor={(p) => `/super-admin/assignments?page=${p}${sp.q ? `&q=${sp.q}` : ""}${sp.admin ? `&admin=${sp.admin}` : ""}`} />
      </Card>
      <Card className="p-5">
        <CardHeader icon="history" title="Recent assignment history" />
        <ul className="mt-3 divide-y divide-border-subtle">
          {(history.data ?? []).map((h) => (
            <li key={h.id} className="py-2.5 text-body-md">
              <span className="text-ink">{(h.target as unknown as { full_name: string } | null)?.full_name}</span>{" "}
              {h.action === "assignment.transferred"
                ? <>moved from <strong>{adminName.get((h.old_value as { administrator_id: string })?.administrator_id) ?? "—"}</strong> to <strong>{adminName.get((h.new_value as { administrator_id: string })?.administrator_id) ?? "—"}</strong></>
                : <>assigned to <strong>{adminName.get((h.new_value as { administrator_id: string })?.administrator_id) ?? "—"}</strong></>}
              {(h.metadata as { reason?: string })?.reason && <span className="text-muted-text"> · {(h.metadata as { reason: string }).reason}</span>}
              <span className="ml-2 text-body-sm text-faint-text">{fmtDateTime(h.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
