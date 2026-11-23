"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import { deliverSoon } from "@/server/deliverSoon";
import type { ActionResult } from "@/components/ui/client";

const uuid = z.string().uuid();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a deadline date and time");
const kind = z.enum(["todo", "weekly", "monthly", "prospecting"]);

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong";
  return { ok: false, message: msg };
}
function refresh() {
  for (const p of ["/tasks", "/weekly-goals", "/monthly-goals", "/prospecting", "/dashboard", "/performance", "/accountability"]) revalidatePath(p);
}

export async function createChecklist(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const k = kind.parse(fd.get("kind"));
    const title = z.string().trim().min(1, "Give the checklist a title").max(120).safeParse(fd.get("title"));
    if (!title.success) return { ok: false, message: title.error.issues[0]!.message };
    const deadline = localDateTime.safeParse(`${fd.get("deadline_date")}T${fd.get("deadline_time")}`);
    if (!deadline.success) return { ok: false, message: deadline.error.issues[0]!.message };
    const titles = fd.getAll("item_title").map(String);
    const targets = fd.getAll("item_target").map(String);
    const items = titles.map((t, i) => ({ title: t.trim(), target: k === "prospecting" ? Number(targets[i]) || null : null })).filter((i) => i.title);
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_checklist", { p_kind: k, p_title: title.data, p_deadline: deadline.data + ":00", p_items: items });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Checklist created" };
  } catch (e) { return fail(e); }
}

export async function updateChecklist(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = uuid.parse(fd.get("id"));
    const deadline = localDateTime.safeParse(`${fd.get("deadline_date")}T${fd.get("deadline_time")}`);
    if (!deadline.success) return { ok: false, message: deadline.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_checklist", { p_id: id, p_title: String(fd.get("title") ?? ""), p_deadline: deadline.data + ":00" });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Checklist updated" };
  } catch (e) { return fail(e); }
}

export async function deleteChecklist(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_checklist", { p_id: uuid.parse(fd.get("id")) });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "Checklist deleted" };
  } catch (e) { return fail(e); }
}

export async function addChecklistItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const target = fd.get("target") ? Number(fd.get("target")) : null;
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_checklist_item", {
      p_checklist: uuid.parse(fd.get("checklist_id")), p_title: String(fd.get("title") ?? ""), p_target: target ?? undefined });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "" };
  } catch (e) { return fail(e); }
}

/** Called directly from the checklist (progress buttons, counts, renames). */
export async function updateChecklistItem(input: { id: string; title?: string; progress?: number; achieved?: number; target?: number }): Promise<ActionResult> {
  try {
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_checklist_item", {
      p_item: uuid.parse(input.id), p_title: input.title, p_progress: input.progress, p_achieved: input.achieved, p_target: input.target });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "" };
  } catch (e) { return fail(e); }
}

export async function deleteChecklistItem(id: string): Promise<ActionResult> {
  try {
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_checklist_item", { p_item: uuid.parse(id) });
    if (error) return fail(error);
    refresh();
    return { ok: true, message: "" };
  } catch (e) { return fail(e); }
}

export async function submitChecklist(id: string): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_checklist", { p_id: uuid.parse(id) });
    if (error) return fail(error);
    refresh();
    const r = data as { score: number; event_id: string | null };
    return { ok: true, message: r.event_id ? `Scored ${Number(r.score)}%. Spin the wheel` : `Scored ${Number(r.score)}%`, data: r };
  } catch (e) { return fail(e); }
}
