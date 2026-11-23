import { beforeAll, describe, expect, it } from "vitest";
import { createAdministrator, createMember, createSuperAdmin, service } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

type Actor = { id: string; email: string; client: SupabaseClient };
let superA: Actor, admin: Actor, otherAdmin: Actor;

/** Local date-time in the organisation's time zone (Africa/Lagos, UTC+1, no DST). */
const local = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000 + 3_600_000).toISOString().slice(0, 19);

async function newChecklist(c: SupabaseClient, kind: string, title: string, items: { title: string; target?: number }[], minutes = 120) {
  const { data, error } = await c.rpc("create_checklist", { p_kind: kind, p_title: title, p_deadline: local(minutes), p_items: items });
  expect(error).toBeNull();
  return data as string;
}
async function items(id: string) {
  const { data } = await service.from("checklist_items").select("id,title,progress").eq("checklist_id", id).order("position");
  return data!;
}

beforeAll(async () => {
  superA = await createSuperAdmin("cl");
  admin = await createAdministrator(superA.client, "cladmin");
  otherAdmin = await createAdministrator(superA.client, "cladmin2");
});

describe("checklists", () => {
  it("scores the plain average of 0/25/50/75/100 items and rejects other steps", async () => {
    const m = await createMember(superA.client, "cl-avg", admin.id);
    const id = await newChecklist(m.client, "todo", "Office", ["A", "B", "C", "D", "E"].map((t) => ({ title: t })));
    const its = await items(id);
    for (const [i, p] of [100, 75, 50, 25, 0].entries()) {
      expect((await m.client.rpc("update_checklist_item", { p_item: its[i]!.id, p_progress: p })).error).toBeNull();
    }
    expect((await m.client.rpc("update_checklist_item", { p_item: its[0]!.id, p_progress: 30 })).error?.message).toMatch(/0, 25, 50, 75 or 100/);
    const perf = await m.client.rpc("get_performance", { p_user: m.id, p_type: "daily", p_date: local(120).slice(0, 10) });
    expect(perf.data.overall).toBe(50);
    expect(perf.data.categories.find((c: { category: string }) => c.category === "daily_todo").capped_pct).toBe(50);
  });

  it("Submit now grades immediately and opens a spin with a 15-minute window", async () => {
    const m = await createMember(superA.client, "cl-submit", admin.id);
    const id = await newChecklist(m.client, "todo", "Office", [{ title: "A" }, { title: "B" }]);
    const its = await items(id);
    await m.client.rpc("update_checklist_item", { p_item: its[0]!.id, p_progress: 100 });
    const res = await m.client.rpc("submit_checklist", { p_id: id });
    expect(res.error).toBeNull();
    expect(res.data.score).toBe(50);
    const { data: ev } = await service.from("accountability_events").select("level,auto_draw_at,performance_pct").eq("checklist_id", id).single();
    expect(ev!.level).toBe("moderate");
    const mins = (new Date(ev!.auto_draw_at).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(13); expect(mins).toBeLessThanOrEqual(15.1);
    const { data: n } = await service.from("notifications").select("title,email_status").eq("user_id", m.id).eq("type", "accountability.triggered").single();
    expect(n!.title).toBe("Your Office to-do list scored 50%. Spin the wheel");
    expect(n!.email_status).toBe("skipped"); // daily lists: in-app and push only
    // locked after grading
    expect((await m.client.rpc("update_checklist_item", { p_item: its[1]!.id, p_progress: 100 })).error?.message).toMatch(/closed/);
    expect((await m.client.rpc("add_checklist_item", { p_checklist: id, p_title: "late" })).error?.message).toMatch(/closed/);
  });

  it("each checklist is judged on its own; a passing one has no consequence", async () => {
    const m = await createMember(superA.client, "cl-two", admin.id);
    const pass = await newChecklist(m.client, "todo", "Home to-do list", [{ title: "A" }]);
    const fail = await newChecklist(m.client, "todo", "Office", [{ title: "A" }]);
    await m.client.rpc("update_checklist_item", { p_item: (await items(pass))[0]!.id, p_progress: 100 });
    await m.client.rpc("submit_checklist", { p_id: pass });
    await m.client.rpc("submit_checklist", { p_id: fail });
    const { data: evs } = await service.from("accountability_events").select("checklist_id").eq("user_id", m.id);
    expect(evs!.map((e) => e.checklist_id)).toEqual([fail]);
    const { data: n } = await service.from("notifications").select("title").eq("user_id", m.id).eq("type", "checklist.graded").single();
    expect(n!.title).toBe("Your Home to-do list scored 100%. Well done!"); // no doubled "to-do list"
  });

  it("deadlines move earlier but never later", async () => {
    const m = await createMember(superA.client, "cl-dead", admin.id);
    const id = await newChecklist(m.client, "weekly", "Sales", [{ title: "A" }], 240);
    expect((await m.client.rpc("update_checklist", { p_id: id, p_title: "Sales", p_deadline: local(300) })).error?.message).toMatch(/earlier, but not later/);
    expect((await m.client.rpc("update_checklist", { p_id: id, p_title: "Sales week", p_deadline: local(60) })).error).toBeNull();
    expect((await m.client.rpc("update_checklist", { p_id: id, p_title: "Sales", p_deadline: local(-5) })).error).not.toBeNull();
    expect((await m.client.rpc("create_checklist", { p_kind: "todo", p_title: "Past", p_deadline: local(-10), p_items: [] })).error?.message).toMatch(/future/);
  });

  it("closes at the deadline, then the system spins after the grace period", async () => {
    const m = await createMember(superA.client, "cl-sweep", admin.id);
    const id = await newChecklist(m.client, "todo", "Office", [{ title: "A" }, { title: "B" }]);
    await m.client.rpc("update_checklist_item", { p_item: (await items(id))[0]!.id, p_progress: 50 });
    // simulate time passing: deadline was 2 minutes ago
    await service.from("checklists").update({ deadline: new Date(Date.now() - 120_000).toISOString() }).eq("id", id);
    await m.client.rpc("sync_my_checklists");
    const { data: c } = await service.from("checklists").select("status,score,closed_reason").eq("id", id).single();
    expect(c).toEqual({ status: "closed", score: 25, closed_reason: "deadline" });
    const { data: ev } = await service.from("accountability_events").select("id,auto_draw_at").eq("checklist_id", id).single();
    // grace counts from the deadline: 15 min after it
    expect(Math.round((new Date(ev!.auto_draw_at).getTime() - Date.now()) / 60_000)).toBe(13);
    // the 15 minutes pass without a spin
    await service.from("accountability_events").update({ auto_draw_at: new Date(Date.now() - 1000).toISOString() }).eq("id", ev!.id);
    await service.rpc("cron_sweep_checklists");
    const { data: led } = await service.from("accountability_ledger").select("selected_by").eq("event_id", ev!.id).single();
    expect(led!.selected_by).toBe("system_auto");
  });

  it("a spin pressed after the window is recorded as the system's", async () => {
    const m = await createMember(superA.client, "cl-late", admin.id);
    const id = await newChecklist(m.client, "todo", "Office", [{ title: "A" }]);
    await m.client.rpc("submit_checklist", { p_id: id });
    const { data: ev } = await service.from("accountability_events").select("id").eq("checklist_id", id).single();
    await service.from("accountability_events").update({ auto_draw_at: new Date(Date.now() - 1000).toISOString() }).eq("id", ev!.id);
    expect((await m.client.rpc("spin_accountability", { p_event: ev!.id })).error).toBeNull();
    const { data: led } = await service.from("accountability_ledger").select("selected_by").eq("event_id", ev!.id).single();
    expect(led!.selected_by).toBe("system_auto");
  });

  it("an in-time spin is the member's own, and cannot be re-rolled", async () => {
    const m = await createMember(superA.client, "cl-spin", admin.id);
    const id = await newChecklist(m.client, "todo", "Office", [{ title: "A" }]);
    await m.client.rpc("submit_checklist", { p_id: id });
    const { data: ev } = await service.from("accountability_events").select("id").eq("checklist_id", id).single();
    const a = await m.client.rpc("spin_accountability", { p_event: ev!.id });
    const b = await m.client.rpc("spin_accountability", { p_event: ev!.id });
    expect(a.data.ledger_id).toBe(b.data.ledger_id);
    const { data: led } = await service.from("accountability_ledger").select("selected_by").eq("event_id", ev!.id).single();
    expect(led!.selected_by).toBe("user_spin");
  });

  it("prospecting items are calculated from count and target (capped at 100%)", async () => {
    const m = await createMember(superA.client, "cl-prosp", admin.id);
    expect((await m.client.rpc("create_checklist", { p_kind: "prospecting", p_title: "Leads", p_deadline: local(60), p_items: [{ title: "Contact" }] })).error?.message).toMatch(/target/);
    const id = await newChecklist(m.client, "prospecting", "Leads", [{ title: "Contact prospects", target: 20 }, { title: "Proposals", target: 2 }]);
    const its = await items(id);
    await m.client.rpc("update_checklist_item", { p_item: its[0]!.id, p_achieved: 12 });
    await m.client.rpc("update_checklist_item", { p_item: its[1]!.id, p_achieved: 5 });
    const after = await items(id);
    expect(after.map((i) => i.progress)).toEqual([60, 100]);
  });

  it("administrators' own checklists are graded but never spin", async () => {
    const id = await newChecklist(admin.client, "todo", "Admin", [{ title: "A" }]);
    await admin.client.rpc("submit_checklist", { p_id: id });
    const { data } = await service.from("accountability_events").select("id").eq("checklist_id", id);
    expect(data).toEqual([]);
  });

  it("privacy: only the owner can change a checklist; only their admin can read it", async () => {
    const m = await createMember(superA.client, "cl-priv", admin.id);
    const id = await newChecklist(m.client, "todo", "Private", [{ title: "A" }]);
    const it = (await items(id))[0]!;
    expect((await admin.client.rpc("update_checklist_item", { p_item: it.id, p_progress: 100 })).error).not.toBeNull();
    expect((await admin.client.from("checklists").select("id").eq("id", id)).data?.length).toBe(1);
    expect((await otherAdmin.client.from("checklists").select("id").eq("id", id)).data).toEqual([]);
    // direct table writes are not allowed at all
    expect((await m.client.from("checklist_items").update({ progress: 100 }).eq("id", it.id).select()).data ?? []).toEqual([]);
    expect((await m.client.from("checklists").insert({ title: "x", deadline: new Date().toISOString() })).error).not.toBeNull();
  });

  it("deleting is only for mistakes: within 15 minutes or while empty", async () => {
    const m = await createMember(superA.client, "cl-del", admin.id);
    const fresh = await newChecklist(m.client, "todo", "Oops", [{ title: "A" }]);
    expect((await m.client.rpc("delete_checklist", { p_id: fresh })).error).toBeNull();
    const old = await newChecklist(m.client, "todo", "Real", [{ title: "A" }]);
    await service.from("checklists").update({ created_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", old);
    expect((await m.client.rpc("delete_checklist", { p_id: old })).error?.message).toMatch(/15 minutes/);
  });
});
