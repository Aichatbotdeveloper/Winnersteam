import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/client";
import { ActiveToggle, EditAdminButton, InviteAdminButton } from "@/components/governance/Forms";
import { revokeInvitation } from "@/server/actions/governance";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Administrator Directory" };

export default async function AdministratorsPage() {
  await requireUser(["super_admin"]);
  const supabase = await createClient();
  const [admins, invites, profiles] = await Promise.all([
    supabase.rpc("list_administrators"),
    supabase.from("administrator_invitations").select("*").is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id,job_title,last_seen_at").eq("role", "administrator"),
  ]);
  const extra = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  return (
    <>
      <PageHeader eyebrow="Governance & hierarchy" title="Administrator Directory" description="Only the Super Admin can create, modify or deactivate administrator accounts. Administrators never register through the public form." actions={<InviteAdminButton />} />
      <Card className="mb-5 overflow-hidden">
        {(admins.data ?? []).length === 0 ? <div className="p-5"><EmptyState icon="admin_panel_settings" title="No administrators yet" action={<InviteAdminButton />} /></div> : (
          <Table>
            <thead><tr><Th>Administrator</Th><Th>Team size</Th><Th>Status</Th><Th>Joined</Th><Th>Last active</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{(admins.data ?? []).map((a) => (
              <tr key={a.id}>
                <Td><div className="flex items-center gap-2.5"><Avatar name={a.full_name} size={32} className="bg-obsidian" /><div><div className="font-medium text-ink">{a.full_name}</div><div className="text-body-sm text-muted-text">{a.email}{a.job_title ? ` · ${a.job_title}` : ""}</div></div></div></Td>
                <Td>{Number(a.member_count)} members</Td>
                <Td><Badge tone={a.status === "approved" ? "green" : "red"}>{a.status === "approved" ? "Active" : a.status}</Badge></Td>
                <Td className="text-muted-text">{fmtDate(a.created_at)}</Td>
                <Td className="text-muted-text">{extra.get(a.id)?.last_seen_at ? fmtDateTime(extra.get(a.id)!.last_seen_at) : "Never"}</Td>
                <Td className="text-right"><div className="flex justify-end gap-1"><EditAdminButton id={a.id} name={a.full_name} jobTitle={a.job_title} />{a.status !== "pending" && <ActiveToggle userId={a.id} active={a.status === "approved"} name={a.full_name} />}</div></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Card className="p-5">
        <CardHeader icon="mail" title="Open invitations" />
        {(invites.data ?? []).length === 0 ? <p className="mt-3 text-body-md text-muted-text">No open invitations.</p> : (
          <ul className="mt-3 divide-y divide-border-subtle">
            {(invites.data ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-body-md">
                <span className="flex-1"><span className="text-ink">{i.full_name}</span> · {i.email}</span>
                <span className="text-body-sm text-muted-text">sent {fmtDate(i.created_at)} · expires {fmtDate(i.expires_at)}</span>
                {i.profile_id ? <Badge tone="blue">Account created</Badge> : <Badge tone="amber">Awaiting activation</Badge>}
                <ConfirmAction action={revokeInvitation} label="Revoke" icon="cancel" variant="ghost" confirm="Revoke this invitation?" fields={{ id: i.id }} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
