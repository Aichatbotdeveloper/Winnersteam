"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import { CONSEQUENCE_LIMITS } from "@/lib/labels";
import { ingestServiceUpdates } from "@/server/serviceUpdates";
import type { ActionResult } from "@/components/ui/client";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Save failed" });
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const httpsUrl = z.string().trim().optional().transform((v) => v || null).refine((v) => !v || /^https:\/\/\S+$/i.test(v), "Links must start with https://");
const PERF = ["daily_todo", "weekly_goals", "prospecting", "monthly_goals", "additional_tasks"] as const;
const LEVELS = ["low", "moderate", "high"] as const;
const done = (path: string, message: string): ActionResult => { revalidatePath(path); return { ok: true, message }; };

async function su() { await assertUser(["super_admin"]); return createClient(); }

export async function saveGeneral(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const tz = z.string().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Unknown timezone").parse(fd.get("timezone"));
    const updates: [string, unknown][] = [
      ["org.name", z.string().trim().min(1).max(80).parse(fd.get("org_name"))],
      ["org.timezone", tz],
      ["registration.open", fd.get("registration_open") === "on"],
      ["quotes.no_repeat_window", z.coerce.number().int().min(0).max(100).parse(fd.get("no_repeat"))],
      ["service_updates.max_items_per_source", z.coerce.number().int().min(1).max(50).parse(fd.get("max_items"))],
    ];
    for (const [key, value] of updates) {
      const { error } = await supabase.from("system_settings").update({ value: value as never }).eq("key", key);
      if (error) return fail(error);
    }
    return done("/settings", "General settings saved.");
  } catch (e) { return fail(e); }
}

export async function saveLexSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    for (const [key, value] of [
      ["lex.enabled", fd.get("enabled") === "on"],
      ["lex.welcome_message", z.string().trim().min(1).max(500).parse(fd.get("welcome"))],
      ["lex.max_history", z.coerce.number().int().min(0).max(24).parse(fd.get("max_history"))],
    ] as [string, unknown][]) {
      const { error } = await supabase.from("system_settings").update({ value: value as never }).eq("key", key);
      if (error) return fail(error);
    }
    return done("/settings/lex", "LEX settings saved.");
  } catch (e) { return fail(e); }
}

export async function saveWeights(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const n = (k: string) => z.coerce.number().min(0).max(100).parse(fd.get(k));
    const w = { p_daily: n("w_daily"), p_weekly: n("w_weekly"), p_prospecting: n("w_prospecting"), p_monthly: n("w_monthly"), p_additional: n("w_additional") };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1e-9) return { ok: false, message: `Weights must total exactly 100% (currently ${total}%).` };
    const { error } = await supabase.rpc("update_performance_weights", w);
    if (error) return fail(error);
    return done("/settings", "Performance weights updated. New calculations use them immediately; recorded snapshots keep the weights they were calculated with.");
  } catch (e) { return fail(e); }
}

export async function saveAccountabilitySettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const n = (k: string) => z.coerce.number().min(0).max(100).parse(fd.get(k));
    const none = n("none"), low = n("low"), moderate = n("moderate");
    if (!(0 < moderate && moderate < low && low < none && none <= 100)) return { ok: false, message: "Thresholds must satisfy 0 < moderate < low < no-consequence ≤ 100 (no gaps or overlaps)." };
    const { error } = await supabase.rpc("update_accountability_settings", {
      p_enabled: fd.get("enabled") === "on", p_none: none, p_low: low, p_moderate: moderate,
      p_daily: fd.get("daily") === "on", p_weekly: fd.get("weekly") === "on", p_monthly: fd.get("monthly") === "on",
      p_auto_draw_hours: z.coerce.number().int().min(1).max(168).parse(fd.get("auto_hours")),
    });
    if (error) return fail(error);
    return done("/settings/accountability", "Accountability settings saved.");
  } catch (e) { return fail(e); }
}

