import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, Card, PageHeader, Pagination, Table, Td, Th, buttonClass } from "@/components/ui";
import { ActiveToggle, MakeAdminButton, RemoveMemberButton } from "@/components/governance/Forms";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "User Management" };
const PAGE = 30;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }> }) {
  await requireUser(["super_admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("profiles").select("id,full_name,email,role,status,job_title,team_name,created_at,last_seen_at", { count: "exact" }).order("full_name").range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q.replace(/[%_,()]/g, "")}%,email.ilike.%${sp.q.replace(/[%_,()]/g, "")}%`);
  if (sp.role && sp.role in ROLE_LABEL) q = q.eq("role", sp.role as "team_member");
  if (sp.status && sp.status in STATUS_LABEL) q = q.eq("status", sp.status as "approved");
  const { data, count } = await q;
  const qs = (p: number) => `/super-admin/users?${new URLSearchParams(Object.entries({ q: sp.q, role: sp.role, status: sp.status, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader eyebrow="Governance & hierarchy" title="Organisation-wide User Directory" description="View, deactivate, reactivate or remove accounts. Removal is a soft deletion: records and history are always preserved."
        actions={<a href="/api/reports/export?type=users&format=csv" className={buttonClass("outline")}>Export CSV</a>} />
      <Card className="mb-4 p-3">
        <form className="flex flex-wrap gap-2" action="/super-admin/users">
          <input name="q" defaultValue={sp.q} placeholder="Name or e-mail" className="input max-w-xs" />
          <select name="role" defaultValue={sp.role ?? ""} className="input w-auto"><option value="">All roles</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="status" defaultValue={sp.status ?? ""} className="input w-auto"><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className={buttonClass("primary")}>Filter</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Team</Th><Th>Registered</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>{(data ?? []).map((u) => (
            <tr key={u.id}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={u.full_name} size={30} /><div>{u.role === "team_member" ? <Link href={`/team/${u.id}`} className="font-medium text-ink hover:underline">{u.full_name}</Link> : <span className="font-medium text-ink">{u.full_name}</span>}<div className="text-body-sm text-muted-text">{u.email}</div></div></div></Td>
              <Td><Badge tone={u.role === "super_admin" ? "dark" : u.role === "administrator" ? "purple" : "neutral"}>{ROLE_LABEL[u.role]}</Badge></Td>
              <Td><Badge tone={u.status === "approved" ? "green" : u.status === "pending" ? "amber" : "red"}>{STATUS_LABEL[u.status]}</Badge></Td>
              <Td className="text-muted-text">{u.team_name ?? "—"}</Td>
              <Td className="text-muted-text">{fmtDate(u.created_at)}</Td>
              <Td className="text-right"><div className="flex justify-end gap-1">
                {u.role !== "super_admin" && ["approved", "deactivated", "removed"].includes(u.status) && <ActiveToggle userId={u.id} active={u.status === "approved"} name={u.full_name} />}
                {u.role === "team_member" && (u.status === "approved" || u.status === "pending") && <MakeAdminButton userId={u.id} name={u.full_name} />}
                {u.role === "team_member" && u.status !== "removed" && <RemoveMemberButton memberId={u.id} name={u.full_name} />}
              </div></Td>
            </tr>
          ))}</tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={qs} />
      </Card>
    </>
  );
}
