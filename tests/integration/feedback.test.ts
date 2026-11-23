import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, createAdministrator, createMember, createSuperAdmin, service } from "./helpers";

describe("feedback", () => {
  it("is private to the Super Admin, cannot be written directly, and notifies without e-mail", async () => {
    const superA = await createSuperAdmin("fb");
    const admin = await createAdministrator(superA.client, "fbadmin");
    const m = await createMember(superA.client, "fbmember", admin.id);
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

    // Only the app server (service role) writes feedback, after its spam checks.
    expect((await anon.from("feedback").insert({ type: "other", message: "hello there", email: "a@b.co" })).error).not.toBeNull();
    expect((await m.client.from("feedback").insert({ type: "other", message: "hello there", user_id: m.id })).error).not.toBeNull();
    // A visitor must leave an e-mail address.
    expect((await service.from("feedback").insert({ type: "other", message: "no contact" })).error?.message).toMatch(/feedback_contact/);

    const { data: fb, error } = await service.from("feedback").insert({ type: "suggestion", rating: 4, message: "Please add a calendar view", email: "visitor@example.com", name: "Ada" }).select("id").single();
    expect(error).toBeNull();
    expect((await anon.from("feedback").select("id")).data ?? []).toEqual([]);
    expect((await m.client.from("feedback").select("id")).data).toEqual([]);
    expect((await admin.client.from("feedback").select("id")).data).toEqual([]);
    expect((await superA.client.from("feedback").select("id").eq("id", fb!.id)).data?.length).toBe(1);

    const { data: n } = await service.from("notifications").select("title,email_status,link").eq("user_id", superA.id).eq("type", "feedback.new").contains("data", { feedback_id: fb!.id }).single();
    expect(n!.title).toBe("New feedback from Ada: Suggestion · ★★★★");
    expect(n!.email_status).toBe("skipped");
    expect(n!.link).toBe("/super-admin/feedback");

    // Status: Super Admin only.
    expect((await m.client.from("feedback").update({ status: "done" }).eq("id", fb!.id).select()).data ?? []).toEqual([]);
    expect((await superA.client.from("feedback").update({ status: "done" }).eq("id", fb!.id).select("status")).data?.[0]?.status).toBe("done");
  });
});