/** Sector editor: only the four permitted categories, within their limits (also enforced by the DB). */
export async function saveOption(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const category = z.enum(["frog_jumps", "leg_raising", "office_signatures", "financial_fine"]).parse(fd.get("category"));
    const lim = CONSEQUENCE_LIMITS[category];
    const quantity = z.coerce.number().int(`Quantity must be a whole number`).min(lim.min, `Minimum is ${lim.min}`).max(lim.max, `Maximum is ${lim.max}`).safeParse(fd.get("quantity"));
    if (!quantity.success) return { ok: false, message: quantity.error.issues[0]!.message };
    const levels = LEVELS.filter((l) => fd.get(`level_${l}`) === "on");
    const applies = PERF.filter((p) => fd.get(`applies_${p}`) === "on");
    if (!levels.length) return { ok: false, message: "Select at least one accountability level." };
    if (!applies.length) return { ok: false, message: "Select at least one triggering category." };
    const row = { category, quantity: quantity.data, levels: [...levels], applies_to: [...applies], weight: z.coerce.number().int().min(1).max(100).parse(fd.get("weight")), active: fd.get("active") === "on" };
    const { error } = id ? await supabase.from("accountability_options").update(row).eq("id", id) : await supabase.from("accountability_options").insert(row);
    if (error) return fail(error.message.includes("unique") ? new Error("That category already has a sector with this quantity.") : error);
    return done("/settings/accountability", id ? "Sector updated." : "Sector added.");
  } catch (e) { return fail(e); }
}

export async function deleteOption(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = z.string().uuid().parse(fd.get("id"));
    // Options already used in the ledger are deactivated rather than deleted (history is kept).
    const { count } = await supabase.from("accountability_ledger").select("id", { count: "exact", head: true }).eq("option_id", id);
    const { error } = count ? await supabase.from("accountability_options").update({ active: false }).eq("id", id) : await supabase.from("accountability_options").delete().eq("id", id);
    if (error) return fail(error);
    return done("/settings/accountability", count ? "Sector has history, so it was deactivated instead of deleted." : "Sector deleted.");
  } catch (e) { return fail(e); }
}

export async function saveReminder(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const kind = z.string().parse(fd.get("kind"));
    const { error } = await supabase.from("reminder_schedules").update({
      enabled: fd.get("enabled") === "on", local_time: z.string().regex(/^\d{2}:\d{2}$/).parse(fd.get("local_time")),
    }).eq("kind", kind);
    if (error) return fail(error);
    return done("/settings/reminders", "Reminder schedule saved.");
  } catch (e) { return fail(e); }
}

export async function sendReminderNow(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const { data, error } = await supabase.rpc("send_reminder_now", { p_kind: z.string().parse(fd.get("kind")) });
    if (error) return fail(error);
    const n = Object.values((data ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
    return done("/settings/reminders", `Reminder generated for ${n} member(s) (duplicates for today are skipped).`);
  } catch (e) { return fail(e); }
}

export async function runEvaluationsNow(_prev: ActionResult): Promise<ActionResult> {
  try {
    const supabase = await su();
    const { data, error } = await supabase.rpc("run_evaluations_now");
    if (error) return fail(error);
    const d = data as { events_created: number; auto_draws: number };
    return done("/settings/accountability", `Evaluation complete: ${d.events_created} new accountability event(s), ${d.auto_draws} automatic draw(s).`);
  } catch (e) { return fail(e); }
}

export async function saveSource(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const parsed = z.object({
      name: z.string().trim().min(1).max(120), feed_url: z.string().trim().regex(/^https:\/\/\S+$/i, "Feed URL must be https"),
      homepage_url: z.string().trim().optional().transform((v) => v || null), category_id: z.string().uuid("Choose a category"),
    }).safeParse({ name: fd.get("name"), feed_url: fd.get("feed_url"), homepage_url: fd.get("homepage_url") || undefined, category_id: fd.get("category_id") });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const row = { ...parsed.data, active: fd.get("active") === "on" };
    const { error } = id ? await supabase.from("service_update_sources").update(row).eq("id", id) : await supabase.from("service_update_sources").insert(row);
    if (error) return fail(error);
    return done("/settings/sources", "Source saved.");
  } catch (e) { return fail(e); }
}

