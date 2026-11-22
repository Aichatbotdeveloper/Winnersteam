"use client";

import { ActionForm, ModalButton, SubmitButton } from "@/components/ui/client";
import { Field } from "@/components/ui";
import {
  approveRegistration, correctPerformance, makeAdministrator, inviteAdministrator, rejectRegistration, removeMember, sendAnnouncement,
  setAccountActive, transferMember, updateAdministrator,
} from "@/server/actions/governance";
import { todayInOrg } from "@/lib/format";

type Admin = { id: string; full_name: string; member_count?: number | bigint };

export function ApproveForm({ memberId, admins, suggested }: { memberId: string; admins: Admin[]; suggested?: string }) {
  return (
    <ActionForm action={approveRegistration} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <select name="admin_id" defaultValue={suggested ?? ""} required className="input w-auto py-1.5 text-body-sm" aria-label="Assign administrator">
        <option value="" disabled>Assign administrator…</option>
        {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.member_count !== undefined ? ` (${a.member_count})` : ""}</option>)}
      </select>
      <SubmitButton size="sm" variant="success" icon="how_to_reg">Approve & assign</SubmitButton>
    </ActionForm>
  );
}

export function RejectButton({ memberId, name }: { memberId: string; name: string }) {
  return (
    <ModalButton label="Reject" title={`Reject ${name}`} icon="block" variant="ghost" size="sm">
      <ActionForm action={rejectRegistration} className="space-y-3">
        <input type="hidden" name="member_id" value={memberId} />
        <Field label="Reason (sent to the applicant) *"><textarea name="reason" required minLength={3} maxLength={1000} rows={3} className="input" /></Field>
        <div className="flex justify-end"><SubmitButton variant="danger" icon="block">Reject registration</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function TransferButton({ memberId, name, admins, currentAdmin }: { memberId: string; name: string; admins: Admin[]; currentAdmin?: string | null }) {
  return (
    <ModalButton label="Transfer" title={`Transfer ${name}`} icon="swap_horiz" variant="outline" size="sm">
      <ActionForm action={transferMember} className="space-y-3">
        <input type="hidden" name="member_id" value={memberId} />
        <Field label="New administrator *">
          <select name="admin_id" required defaultValue="" className="input">
            <option value="" disabled>Choose…</option>
            {admins.filter((a) => a.id !== currentAdmin).map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.member_count !== undefined ? ` — ${a.member_count} members` : ""}</option>)}
          </select>
        </Field>
        <Field label="Reason (recorded in the audit log)"><input name="reason" maxLength={500} className="input" /></Field>
        <p className="text-body-sm text-muted-text">The previous administrator loses access immediately. All tasks, goals, performance and accountability history stay intact.</p>
        <div className="flex justify-end"><SubmitButton icon="swap_horiz">Transfer member</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function RemoveMemberButton({ memberId, name, size = "sm" }: { memberId: string; name: string; size?: "sm" | "md" }) {
  return (
    <ModalButton label="Remove" title={`Remove ${name}`} icon="person_remove" variant="danger" size={size}>
      <ActionForm action={removeMember} className="space-y-3">
        <input type="hidden" name="member_id" value={memberId} />
        <p className="text-body-md text-muted-text">The account is deactivated immediately and can no longer sign in. Historical records are preserved for reporting and audit.</p>
        <Field label="Reason *"><textarea name="reason" required minLength={3} maxLength={1000} rows={3} className="input" /></Field>
        <div className="flex justify-end"><SubmitButton variant="danger" icon="person_remove">Remove team member</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function ActiveToggle({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  return (
    <ModalButton label={active ? "Deactivate" : "Reactivate"} title={`${active ? "Deactivate" : "Reactivate"} ${name}`} icon={active ? "toggle_off" : "toggle_on"} variant="outline" size="sm">
      <ActionForm action={setAccountActive} className="space-y-3">
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        <Field label="Reason"><input name="reason" maxLength={1000} className="input" /></Field>
        <div className="flex justify-end"><SubmitButton variant={active ? "danger" : "success"}>{active ? "Deactivate account" : "Reactivate account"}</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function InviteAdminButton() {
  return (
    <ModalButton label="Invite administrator" title="Invite an administrator" icon="person_add">
      <ActionForm action={inviteAdministrator} resetOnSuccess className="space-y-3">
        <Field label="Full name *"><input name="full_name" required maxLength={120} className="input" /></Field>
        <Field label="E-mail *"><input name="email" type="email" required className="input" /></Field>
        <Field label="Job title"><input name="job_title" maxLength={120} className="input" /></Field>
        <p className="text-body-sm text-muted-text">They receive a secure e-mail link to activate the account and set their own password.</p>
        <div className="flex justify-end"><SubmitButton icon="send">Send invitation</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function EditAdminButton({ id, name, jobTitle }: { id: string; name: string; jobTitle: string | null }) {
  return (
    <ModalButton label="Edit" title={`Edit ${name}`} icon="edit" variant="ghost" size="sm">
      <ActionForm action={updateAdministrator} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="Full name"><input name="full_name" defaultValue={name} required maxLength={120} className="input" /></Field>
        <Field label="Job title"><input name="job_title" defaultValue={jobTitle ?? ""} maxLength={120} className="input" /></Field>
        <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function AnnouncementForm({ canOrg }: { canOrg: boolean }) {
  return (
    <ActionForm action={sendAnnouncement} resetOnSuccess className="space-y-3">
      <Field label="Title *"><input name="title" required maxLength={160} className="input" /></Field>
      <Field label="Message *"><textarea name="body" required maxLength={4000} rows={4} className="input" /></Field>
      {canOrg && (
        <Field label="Audience"><select name="scope" className="input"><option value="organisation">Entire organisation</option><option value="team">Only members assigned to me</option></select></Field>
      )}
      <div className="flex justify-end"><SubmitButton icon="campaign">Send announcement</SubmitButton></div>
    </ActionForm>
  );
}

export function CorrectionButton({ userId }: { userId: string }) {
  return (
    <ModalButton label="Correct a period" title="Performance correction" icon="history_edu" variant="outline" size="sm">
      <ActionForm action={correctPerformance} className="space-y-3">
        <input type="hidden" name="user_id" value={userId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Period type"><select name="period_type" className="input"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
          <Field label="Date in period"><input type="date" name="date" max={todayInOrg()} required className="input" /></Field>
        </div>
        <Field label="Reason *" hint="Recomputes the period from current data as a new, audited snapshot version."><textarea name="reason" required minLength={5} rows={2} className="input" /></Field>
        <div className="flex justify-end"><SubmitButton icon="history_edu">Record correction</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}

export function MakeAdminButton({ userId, name, size = "sm" }: { userId: string; name: string; size?: "sm" | "md" }) {
  return (
    <ModalButton label="Make administrator" title={`Make ${name} an administrator`} icon="admin_panel_settings" variant="outline" size={size}>
      <ActionForm action={makeAdministrator} className="space-y-3">
        <input type="hidden" name="user_id" value={userId} />
        <p className="text-body-md text-muted-text">{name} will become an <strong>administrator</strong>: their account is approved, they stop reporting to an administrator, and they can manage the team members you assign to them. Their own tasks, goals and history are kept.</p>
        <p className="text-body-sm text-muted-text">Use this for someone who registered through the public form. To add a new administrator who has no account yet, use <strong>Administrator Directory → Invite administrator</strong>.</p>
        <div className="flex justify-end"><SubmitButton icon="admin_panel_settings">Make administrator</SubmitButton></div>
      </ActionForm>
    </ModalButton>
  );
}
