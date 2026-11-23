import { beforeAll, describe, expect, it } from "vitest";
import { addDays, createAdministrator, createMember, createSuperAdmin, orgToday, service } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

type Actor = { id: string; email: string; client: SupabaseClient };
let superA: Actor, admin: Actor;
let today: string, yesterday: string;

async function pastTasks(owner: string, date: string, total: number, done: number, kind = "daily") {
  const rows = Array.from({ length: total }, (_, i) => ({
    owner_id: owner, kind, title: `t${i}`, due_date: date, status: i < done ? "completed" : "pending",
  }));
  const { error } = await service.from("tasks").insert(rows);
  if (error) throw error;
}

beforeAll(async () => {
  superA = await createSuperAdmin("super-eng");
  admin = await createAdministrator(superA.client, "admin-eng");
  today = await orgToday();
  yesterday = addDays(today, -1);
});

/** A checklist (already graded, or open with items) whose deadline is 5 PM local on `date`. */
async function checklist(owner: string, date: string, kind: string, opts: { score?: number; progress?: number[]; open?: boolean }) {
  const deadline = `${date}T16:00:00Z`;
  const { data, error } = await service.from("checklists").insert({
    owner_id: owner, kind, title: `${kind} list`, deadline,
    ...(opts.open ? {} : { status: "closed", closed_at: deadline, closed_reason: "deadline", score: opts.score ?? null }),
  }).select("id").single();
  if (error) throw error;
  if (opts.progress?.length) {
    const r = await service.from("checklist_items").insert(opts.progress.map((p, i) => ({ checklist_id: data.id, owner_id: owner, title: `i${i}`, progress: p, position: i })));
    if (r.error) throw r.error;
  }
  return data.id as string;
}

describe("performance (checklists, no weights)", () => {
  it("every checklist counts equally: the day's average is the plain average of its checklists", async () => {
    const m = await createMember(superA.client, "perf1", admin.id);
    await checklist(m.id, yesterday, "todo", { score: 100 });
    await checklist(m.id, yesterday, "todo", { score: 50 });
    await checklist(m.id, yesterday, "prospecting", { score: 30 });
    const { data, error } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "daily", p_date: yesterday });
    expect(error).toBeNull();
    expect(Number(data.overall)).toBe(60); // (100 + 50 + 30) / 3
    const cats = Object.fromEntries((data.categories as { category: string; [k: string]: unknown }[]).map((c) => [c.category, c]));
    expect(Number(cats.daily_todo.capped_pct)).toBe(75);
    expect(Number(cats.prospecting.capped_pct)).toBe(30);
    expect(cats.weekly_goals.applicable).toBe(false);
    expect(Number(cats.daily_todo.weight)).toBe(0);
  });

  it("open checklists count with their live score; empty checklists are ignored", async () => {
    const m = await createMember(superA.client, "perf2", admin.id);
    await checklist(m.id, today, "todo", { open: true, progress: [100, 0] });
    await checklist(m.id, today, "todo", { open: true });
    const { data } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "daily", p_date: today });
    expect(Number(data.overall)).toBe(50);
  });

  it("weekly view averages the checklists due that week", async () => {
    const m = await createMember(superA.client, "perf3", admin.id);
    await checklist(m.id, yesterday, "weekly", { score: 80 });
    await checklist(m.id, yesterday, "todo", { score: 40 });
    const { data } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "weekly", p_date: yesterday });
    expect(Number(data.overall)).toBe(60);
  });


  it("weights must total 100 and only the Super Admin can change them", async () => {
    const bad = await superA.client.rpc("update_performance_weights", { p_daily: 50, p_weekly: 20, p_prospecting: 20, p_monthly: 20, p_additional: 10 });
    expect(bad.error).not.toBeNull();
    const denied = await admin.client.rpc("update_performance_weights", { p_daily: 30, p_weekly: 20, p_prospecting: 20, p_monthly: 20, p_additional: 10 });
    expect(denied.error).not.toBeNull();
  });
});

