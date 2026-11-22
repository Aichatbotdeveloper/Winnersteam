import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAdministrator, createMember, createSuperAdmin, service } from "./helpers";

vi.mock("server-only", () => ({}));

const realFetch = globalThis.fetch;
let resendCalls = 0;

beforeAll(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_dummy");
  vi.stubEnv("EMAIL_FROM", "Winners Team <no-reply@example.test>");
  // Resend answers "limit reached"; everything else (Supabase) goes through.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/")) {
      resendCalls++;
      return new Response(JSON.stringify({ name: "daily_quota_exceeded" }), { status: 429 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

describe("e-mail delivery when the provider limit is reached", () => {
  it("keeps e-mails waiting instead of failing them, and drops ones older than 3 days", async () => {
    const superA = await createSuperAdmin("dlv");
    const admin = await createAdministrator(superA.client, "dlvadmin");
    const m = await createMember(superA.client, "dlvmember", admin.id);
    // Clear the queue so this test controls it.
    await service.from("notifications").update({ email_status: "skipped" }).eq("email_status", "pending");
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const { data: rows, error: insErr } = await service.from("notifications").insert([
      { user_id: m.id, category: "announcements", type: "announcement", title: "Old", email_status: "pending", created_at: old },
      { user_id: m.id, category: "announcements", type: "announcement", title: "New", email_status: "pending", created_at: new Date().toISOString() },
    ]).select("id,title");
    expect(insErr?.message).toBeUndefined();
    const { dispatchNotifications } = await import("@/server/delivery");
    const r = await dispatchNotifications();
    expect(r.email).toMatchObject({ held: 1, failed: 0, sent: 0 });
    expect(resendCalls).toBe(1);
    const { data } = await service.from("notifications").select("title,email_status,attempts").in("id", rows!.map((x) => x.id));
    const by = Object.fromEntries(data!.map((x) => [x.title, x]));
    expect(by.Old!.email_status).toBe("skipped");
    expect(by.New).toMatchObject({ email_status: "pending", attempts: 0 });
  });
});
