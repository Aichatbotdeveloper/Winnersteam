"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Failed" });

export async function setReading(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const book_id = z.string().uuid().parse(fd.get("book_id"));
    const status = z.enum(["want_to_read", "reading", "completed"]).parse(fd.get("status"));
    const raw = fd.get("progress_pct");
    const progress_pct = raw === null || raw === "" ? undefined : z.coerce.number().int().min(0).max(100).parse(raw);
    const supabase = await createClient();
    const row: { user_id: string; book_id: string; status: typeof status; progress_pct?: number } = { user_id: me.id, book_id, status };
    if (progress_pct !== undefined) row.progress_pct = progress_pct;
    const { error } = await supabase.from("reading_progress").upsert(row, { onConflict: "user_id,book_id" });
    if (error) return fail(error);
    revalidatePath("/books");
    return { ok: true, message: status === "completed" ? "Marked as completed — well done!" : "Reading list updated" };
  } catch (e) { return fail(e); }
}

export async function removeFromList(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const book_id = z.string().uuid().parse(fd.get("book_id"));
    const supabase = await createClient();
    const { error } = await supabase.from("reading_progress").delete().eq("user_id", me.id).eq("book_id", book_id);
    if (error) return fail(error);
    revalidatePath("/books");
    return { ok: true, message: "Removed from your list" };
  } catch (e) { return fail(e); }
}

export async function addReadingNote(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const book_id = z.string().uuid().parse(fd.get("book_id"));
    const note = z.string().trim().min(1, "Write a note first").max(4000).parse(fd.get("note"));
    const supabase = await createClient();
    const { error } = await supabase.from("reading_notes").insert({ book_id, note });
    if (error) return fail(error);
    revalidatePath("/books");
    return { ok: true, message: "Note saved" };
  } catch (e) { return fail(e); }
}

export async function dismissRecommendation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.from("book_recommendations").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/books");
    return { ok: true, message: "Recommendation dismissed" };
  } catch (e) { return fail(e); }
}

export async function refreshRecommendations(_prev: ActionResult): Promise<ActionResult> {
  try {
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("refresh_my_recommendations");
    if (error) return fail(error);
    revalidatePath("/books");
    return { ok: true, message: data ? `${data} new recommendation(s) based on your performance history.` : "No new recommendations — your history shows no new recurring weaknesses." };
  } catch (e) { return fail(e); }
}
