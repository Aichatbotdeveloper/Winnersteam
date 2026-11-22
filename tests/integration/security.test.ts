import { beforeAll, describe, expect, it } from "vitest";
import {
  ANON_KEY, SUPABASE_URL, addDays, createAdministrator, createAuthUser, createMember, createSuperAdmin,
  email, orgToday, service, signIn,
} from "./helpers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Actor = { id: string; email: string; client: SupabaseClient };
let superA: Actor, adminA: Actor, adminB: Actor, memberA: Actor, memberB: Actor;

beforeAll(async () => {
  superA = await createSuperAdmin();
  adminA = await createAdministrator(superA.client, "admina");
  adminB = await createAdministrator(superA.client, "adminb");
  memberA = await createMember(superA.client, "membera", adminA.id);
  memberB = await createMember(superA.client, "memberb", adminB.id);
});

describe("registration & roles", () => {
  it("public sign-up is pending and cannot spoof a role via metadata", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const addr = email("spoof");
    const { data, error } = await anon.auth.signUp({
      email: addr, password: "Test-Password-123!", options: { data: { full_name: "Spoofer", role: "super_admin" } },
    });
    expect(error).toBeNull();
    const { data: p } = await service.from("profiles").select("role,status").eq("id", data.user!.id).single();
    expect(p).toEqual({ role: "team_member", status: "pending" });
    // Super Admin was notified
    const { data: n } = await superA.client.from("notifications").select("type").eq("type", "registration.pending")
      .contains("data", { profile_id: data.user!.id });
    expect(n?.length).toBe(1);
  });

  it("pending users cannot write workspace data", async () => {
    const addr = email("pending");
    await createAuthUser(addr, { full_name: "Pending Person" });
    const c = await signIn(addr);
    const { error } = await c.from("tasks").insert({ title: "should fail" });
    expect(error).not.toBeNull();
  });

  it("invited administrator gets the administrator role", async () => {
    const { data } = await service.from("profiles").select("role,status").eq("id", adminA.id).single();
    expect(data).toEqual({ role: "administrator", status: "approved" });
  });

  it("users cannot escalate their own role/status or toggle accommodation directly", async () => {
    const r1 = await memberA.client.from("profiles").update({ role: "super_admin" }).eq("id", memberA.id);
    expect(r1.error?.message).toMatch(/Protected/);
    const r2 = await memberA.client.from("profiles").update({ physical_accommodation: true }).eq("id", memberA.id);
    expect(r2.error).not.toBeNull();
    const r3 = await memberA.client.from("profiles").update({ phone: "+2348000000000" }).eq("id", memberA.id);
    expect(r3.error).toBeNull();
  });

  it("only the Super Admin can approve registrations", async () => {
    const addr = email("pending2");
    const id = await createAuthUser(addr, { full_name: "Pending Two" });
    const { error } = await adminA.client.rpc("approve_registration", { p_member: id, p_admin: adminA.id });
    expect(error?.message).toMatch(/Super Admin/);
  });
});

