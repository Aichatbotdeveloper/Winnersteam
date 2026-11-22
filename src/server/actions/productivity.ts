"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";
import { addDays, monthEnd } from "@/lib/format";

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong";
  return { ok: false, message: msg };
}

function refresh() {
  for (const p of ["/tasks", "/additional-tasks", "/dashboard", "/weekly-goals", "/monthly-goals", "/prospecting", "/performance"]) revalidatePath(p);
}

// ----------------------------------------------------------------- tasks ----
const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optText(2000),
  notes: optText(4000),
  kind: z.enum(["daily", "additional"]).default("daily"),
  category_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_date: date,
  due_time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
});

function formObj(fd: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, fd.get(k) ?? undefined]));
}

export async function createTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const parsed = taskSchema.safeParse(formObj(fd, ["title", "description", "notes", "kind", "category_id", "priority", "due_date", "due_time"]));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").insert(parsed.data);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Task created" };
  } catch (e) { return fail(e); }
}

export async function updateTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const parsed = taskSchema.safeParse(formObj(fd, ["title", "description", "notes", "kind", "category_id", "priority", "due_date", "due_time"]));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update(parsed.data).eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Task updated" };
  } catch (e) { return fail(e); }
}

export async function setTaskStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const status = z.enum(["pending", "in_progress", "completed"]).parse(fd.get("status"));
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: status === "completed" ? "Task completed" : "Task updated" };
  } catch (e) { return fail(e); }
}

export async function deleteTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Task deleted" };
  } catch (e) { return fail(e); }
}

// ----------------------------------------------------------------- goals ----
const goalSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optText(2000),
  unit: z.string().trim().min(1).max(30).default("units"),
  target: z.coerce.number().positive("Target must be greater than zero").max(1e12),
  achieved: z.coerce.number().min(0).max(1e12).default(0),
  deadline: date,
});

export async function saveGoal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const kind = z.enum(["weekly", "monthly"]).parse(fd.get("kind"));
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const periodStart = date.parse(fd.get("period_start"));
    const parsed = goalSchema.safeParse(formObj(fd, ["title", "description", "unit", "target", "achieved", "deadline"]));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const end = kind === "weekly" ? addDays(periodStart, 6) : monthEnd(periodStart);
    if (parsed.data.deadline < periodStart || parsed.data.deadline > end) {
      return { ok: false, message: `Deadline must fall between ${periodStart} and ${end}` };
    }
    const supabase = await createClient();
    const table = kind === "weekly" ? "weekly_goals" : "monthly_goals";
    const row = kind === "weekly" ? { ...parsed.data, week_start: periodStart } : { ...parsed.data, month_start: periodStart };
    const { error } = id
      ? await supabase.from(table).update(row).eq("id", id)
      : await supabase.from(table).insert(row as never);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: id ? "Goal updated" : "Goal created" };
  } catch (e) { return fail(e); }
}

export async function updateGoalProgress(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const kind = z.enum(["weekly", "monthly"]).parse(fd.get("kind"));
    const id = z.string().uuid().parse(fd.get("id"));
    const achieved = z.coerce.number().min(0).max(1e12).parse(fd.get("achieved"));
    const supabase = await createClient();
    const { error } = await supabase.from(kind === "weekly" ? "weekly_goals" : "monthly_goals").update({ achieved }).eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Progress updated" };
  } catch (e) { return fail(e); }
}

export async function deleteGoal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const kind = z.enum(["weekly", "monthly"]).parse(fd.get("kind"));
    const id = z.string().uuid().parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.from(kind === "weekly" ? "weekly_goals" : "monthly_goals").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Goal deleted" };
  } catch (e) { return fail(e); }
}

// ----------------------------------------------------------- prospecting ----
const ACTIVITIES = ["find_prospects", "contact_prospects", "generate_leads", "send_proposals", "follow_ups", "appointments", "conversions"] as const;

export async function saveProspectingTargets(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const period = z.enum(["daily", "weekly"]).parse(fd.get("period"));
    const periodStart = date.parse(fd.get("period_start"));
    const supabase = await createClient();
    const upserts: { owner_id: string; activity: (typeof ACTIVITIES)[number]; period: string; period_start: string; target: number }[] = [];
    const removals: (typeof ACTIVITIES)[number][] = [];
    for (const a of ACTIVITIES) {
      const raw = fd.get(`target_${a}`);
      if (raw === null) continue;
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return { ok: false, message: "Targets must be whole numbers between 0 and 10,000" };
      if (n === 0) removals.push(a); else upserts.push({ owner_id: me.id, activity: a, period, period_start: periodStart, target: n });
    }
    if (upserts.length) {
      const { error } = await supabase.from("prospecting_targets").upsert(upserts, { onConflict: "owner_id,activity,period,period_start" });
      if (error) return fail(error);
    }
    if (removals.length) {
      const { error } = await supabase.from("prospecting_targets").delete()
        .eq("owner_id", me.id).eq("period", period).eq("period_start", periodStart).in("activity", removals);
      if (error) return fail(error);
    }
    refresh();
    return { ok: true, message: "Targets saved" };
  } catch (e) { return fail(e); }
}

export async function logProspecting(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const parsed = z.object({
      activity: z.enum(ACTIVITIES),
      quantity: z.coerce.number().int().min(1).max(1000),
      prospect_name: optText(160),
      notes: optText(1000),
    }).safeParse(formObj(fd, ["activity", "quantity", "prospect_name", "notes"]));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.from("prospecting_activities").insert(parsed.data);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Activity logged" };
  } catch (e) { return fail(e); }
}

export async function deleteProspecting(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.from("prospecting_activities").delete().eq("id", id);
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Entry removed" };
  } catch (e) { return fail(e); }
}
