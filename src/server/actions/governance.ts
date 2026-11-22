"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUser } from "@/lib/auth";
import { env } from "@/lib/env";
import type { ActionResult } from "@/components/ui/client";

const uuid = z.string().uuid();
const reason = (min = 3) => z.string().trim().min(min, `Please give a reason (at least ${min} characters)`).max(1000);
const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Action failed" });
const BAN = "876000h"; // ~100 years: blocks sign-in; history is preserved (soft removal)

function refresh() {
  for (const p of ["/super-admin", "/super-admin/registrations", "/super-admin/users", "/super-admin/assignments", "/super-admin/administrators", "/admin", "/team"]) revalidatePath(p);
}

export async function approveRegistration(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const member = uuid.parse(fd.get("member_id"));
    const admin = uuid.safeParse(fd.get("admin_id"));
    if (!admin.success) return { ok: false, message: "Choose an administrator to assign before approving." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_registration", { p_member: member, p_admin: admin.data });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Registration approved and administrator assigned. The member has been notified." };
  } catch (e) { return fail(e); }
}

export async function rejectRegistration(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const member = uuid.parse(fd.get("member_id"));
    const r = reason().safeParse(fd.get("reason"));
    if (!r.success) return { ok: false, message: r.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.rpc("reject_registration", { p_member: member, p_reason: r.data });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Registration rejected. The applicant has been notified." };
  } catch (e) { return fail(e); }
}

export async function transferMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const member = uuid.parse(fd.get("member_id"));
    const admin = uuid.safeParse(fd.get("admin_id"));
    if (!admin.success) return { ok: false, message: "Choose the new administrator." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("transfer_member", { p_member: member, p_admin: admin.data, p_reason: String(fd.get("reason") ?? "").slice(0, 500) || undefined });
    if (error) return fail(error);
    refresh();
    revalidatePath(`/team/${member}`);
    return { ok: true, message: "Member transferred. Both administrators have been notified; history is preserved." };
  } catch (e) { return fail(e); }
}

/** Administrators and the Super Admin may remove ANY team-member account (soft removal). */
export async function removeMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["administrator", "super_admin"]);
    const member = uuid.parse(fd.get("member_id"));
    const r = reason().safeParse(fd.get("reason"));
    if (!r.success) return { ok: false, message: r.error.issues[0]!.message };
    const supabase = await createClient();
    // The database authorises the caller and validates the target first…
    const { error } = await supabase.rpc("remove_team_member", { p_member: member, p_reason: r.data });
    if (error) return fail(error);
    // …only then is the sign-in blocked with the service role.
    const { error: banErr } = await createAdminClient().auth.admin.updateUserById(member, { ban_duration: BAN });
    refresh();
    return { ok: true, message: banErr ? `Account removed, but sign-in could not be blocked: ${banErr.message}` : "Team member removed. Their history has been preserved." };
  } catch (e) { return fail(e); }
}

export async function setAccountActive(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const user = uuid.parse(fd.get("user_id"));
    const active = fd.get("active") === "true";
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_account_active", { p_user: user, p_active: active, p_reason: String(fd.get("reason") ?? "").slice(0, 1000) || undefined });
    if (error) return fail(error);
    const { error: banErr } = await createAdminClient().auth.admin.updateUserById(user, { ban_duration: active ? "none" : BAN });
    refresh();
    revalidatePath(`/team/${user}`);
    return { ok: true, message: `${active ? "Account reactivated" : "Account deactivated"}${banErr ? ` (sign-in update failed: ${banErr.message})` : ""}.` };
  } catch (e) { return fail(e); }
}

export async function inviteAdministrator(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const parsed = z.object({
      email: z.string().trim().toLowerCase().email("Enter a valid e-mail"),
      full_name: z.string().trim().min(2, "Enter the administrator's name").max(120),
      job_title: z.string().trim().max(120).optional(),
    }).safeParse({ email: fd.get("email"), full_name: fd.get("full_name"), job_title: fd.get("job_title") || undefined });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_admin_invitation", { p_email: parsed.data.email, p_full_name: parsed.data.full_name, p_job_title: parsed.data.job_title });
    if (error) return fail(error);
    const { error: invErr } = await createAdminClient().auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: `${env.siteUrl}/auth/callback?next=/set-password`, data: { full_name: parsed.data.full_name },
    });
    refresh();
    if (invErr) return { ok: false, message: `Invitation recorded, but the e-mail could not be sent: ${invErr.message}` };
    return { ok: true, message: `Invitation sent to ${parsed.data.email}. They will set their password from the e-mail link.` };
  } catch (e) { return fail(e); }
}

export async function revokeInvitation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const id = uuid.parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_admin_invitation", { p_invitation: id });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Invitation revoked." };
  } catch (e) { return fail(e); }
}

export async function updateAdministrator(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const id = uuid.parse(fd.get("id"));
    const parsed = z.object({ full_name: z.string().trim().min(2).max(120), job_title: z.string().trim().max(120).optional() })
      .safeParse({ full_name: fd.get("full_name"), job_title: fd.get("job_title") || undefined });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name, job_title: parsed.data.job_title ?? null }).eq("id", id).eq("role", "administrator");
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Administrator updated." };
  } catch (e) { return fail(e); }
}

export async function sendAnnouncement(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser(["administrator", "super_admin"]);
    const scope = me.role === "super_admin" && fd.get("scope") === "organisation" ? "organisation" : "team";
    const supabase = await createClient();
    const { error } = await supabase.rpc("send_announcement", { p_title: String(fd.get("title") ?? ""), p_body: String(fd.get("body") ?? ""), p_scope: scope });
    if (error) return fail(error);
    revalidatePath("/admin/announcements");
    revalidatePath("/admin");
    return { ok: true, message: "Announcement sent." };
  } catch (e) { return fail(e); }
}

export async function correctPerformance(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const user = uuid.parse(fd.get("user_id"));
    const type = z.enum(["daily", "weekly", "monthly"]).parse(fd.get("period_type"));
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(fd.get("date"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_performance", { p_user: user, p_type: type, p_date: date, p_reason: String(fd.get("reason") ?? "") });
    if (error) return fail(error);
    revalidatePath(`/team/${user}`);
    return { ok: true, message: "Performance recomputed as a new audited version." };
  } catch (e) { return fail(e); }
}