describe("team isolation", () => {
  it("administrator sees only assigned members", async () => {
    await memberA.client.from("tasks").insert({ title: "A's private task" });
    await memberB.client.from("tasks").insert({ title: "B's private task" });

    const a = await adminA.client.from("tasks").select("title,owner_id");
    expect(a.data?.every((t) => t.owner_id === memberA.id)).toBe(true);
    expect(a.data?.some((t) => t.title === "A's private task")).toBe(true);

    const profiles = await adminA.client.from("profiles").select("id");
    const ids = profiles.data!.map((p) => p.id);
    expect(ids).toContain(memberA.id);
    expect(ids).not.toContain(memberB.id);

    const perf = await adminA.client.rpc("get_performance", { p_user: memberB.id, p_type: "daily" });
    expect(perf.error).not.toBeNull();
  });

  it("members cannot read each other's data", async () => {
    const r = await memberA.client.from("tasks").select("owner_id");
    expect(r.data?.every((t) => t.owner_id === memberA.id)).toBe(true);
    const p = await memberA.client.from("profiles").select("id");
    expect(p.data!.map((x) => x.id)).toEqual([memberA.id]);
    const audit = await memberA.client.from("audit_logs").select("id");
    expect(audit.data).toEqual([]);
  });

  it("administrators cannot transfer; Super Admin can, and access moves immediately", async () => {
    const denied = await adminA.client.rpc("transfer_member", { p_member: memberA.id, p_admin: adminB.id });
    expect(denied.error?.message).toMatch(/Super Admin/);

    const m = await createMember(superA.client, "mover", adminA.id);
    await m.client.from("tasks").insert({ title: "mover task" });
    expect((await adminA.client.from("tasks").select("id").eq("owner_id", m.id)).data?.length).toBe(1);

    const ok = await superA.client.rpc("transfer_member", { p_member: m.id, p_admin: adminB.id, p_reason: "balance" });
    expect(ok.error).toBeNull();
    expect((await adminA.client.from("tasks").select("id").eq("owner_id", m.id)).data?.length).toBe(0);
    expect((await adminB.client.from("tasks").select("id").eq("owner_id", m.id)).data?.length).toBe(1);
    // history intact
    const { data: hist } = await service.from("admin_assignments").select("administrator_id,ended_at").eq("member_id", m.id);
    expect(hist?.length).toBe(2);
    const { data: logs } = await service.from("audit_logs").select("action").eq("target_user_id", m.id).eq("action", "assignment.transferred");
    expect(logs?.length).toBe(1);
  });

  it("any administrator can remove any team member, but not administrators", async () => {
    const victim = await createMember(superA.client, "victim", adminA.id);
    // adminB is NOT victim's admin, still allowed to remove
    const ok = await adminB.client.rpc("remove_team_member", { p_member: victim.id, p_reason: "left company" });
    expect(ok.error).toBeNull();
    // ...but still cannot read victim's records
    expect((await adminB.client.from("profiles").select("id").eq("id", victim.id)).data).toEqual([]);
    const { data } = await service.from("profiles").select("status").eq("id", victim.id).single();
    expect(data!.status).toBe("removed");
    const denied = await adminB.client.rpc("remove_team_member", { p_member: adminA.id, p_reason: "nope" });
    expect(denied.error?.message).toMatch(/team-member/);
    const memberDenied = await memberA.client.rpc("remove_team_member", { p_member: memberB.id, p_reason: "nope" });
    expect(memberDenied.error).not.toBeNull();
  });

  it("audit logs are append-only even for the service role", async () => {
    const { error } = await service.from("audit_logs").delete().gt("id", 0);
    expect(error?.message).toMatch(/append-only/);
  });

  it("service-role-only cron functions are not callable by users", async () => {
    const r = await superA.client.rpc("cron_run_evaluations");
    expect(r.error).not.toBeNull();
  });
});

describe("productivity integrity", () => {
  it("cannot create tasks in the past", async () => {
    const today = await orgToday();
    const { error } = await memberA.client.from("tasks").insert({ title: "past", due_date: addDays(today, -1) });
    expect(error?.message).toMatch(/past/);
  });

  it("prospecting logs only for today", async () => {
    const today = await orgToday();
    const bad = await memberA.client.from("prospecting_activities").insert({ activity: "contact_prospects", occurred_on: addDays(today, -1) });
    expect(bad.error).not.toBeNull();
    const good = await memberA.client.from("prospecting_activities").insert({ activity: "contact_prospects", quantity: 3 });
    expect(good.error).toBeNull();
  });
});

describe("additional isolation checks", () => {
  it("avatars: members can only write to their own folder; other teams cannot read", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const own = await memberA.client.storage.from("avatars").upload(`${memberA.id}/t.png`, png, { contentType: "image/png", upsert: true });
    expect(own.error).toBeNull();
    const other = await memberA.client.storage.from("avatars").upload(`${memberB.id}/evil.png`, png, { contentType: "image/png" });
    expect(other.error).not.toBeNull();
    const assigned = await adminA.client.storage.from("avatars").createSignedUrl(`${memberA.id}/t.png`, 60);
    expect(assigned.error).toBeNull();
    const crossTeam = await adminB.client.storage.from("avatars").createSignedUrl(`${memberA.id}/t.png`, 60);
    expect(crossTeam.error).not.toBeNull();
  });

  it("other teams' change logs, ledgers and notifications stay private", async () => {
    await memberA.client.from("profiles").update({ team_name: "Alpha" }).eq("id", memberA.id);
    expect((await adminB.client.from("profile_change_log").select("id").eq("profile_id", memberA.id)).data).toEqual([]);
    expect((await adminB.client.from("notifications").select("id").eq("user_id", adminA.id)).data).toEqual([]);
    const { data: rows } = await adminB.client.from("accountability_ledger").select("user_id");
    expect(rows?.every((r) => r.user_id !== memberA.id)).toBe(true);
  });

  it("cannot forge notifications or audit entries", async () => {
    const n = await memberA.client.from("notifications").insert({ user_id: memberB.id, category: "system", type: "x", title: "fake" });
    expect(n.error).not.toBeNull();
    const a = await superA.client.from("audit_logs").insert({ action: "fake.entry", entity_type: "x" });
    expect(a.error).not.toBeNull();
  });

  it("administrators cannot modify member profiles or settings", async () => {
    const r = await adminA.client.from("profiles").update({ full_name: "Hacked" }).eq("id", memberA.id).select();
    expect(r.data ?? []).toEqual([]);
    const s = await adminA.client.from("system_settings").update({ value: false }).eq("key", "registration.open").select();
    expect(s.data ?? []).toEqual([]);
  });
});