describe("accountability engine", () => {
  it("only four categories, strict limits, NGN only", async () => {
    const tooMany = await superA.client.from("accountability_options").insert({ category: "frog_jumps", quantity: 401 });
    expect(tooMany.error).not.toBeNull();
    const legs = await superA.client.from("accountability_options").insert({ category: "leg_raising", quantity: 61 });
    expect(legs.error).not.toBeNull();
    const offices = await superA.client.from("accountability_options").insert({ category: "office_signatures", quantity: 11 });
    expect(offices.error).not.toBeNull();
    const fine = await superA.client.from("accountability_options").insert({ category: "financial_fine", quantity: 5001 });
    expect(fine.error).not.toBeNull();
    const fineLow = await superA.client.from("accountability_options").insert({ category: "financial_fine", quantity: 199 });
    expect(fineLow.error).not.toBeNull();
    const fifth = await superA.client.from("accountability_options").insert({ category: "wall_sits", quantity: 30 });
    expect(fifth.error).not.toBeNull();
    const adminWrite = await admin.client.from("accountability_options").insert({ category: "frog_jumps", quantity: 33 });
    expect(adminWrite.error).not.toBeNull();
    const { data: all } = await service.from("accountability_options").select("category");
    expect(new Set(all!.map((o) => o.category))).toEqual(new Set(["frog_jumps", "leg_raising", "office_signatures", "financial_fine"]));
  });

  it("closed days are still recorded for history but no longer trigger a spin", async () => {
    const m = await createMember(superA.client, "acc-hist", admin.id);
    await pastTasks(m.id, yesterday, 4, 0);
    await checklist(m.id, yesterday, "todo", { score: 20 });
    await service.rpc("cron_run_evaluations");
    const { data } = await service.from("accountability_events").select("id").eq("user_id", m.id);
    expect(data).toEqual([]);
    const { data: snap } = await service.from("performance_snapshots").select("overall_score").eq("user_id", m.id).eq("period_type", "daily").eq("period_start", yesterday).single();
    expect(Number(snap!.overall_score)).toBe(20);
  });

  it("physical accommodation excludes frog jumps and leg raising (no approval)", async () => {
    for (let i = 0; i < 6; i++) {
      const m = await createMember(superA.client, `accom${i}`, admin.id);
      const set = await m.client.rpc("set_physical_accommodation", { p_enabled: true, p_note: "knee injury" });
      expect(set.error).toBeNull();
      const local = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 19);
      const { data: id } = await m.client.rpc("create_checklist", { p_kind: "todo", p_title: "Office", p_deadline: local, p_items: [{ title: "A" }] });
      await m.client.rpc("submit_checklist", { p_id: id });
      const { data: ev } = await m.client.from("accountability_events").select("id").eq("checklist_id", id).single();
      const wheel = await m.client.rpc("get_wheel", { p_event: ev!.id });
      expect(wheel.data.accommodation).toBe(true);
      for (const s of wheel.data.sectors) expect(["office_signatures", "financial_fine"]).toContain(s.category);
      const spin = await m.client.rpc("spin_accountability", { p_event: ev!.id });
      expect(["office_signatures", "financial_fine"]).toContain(spin.data.category);
      expect(spin.data.accommodation).toBe(true);
    }
  });

  it("threshold ranges must be ordered with no gaps", async () => {
    const bad = await superA.client.rpc("update_accountability_settings", {
      p_enabled: true, p_none: 70, p_low: 75, p_moderate: 50, p_daily: true, p_weekly: true, p_monthly: true, p_grace_minutes: 15 });
    expect(bad.error).not.toBeNull();
    const ok = await superA.client.rpc("update_accountability_settings", {
      p_enabled: true, p_none: 90, p_low: 75, p_moderate: 50, p_daily: true, p_weekly: true, p_monthly: true, p_grace_minutes: 15 });
    expect(ok.error).toBeNull();
  });
});


describe("notifications & reminders", () => {
  it("reminders are deduplicated per day", async () => {
    const m = await createMember(superA.client, "remind", admin.id);
    await superA.client.rpc("send_reminder_now", { p_kind: "daily_plan" });
    await superA.client.rpc("send_reminder_now", { p_kind: "daily_plan" });
    const { data } = await m.client.from("notifications").select("id").eq("type", "reminder.daily_plan");
    expect(data?.length).toBe(1);
  });

  it("routine reminder e-mails are off; monthly-goal reminders and deadlines are still e-mailed", async () => {
    const m = await createMember(superA.client, "mailquota", admin.id);
    const { data: c, error } = await service.from("checklists").insert({ owner_id: m.id, kind: "monthly", title: "Month",
      deadline: new Date(Date.now() + 24 * 3_600_000).toISOString() }).select("id").single();
    expect(error).toBeNull();
    await service.from("checklist_items").insert({ checklist_id: c!.id, owner_id: m.id, title: "Goal", progress: 25 });
    for (const k of ["daily_plan", "monthly_goals", "goal_deadlines"]) await superA.client.rpc("send_reminder_now", { p_kind: k });
    const { data } = await service.from("notifications").select("type,email_status").eq("user_id", m.id);
    const status = Object.fromEntries((data ?? []).map((n) => [n.type, n.email_status]));
    expect(status["reminder.daily_plan"]).toBe("skipped");
    expect(status["reminder.monthly_goals"]).toBe("pending");
    expect(status["reminder.monthly_goal_deadlines"]).toBe("pending");
  });


  it("profile changes notify the assigned admin and Super Admin", async () => {
    const m = await createMember(superA.client, "profchg", admin.id);
    await m.client.from("profiles").update({ job_title: "Senior Analyst" }).eq("id", m.id);
    const a = await admin.client.from("notifications").select("id").eq("type", "profile.modified").contains("data", { profile_id: m.id });
    const s = await superA.client.from("notifications").select("id").eq("type", "profile.modified").contains("data", { profile_id: m.id });
    expect(a.data?.length).toBe(1);
    expect(s.data?.length).toBe(1);
    const log = await admin.client.from("profile_change_log").select("changes").eq("profile_id", m.id);
    expect(log.data?.[0]?.changes.job_title.new).toBe("Senior Analyst");
  });

  it("login quotes rotate without immediate repeats", async () => {
    const m = await createMember(superA.client, "quotes", admin.id);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { data } = await m.client.rpc("next_login_quote");
      seen.add(data[0].id);
    }
    expect(seen.size).toBe(8);
  });

  it("LEX knowledge base is role-filtered", async () => {
    const m = await createMember(superA.client, "lexkb", admin.id);
    const mem = await m.client.rpc("search_knowledge_base", { p_query: "approve registrations administrators" });
    expect(mem.data.some((d: { slug: string }) => d.slug === "super-admin-governance")).toBe(false);
    const sup = await superA.client.rpc("search_knowledge_base", { p_query: "approve registrations administrators" });
    expect(sup.data.some((d: { slug: string }) => d.slug === "super-admin-governance")).toBe(true);
  });
});
