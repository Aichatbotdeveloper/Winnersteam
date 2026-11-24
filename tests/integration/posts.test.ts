import { beforeAll, describe, expect, it } from "vitest";
import { createAdministrator, createMember, createSuperAdmin, service } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

type Actor = { id: string; email: string; client: SupabaseClient };
let superA: Actor, admin: Actor, member: Actor, member2: Actor;
const local = (mins: number) => new Date(Date.now() + mins * 60_000 + 3_600_000).toISOString().slice(0, 19);

beforeAll(async () => {
  superA = await createSuperAdmin("posts");
  admin = await createAdministrator(superA.client, "postsadmin");
  member = await createMember(superA.client, "postsm1", admin.id);
  member2 = await createMember(superA.client, "postsm2", admin.id);
});

const notes = async (user: string, type: string, key: string, val: string) =>
  (await service.from("notifications").select("title,email_status,push_status").eq("user_id", user).eq("type", type).contains("data", { [key]: val })).data ?? [];

describe("events", () => {
  it("only the Super Admin posts; everyone is notified (e-mail only if ticked); admins-only stays with staff", async () => {
    expect((await admin.client.rpc("save_event", { p_id: null, p_title: "Meet", p_description: null, p_location: null, p_starts_at: local(3000) })).error).not.toBeNull();
    const { data: id, error } = await superA.client.rpc("save_event", { p_id: null, p_title: "Monthly strategy meeting", p_description: "Bring your numbers",
      p_location: "Main hall", p_starts_at: local(3 * 1440), p_audience: "everyone", p_email: true });
    expect(error).toBeNull();
    const [m] = await notes(member.id, "event.new", "event_id", id);
    expect(m!.title).toBe("New event: Monthly strategy meeting");
    expect(m!.email_status).toBe("pending");
    expect((await notes(admin.id, "event.new", "event_id", id)).length).toBe(1);

    const { data: id2 } = await superA.client.rpc("save_event", { p_id: null, p_title: "Admins only", p_description: null, p_location: null,
      p_starts_at: local(2000), p_audience: "admins", p_email: false });
    expect((await notes(member.id, "event.new", "event_id", id2)).length).toBe(0);
    expect((await notes(admin.id, "event.new", "event_id", id2))[0]!.email_status).toBe("skipped");
    expect((await member.client.from("events").select("id").eq("id", id2)).data).toEqual([]);
    expect((await admin.client.from("events").select("id").eq("id", id2)).data?.length).toBe(1);
  });

  it("daily reminders (app only) until the day, the 1-hour reminder, RSVP, changes and cancellation", async () => {
    const { data: id } = await superA.client.rpc("save_event", { p_id: null, p_title: "Training", p_description: null, p_location: "Room 2", p_starts_at: local(2 * 1440 + 30) });
    // pretend it was posted yesterday and the clock is past 08:00
    await service.from("events").update({ created_at: new Date(Date.now() - 86_400_000).toISOString(), last_reminder_on: null }).eq("id", id);
    await service.rpc("cron_sweep_checklists");
    const now = new Date(Date.now() + 3_600_000).toISOString().slice(11, 16);
    const rem = await notes(member.id, "event.reminder", "event_id", id);
    if (now >= "08:00") {
      expect(rem.length).toBe(1);
      expect(rem[0]!.email_status).toBe("skipped");
      await service.rpc("cron_sweep_checklists");
      expect((await notes(member.id, "event.reminder", "event_id", id)).length).toBe(1); // once a day
    }
    expect((await member.client.rpc("rsvp_event", { p_id: id, p_response: "going" })).error).toBeNull();
    expect((await member2.client.from("event_rsvps").select("user_id").eq("event_id", id)).data).toEqual([]);
    expect((await superA.client.from("event_rsvps").select("response").eq("event_id", id)).data).toEqual([{ response: "going" }]);

    // move it to within the hour → "Starting soon"
    await service.from("events").update({ starts_at: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", id);
    await service.rpc("cron_sweep_checklists");
    expect((await notes(member.id, "event.reminder", "event_id", id)).some((n) => n.title.startsWith("Starting soon"))).toBe(true);

    expect((await superA.client.rpc("cancel_event", { p_id: id, p_reason: "Venue unavailable" })).error).toBeNull();
    expect((await notes(member.id, "event.cancelled", "event_id", id))[0]!.title).toBe("Cancelled: Training");
  });
});

describe("updates box", () => {
  it("members suggest, the Super Admin edits and publishes to everyone with credit", async () => {
    const { data: id, error } = await member.client.rpc("submit_update", { p_kind: "service", p_title: "New SEO tool", p_body: "Google released a free tool", p_link: "https://example.com" });
    expect(error).toBeNull();
    expect((await member2.client.from("update_posts").select("id").eq("id", id)).data).toEqual([]);
    expect((await admin.client.rpc("review_update", { p_id: id, p_publish: true })).error).not.toBeNull();
    const { data: n } = await superA.client.rpc("review_update", { p_id: id, p_publish: true, p_title: "New free SEO tool from Google", p_email: false });
    expect(n).toBeGreaterThan(2);
    const [x] = await notes(member2.id, "update.published", "update_id", id);
    expect(x!.title).toBe("Service update: New free SEO tool from Google");
    expect(x!.email_status).toBe("skipped");
    expect((await member2.client.from("update_posts").select("title").eq("id", id)).data).toEqual([{ title: "New free SEO tool from Google" }]);
    expect((await superA.client.rpc("review_update", { p_id: id, p_publish: false })).error?.message).toMatch(/already been reviewed/);
  });
});

describe("complaints", () => {
  it("only the Super Admin can read complaints; anonymous ones carry no link to the sender", async () => {
    const named = await member.client.rpc("submit_complaint", { p_category: "unfair_treatment", p_body: "My checklist score was changed unfairly.", p_anonymous: false });
    const anon = await member2.client.rpc("submit_complaint", { p_category: "manipulation", p_body: "Someone is marking items 100% without doing them.", p_anonymous: true });
    expect(named.error).toBeNull(); expect(anon.error).toBeNull();
    expect(anon.data.code).toMatch(/^WT-[0-9A-F]{4}-[0-9A-F]{4}$/);

    // administrators and members see nothing
    expect((await admin.client.from("complaints").select("id")).data).toEqual([]);
    expect((await member.client.from("complaints").select("id")).data).toEqual([]);
    expect((await admin.client.rpc("manage_complaint", { p_id: anon.data.id, p_status: "resolved" })).error).not.toBeNull();

    const { data: row } = await service.from("complaints").select("user_id,anonymous,created_at").eq("id", anon.data.id).single();
    expect(row!.user_id).toBeNull();
    expect(new Date(row!.created_at).getUTCMinutes()).toBe(0);
    const { data: alert } = await service.from("notifications").select("title,email_status,data").eq("user_id", superA.id).eq("type", "complaint.new").contains("data", { complaint_id: anon.data.id }).single();
    expect(alert!.title).toBe("New complaint (anonymous)");
    expect(JSON.stringify(alert)).not.toContain(member2.id);
    expect(alert!.email_status).toBe("skipped");
    const { data: audit } = await service.from("audit_logs").select("id").or(`actor_id.eq.${member2.id},target_user_id.eq.${member2.id}`).ilike("action", "complaint%");
    expect(audit ?? []).toEqual([]);

    // Super Admin replies; the anonymous sender reads it with the code only
    expect((await superA.client.rpc("manage_complaint", { p_id: anon.data.id, p_status: "reviewing", p_notes: "check logs", p_reply: "Thank you, we are looking into it." })).error).toBeNull();
    const { data: st } = await member2.client.rpc("complaint_status", { p_code: anon.data.code.toLowerCase().replace(/-/g, " ") });
    expect(st).toEqual([expect.objectContaining({ status: "reviewing", reply: "Thank you, we are looking into it." })]);
    expect(JSON.stringify(st)).not.toContain("check logs");
    expect((await member2.client.rpc("my_complaints")).data).toEqual([]); // anonymous: not listed under their account
    expect((await member.client.rpc("my_complaints")).data?.length).toBe(1);
    expect((await member.client.rpc("complaint_status", { p_code: "WT-0000-0000" })).data).toEqual([]);
  });
});
