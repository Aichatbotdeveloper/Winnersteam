import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, EmptyState, Icon, PageHeader, Table, Td, Th } from "@/components/ui";
import { RemoveMemberButton } from "@/components/governance/Forms";

export const metadata: Metadata = { title: "Remove a team member" };

export default async function RemoveMemberPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser(["administrator", "super_admin"]);
  const { q } = await searchParams;
  const supabase = await createClient();
  const { data, error } = q && q.trim().length >= 2 ? await supabase.rpc("search_removable_members", { p_query: q.trim(), p_limit: 25 }) : { data: null, error: null };
  return (
    <>
      <PageHeader eyebrow="Governance" title="Remove a team member"
        description="Administrators may remove any team-member account. Removal is immediate deactivation: the person can no longer sign in, and all historical records are preserved. This search shows only names — it does not grant access to other teams' records." />
      <Card className="mb-4 p-4">
        <form action="/admin/remove-member" className="flex gap-2">
          <input name="q" defaultValue={q} minLength={2} placeholder="Search by name or team (min. 2 characters)" className="input max-w-md" />
          <button className="flex items-center gap-1 rounded-lg bg-primary px-3 text-label-md text-on-primary"><Icon name="search" className="text-[18px]" />Search</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {error && <p className="p-4 text-accent-red">{error.message}</p>}
        {!data ? <div className="p-5"><EmptyState icon="person_search" title="Search for a team member">Enter at least two characters.</EmptyState></div>
          : data.length === 0 ? <div className="p-5"><EmptyState icon="person_off" title="No matching team members" /></div> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Job title</Th><Th>Team</Th><Th>Status</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>{data.map((m) => (
              <tr key={m.id}><Td className="font-medium text-ink">{m.full_name}</Td><Td className="text-muted-text">{m.job_title ?? "—"}</Td><Td className="text-muted-text">{m.team_name ?? "—"}</Td>
                <Td><Badge tone={m.status === "approved" ? "green" : "amber"}>{m.status}</Badge></Td>
                <Td className="text-right"><RemoveMemberButton memberId={m.id} name={m.full_name} /></Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