export async function fetchSourcesNow(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : undefined;
    const r = await ingestServiceUpdates(id);
    revalidatePath("/settings/sources");
    const added = r.sources.reduce((a, s) => a + s.added, 0);
    const failed = r.sources.filter((s) => s.status !== "ok");
    return { ok: failed.length === 0, message: `${added} new item(s) from ${r.sources.length} source(s); ${r.matched} delivered to users.${failed.length ? ` Failed: ${failed.map((f) => `${f.source} (${f.status})`).join("; ")}` : ""}${r.ai ? "" : " AI summaries are off (no AI provider configured)."}` };
  } catch (e) { return fail(e); }
}

export async function saveBook(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const parsed = z.object({
      title: z.string().trim().min(1).max(200), author: z.string().trim().min(1).max(200), category: z.string().min(1),
      improvement_area: z.string().trim().min(1).max(120), description: opt(2000), cover_url: httpsUrl, reading_url: httpsUrl, free_download_url: httpsUrl,
      license: z.enum(["public_domain", "open_access", "commercial"]),
    }).safeParse(Object.fromEntries(["title", "author", "category", "improvement_area", "description", "cover_url", "reading_url", "free_download_url", "license"].map((k) => [k, fd.get(k) ?? undefined])));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    if (parsed.data.free_download_url && parsed.data.license === "commercial") return { ok: false, message: "Free download links are only allowed for public-domain or open-access works." };
    const row = { ...parsed.data, active: fd.get("active") === "on" };
    const { error } = id ? await supabase.from("books").update(row).eq("id", id) : await supabase.from("books").insert(row);
    if (error) return fail(error);
    return done("/settings/books", "Book saved.");
  } catch (e) { return fail(e); }
}

export async function saveQuote(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const parsed = z.object({
      text: z.string().trim().min(5).max(500), author: z.string().trim().min(1, "Attribution is required").max(120), source: opt(200),
      category: z.enum(["discipline", "consistency", "success", "business", "leadership", "excellence", "personal_growth", "productivity"]),
    }).safeParse({ text: fd.get("text"), author: fd.get("author"), source: fd.get("source") ?? undefined, category: fd.get("category") });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const row = { ...parsed.data, active: fd.get("active") === "on" };
    const { error } = id ? await supabase.from("motivational_quotes").update(row).eq("id", id) : await supabase.from("motivational_quotes").insert(row);
    if (error) return fail(error.message.includes("duplicate") ? new Error("This quote already exists.") : error);
    return done("/settings/quotes", "Quote saved.");
  } catch (e) { return fail(e); }
}

export async function saveKbDoc(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const audience = (["team_member", "administrator", "super_admin"] as const).filter((r) => fd.get(`aud_${r}`) === "on");
    if (!audience.length) return { ok: false, message: "Select at least one audience." };
    const parsed = z.object({
      slug: z.string().trim().regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, numbers and dashes"), title: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1).max(20000), link: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || v.startsWith("/"), "Link must be an in-app path like /tasks"),
    }).safeParse({ slug: fd.get("slug"), title: fd.get("title"), content: fd.get("content"), link: fd.get("link") ?? undefined });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const row = { ...parsed.data, audience: [...audience], active: fd.get("active") === "on" };
    const { error } = id ? await supabase.from("knowledge_base_documents").update(row).eq("id", id) : await supabase.from("knowledge_base_documents").insert(row);
    if (error) return fail(error);
    return done("/settings/lex", "Knowledge base article saved.");
  } catch (e) { return fail(e); }
}

export async function saveCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const supabase = await su();
    const kind = z.enum(["task", "service"]).parse(fd.get("type"));
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const name = z.string().trim().min(1).max(80).parse(fd.get("name"));
    const active = fd.get("active") === "on";
    let error;
    if (kind === "task") {
      const row = { name, kind: z.enum(["daily", "additional"]).parse(fd.get("kind")), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).parse(fd.get("color")), active };
      ({ error } = id ? await supabase.from("task_categories").update(row).eq("id", id) : await supabase.from("task_categories").insert(row));
    } else {
      const keywords = String(fd.get("keywords") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 30);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      ({ error } = id ? await supabase.from("service_categories").update({ name, keywords, active }).eq("id", id)
        : await supabase.from("service_categories").insert({ name, slug, keywords, active }));
    }
    if (error) return fail(error);
    return done("/settings/categories", "Category saved.");
  } catch (e) { return fail(e); }
}
