"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverSoon } from "@/server/deliverSoon";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import type { ActionResult } from "@/components/ui/client";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const list = (maxItems: number, maxLen: number) => z.string().optional().transform((v) =>
  (v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, maxItems).map((s) => s.slice(0, maxLen)));
const urlList = z.string().optional().transform((v) => (v ?? "").split(/\s|,/).map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().url("Portfolio links must be valid URLs").regex(/^https?:\/\//i, "Links must start with http(s)://")).max(10));

function err(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Update failed" };
}

export async function updateBasicInfo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    const me = await assertUser();
    const parsed = z.object({
      full_name: z.string().trim().min(2, "Full name is required").max(120),
      phone: opt(40).refine((v) => !v || /^[+0-9 ()-]+$/.test(v), "Invalid phone number"),
      job_title: opt(120), team_name: opt(120), team_leader_name: opt(120),
    }).safeParse(Object.fromEntries(["full_name", "phone", "job_title", "team_name", "team_leader_name"].map((k) => [k, fd.get(k) ?? undefined])));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    // Team leader's name does not apply to administrator accounts.
    const data = me.role === "team_member" ? parsed.data : { ...parsed.data, team_leader_name: null };
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update(data).eq("id", me.id);
    if (error) return err(error);
    revalidatePath("/profile");
    return { ok: true, message: "Basic information saved. Your administrator and the Super Admin have been notified." };
  } catch (e) { return err(e); }
}

export async function updateProfessionalInfo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    const me = await assertUser();
    const parsed = z.object({
      specialisations: list(20, 80), skills: list(40, 60), business_interests: list(20, 80),
      target_audience: opt(1000), portfolio_links: urlList,
    }).safeParse(Object.fromEntries(["specialisations", "skills", "business_interests", "target_audience", "portfolio_links"].map((k) => [k, fd.get(k) ?? undefined])));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update(parsed.data).eq("id", me.id);
    if (error) return err(error);
    revalidatePath("/profile");
    return { ok: true, message: "Professional information saved." };
  } catch (e) { return err(e); }
}

export async function saveService(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser();
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const parsed = z.object({
      name: z.string().trim().min(1, "Service name is required").max(120),
      description: opt(2000),
      category_id: z.string().uuid("Choose a category").or(z.literal("")).transform((v) => v || null),
      key_benefits: list(10, 120),
      target_audience: opt(500),
      portfolio_url: z.string().trim().optional().transform((v) => v || null)
        .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Portfolio/demo link must be a valid URL"),
    }).safeParse(Object.fromEntries(["name", "description", "category_id", "key_benefits", "target_audience", "portfolio_url"].map((k) => [k, fd.get(k) ?? undefined])));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("profile_services").update(parsed.data).eq("id", id)
      : await supabase.from("profile_services").insert(parsed.data);
    if (error) return err(error);
    revalidatePath("/profile");
    return { ok: true, message: id ? "Service updated." : "Service added." };
  } catch (e) { return err(e); }
}

export async function deleteService(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser();
    const id = z.string().uuid().parse(fd.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.from("profile_services").delete().eq("id", id);
    if (error) return err(error);
    revalidatePath("/profile");
    return { ok: true, message: "Service removed." };
  } catch (e) { return err(e); }
}

const AVATAR_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function uploadAvatar(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const file = fd.get("avatar");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image to upload." };
    if (!AVATAR_TYPES[file.type]) return { ok: false, message: "Use a PNG, JPEG or WebP image." };
    if (file.size > 2 * 1024 * 1024) return { ok: false, message: "The image must be 2 MB or smaller." };
    // Verify magic bytes rather than trusting the browser-supplied MIME type.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50; const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!(isPng || isJpg || isWebp)) return { ok: false, message: "The file is not a valid image." };
    const path = `${me.id}/avatar-${Date.now()}.${AVATAR_TYPES[file.type]}`;
    const supabase = await createClient();
    const { error } = await supabase.storage.from("avatars").upload(path, bytes, { contentType: file.type, upsert: false });
    if (error) return err(error);
    const { error: e2 } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", me.id);
    if (e2) return err(e2);
    if (me.avatar_path) await supabase.storage.from("avatars").remove([me.avatar_path]);
    revalidatePath("/", "layout");
    return { ok: true, message: "Profile photo updated." };
  } catch (e) { return err(e); }
}

export async function removeAvatar(_prev: ActionResult): Promise<ActionResult> {
  try {
    const me = await assertUser();
    if (!me.avatar_path) return { ok: true, message: "No photo to remove." };
    const supabase = await createClient();
    await supabase.from("profiles").update({ avatar_path: null }).eq("id", me.id);
    await supabase.storage.from("avatars").remove([me.avatar_path]);
    revalidatePath("/", "layout");
    return { ok: true, message: "Profile photo removed." };
  } catch (e) { return err(e); }
}
