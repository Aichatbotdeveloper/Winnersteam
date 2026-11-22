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

describe("performance engine", () => {
  it("daily to-do: 10 tasks, 8 completed = 80%, other categories normalised out", async () => {
    const m = await createMember(superA.client, "perf1", admin.id);
    await pastTasks(m.id, yesterday, 10, 8);
    const { data, error } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "daily", p_date: yesterday });
    expect(error).toBeNull();
    expect(Number(data.overall)).toBe(80);
    const cats = Object.fromEntries((data.categories as { category: string; [k: string]: unknown }[]).map((c) => [c.category, c]));
    expect(cats.weekly_goals.applicable).toBe(false);
    expect(Number(cats.daily_todo.effective_weight)).toBe(100);
  });

  it("weights, capping and overachievement", async () => {
    const m = await createMember(superA.client, "perf2", admin.id);
    await pastTasks(m.id, yesterday, 10, 8);
    await pastTasks(m.id, yesterday, 2, 1, "additional");
    await service.from("prospecting_targets").insert({ owner_id: m.id, activity: "contact_prospects", period: "daily", period_start: yesterday, target: 20 });
    await service.from("prospecting_activities").insert({ owner_id: m.id, activity: "contact_prospects", quantity: 22, occurred_on: yesterday });
    const { data } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "daily", p_date: yesterday });
    const cats = Object.fromEntries((data.categories as { category: string; raw_pct: number; capped_pct: number }[]).map((c) => [c.category, c]));
    expect(Number(cats.prospecting.capped_pct)).toBe(100);
    expect(Number(cats.prospecting.raw_pct)).toBe(110);
    // (30*80 + 20*100 + 10*50) / 60
    expect(Number(data.overall)).toBeCloseTo(81.67, 2);
  });

  it("weekly goals average capped achievement per goal and never divide by zero", async () => {
    const m = await createMember(superA.client, "perf3", admin.id);
    const { data: empty } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "weekly" });
    expect(empty.overall).toBeNull();
    const { data: wk } = await m.client.rpc("period_bounds", { p_type: "weekly", p_date: today });
    const ws = (wk as { p_start: string }[])[0]?.p_start ?? (wk as { p_start: string }).p_start;
    await m.client.from("weekly_goals").insert([
      { title: "Proposals", target: 4, achieved: 2, week_start: ws, deadline: addDays(ws, 6) },
      { title: "Calls", target: 10, achieved: 15, week_start: ws, deadline: addDays(ws, 6) },
    ]);
    const { data } = await m.client.rpc("get_performance", { p_user: m.id, p_type: "weekly" });
    const wg = (data.categories as { category: string; capped_pct: number; raw_pct: number }[]).find((c) => c.category === "weekly_goals")!;
    expect(Number(wg.capped_pct)).toBe(75); // avg(50%, 100% capped)
    expect(Number(wg.raw_pct)).toBe(100);   // avg(50%, 150%)
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

  it("evaluation triggers an event, spin assigns immediately, no reroll", async () => {
    const m = await createMember(superA.client, "acc1", admin.id);
    await pastTasks(m.id, yesterday, 4, 0);
    const run = await service.rpc("cron_run_evaluations");
    expect(run.error).toBeNull();

    const { data: ev } = await m.client.from("accountability_events").select("*").eq("period_type", "daily").eq("period_start", yesterday).single();
    expect(ev.level).toBe("high");
    expect(ev.triggering_category).toBe("daily_todo");

    const wheel = await m.client.rpc("get_wheel", { p_event: ev.id });
    expect(wheel.data.drawn).toBe(false);

    // the admin cannot spin for the member
    const adminSpin = await admin.client.rpc("spin_accountability", { p_event: ev.id });
    expect(adminSpin.error).not.toBeNull();

    const s1 = await m.client.rpc("spin_accountability", { p_event: ev.id });
    expect(s1.error).toBeNull();
    expect(s1.data.status).toBe("assigned");
    const s2 = await m.client.rpc("spin_accountability", { p_event: ev.id });
    expect(s2.data.ledger_id).toBe(s1.data.ledger_id);
    expect(s2.data.category).toBe(s1.data.category);
    expect(s1.data.sectors[s1.data.winning_index].category).toBe(s1.data.category);
    if (s1.data.category === "financial_fine") expect(s1.data.currency).toBe("NGN");

    // assigned admin is notified and can see the ledger
    const { data: led } = await admin.client.from("accountability_ledger").select("id,status").eq("id", s1.data.ledger_id);
    expect(led?.[0]?.status).toBe("assigned");

    // completion tracking
    const done = await m.client.rpc("update_ledger_status", { p_ledger: s1.data.ledger_id, p_status: "completed", p_note: "done" });
    expect(done.error).toBeNull();

    // second evaluation run does not duplicate
    await service.rpc("cron_run_evaluations");
    const { data: evs } = await service.from("accountability_events").select("id").eq("user_id", m.id).eq("period_type", "daily").eq("period_start", yesterday);
    expect(evs?.length).toBe(1);
  });

  it("physical accommodation excludes frog jumps and leg raising (no approval)", async () => {
    for (let i = 0; i < 6; i++) {
      const m = await createMember(superA.client, `accom${i}`, admin.id);
      const set = await m.client.rpc("set_physical_accommodation", { p_enabled: true, p_note: "knee injury" });
      expect(set.error).toBeNull();
      await pastTasks(m.id, yesterday, 4, 0);
      await service.rpc("cron_run_evaluations");
      const { data: ev } = await m.client.from("accountability_events").select("id").eq("period_type", "daily").single();
      const wheel = await m.client.rpc("get_wheel", { p_event: ev!.id });
      expect(wheel.data.accommodation).toBe(true);
      for (const s of wheel.data.sectors) expect(["office_signatures", "financial_fine"]).toContain(s.category);
      const spin = await m.client.rpc("spin_accountability", { p_event: ev!.id });
      expect(["office_signatures", "financial_fine"]).toContain(spin.data.category);
      expect(spin.data.accommodation).toBe(true);
    }
  });

  it("high performers get no consequence", async () => {
    const m = await createMember(superA.client, "acc-good", admin.id);
    await pastTasks(m.id, yesterday, 10, 10);
    await service.rpc("cron_run_evaluations");
    const { data } = await service.from("accountability_events").select("id").eq("user_id", m.id);
    expect(data).toEqual([]);
    const { data: snap } = await service.from("performance_snapshots").select("overall_score").eq("user_id", m.id).eq("period_type", "daily").eq("period_start", yesterday).single();
    expect(Number(snap!.overall_score)).toBe(100);
  });

  it("threshold ranges must be ordered with no gaps", async () => {
    const bad = await superA.client.rpc("update_accountability_settings", {
      p_enabled: true, p_none: 70, p_low: 75, p_moderate: 50, p_daily: true, p_weekly: true, p_monthly: true, p_auto_draw_hours: 24 });
    expect(bad.error).not.toBeNull();
  });

  it("auto-draws spins that were not taken within the window", async () => {
    const m = await createMember(superA.client, "acc-auto", admin.id);
    await pastTasks(m.id, yesterday, 3, 0);
    await service.rpc("cron_run_evaluations");
    const { data: ev } = await service.from("accountability_events").select("id").eq("user_id", m.id).single();
    // simulate the window elapsing: the event table has no update trigger, so the service role may backdate it
    await service.from("accountability_events").update({ created_at: new Date(Date.now() - 48 * 3600e3).toISOString() }).eq("id", ev!.id);
    await service.rpc("cron_run_evaluations");
    const { data: led } = await service.from("accountability_ledger").select("selected_by,status").eq("event_id", ev!.id).single();
    expect(led).toEqual({ selected_by: "system_auto", status: "assigned" });
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
    const w = await service.from("weekly_goals").insert({ owner_id: m.id, title: "W", unit: "u", target: 5, week_start: addDays(today, -((new Date(today).getUTCDay() + 6) % 7)), deadline: today });
    const mo = await service.from("monthly_goals").insert({ owner_id: m.id, title: "M", unit: "u", target: 5, month_start: today.slice(0, 8) + "01", deadline: today });
    expect([w.error?.message, mo.error?.message]).toEqual([undefined, undefined]);
    for (const k of ["daily_plan", "monthly_goals", "goal_deadlines"]) await superA.client.rpc("send_reminder_now", { p_kind: k });
    const { data } = await service.from("notifications").select("type,email_status").eq("user_id", m.id);
    const status = Object.fromEntries((data ?? []).map((n) => [n.type, n.email_status]));
    expect(status["reminder.daily_plan"]).toBe("skipped");
    expect(status["reminder.goal_deadlines"]).toBe("skipped");
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
