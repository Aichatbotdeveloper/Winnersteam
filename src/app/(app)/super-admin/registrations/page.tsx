import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { ApproveForm, RejectButton } from "@/components/governance/Forms";
import { fmtDateTime, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Pending Registrations" };

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser(["super_admin"]);
  const { view } = await searchParams;
  const v = ["approved", "rejected"].includes(view ?? "") ? view! : "pending";
  const supabase = await createClient();
  const [reqs, admins] = await Promise.all([
    supabase.from("registration_requests").select("*, profile:profiles!registration_requests_profile_id_fkey(id,full_name,email,phone,job_title,team_name,team_leader_name,email_verified_at,status), decider:profiles!registration_requests_decided_by_fkey(full_name), assigned:profiles!registration_requests_assigned_admin_id_fkey(full_name)")
      .eq("decision", v).order("submitted_at", { ascending: v === "pending" }).limit(200),
    supabase.rpc("list_administrators"),
  ]);
  const adminList = (admins.data ?? []).filter((a) => a.status === "approved");
  type P = { id: string; full_name: string; email: string; phone: string | null; job_title: string | null; team_name: string | null; team_leader_name: string | null; email_verified_at: string | null };
  return (
    <>
      <PageHeader eyebrow="Governance & hierarchy" title="Registration approvals" description="Review new team-member registrations. Approving requires assigning an administrator. E-mail verification is tracked separately from approval." />
      <Tabs active={v} items={[{ key: "pending", href: "/super-admin/registrations", label: "Pending", icon: "hourglass_top" }, { key: "approved", href: "/super-admin/registrations?view=approved", label: "Approved", icon: "check_circle" }, { key: "rejected", href: "/super-admin/registrations?view=rejected", label: "Rejected", icon: "block" }]} />
      {adminList.length === 0 && v === "pending" && <p className="mb-4 rounded-lg bg-accent-amber/10 px-3 py-2 text-body-md text-[#b45309]">Invite at least one administrator before approving registrations — every member must be assigned.</p>}
      <Card className="overflow-hidden">
        {(reqs.data ?? []).length === 0 ? <div className="p-5"><EmptyState icon="inbox" title={`No ${v} registrations`} /></div> : (
          <Table>
            <thead><tr><Th>Applicant</Th><Th>Details</Th><Th>Submitted</Th><Th>E-mail</Th><Th>{v === "pending" ? "Decision" : "Outcome"}</Th></tr></thead>
            <tbody>{(reqs.data ?? []).map((r) => {
              const p = r.profile as unknown as P;
              return (
                <tr key={r.id}>
                  <Td><div className="font-medium text-ink">{p.full_name}</div><div className="text-body-sm text-muted-text">{p.email}{p.phone ? ` · ${p.phone}` : ""}</div></Td>
                  <Td className="text-body-sm text-muted-text"><div>{p.job_title ?? "—"}{p.team_name ? ` · ${p.team_name}` : ""}</div>{p.team_leader_name && <div>Leader: {p.team_leader_name}</div>}{r.requested_specialisation && <div className="text-ink">Specialisation: {r.requested_specialisation}</div>}</Td>
                  <Td className="whitespace-nowrap text-muted-text" ><span title={fmtDateTime(r.submitted_at)}>{timeAgo(r.submitted_at)}</span></Td>
                  <Td>{p.email_verified_at ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not verified</Badge>}</Td>
                  <Td>{v === "pending" ? <div className="flex flex-wrap items-center gap-1"><ApproveForm memberId={p.id} admins={adminList as never} /><RejectButton memberId={p.id} name={p.full_name} /></div>
                    : <div className="text-body-sm"><div className="text-ink">{v === "approved" ? `Assigned to ${(r.assigned as unknown as { full_name: string } | null)?.full_name ?? "—"}` : r.decision_reason}</div><div className="text-muted-text">by {(r.decider as unknown as { full_name: string } | null)?.full_name ?? "—"} · {fmtDateTime(r.decided_at)}</div></div>}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
