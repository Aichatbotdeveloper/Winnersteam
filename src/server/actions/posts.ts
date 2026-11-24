"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUser } from "@/lib/auth";
import { deliverSoon } from "@/server/deliverSoon";
import type { ActionResult } from "@/components/ui/client";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong" });
const str = (fd: FormData, k: string) => { const v = fd.get(k); return v === null ? "" : String(v).trim(); };
const FILE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** Validate an optional attachment (image or PDF, magic bytes checked). Returns null when none was chosen. */
async function readFile(fd: FormData, key: string, maxMb: number) {
  const f = fd.get(key);
  if (!(f instanceof File) || f.size === 0) return null;
  if (!FILE_EXT[f.type]) throw new Error("Use a PNG, JPEG or WebP image, or a PDF.");
  if (f.size > maxMb * 1024 * 1024) throw new Error(`The file must be ${maxMb} MB or smaller.`);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const ok = (bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8)
    || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  if (!ok) throw new Error("That file doesn't look like an image or PDF.");
  return { bytes, type: f.type, ext: FILE_EXT[f.type]! };
}

// ----------------------------------------------------------------- events ----
export async function saveEvent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    const me = await assertUser(["super_admin"]);
    const id = fd.get("id") ? z.string().uuid().parse(fd.get("id")) : null;
    const when = `${str(fd, "date")}T${str(fd, "time")}`;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return { ok: false, message: "Choose the date and time" };
    const supabase = await createClient();
    const file = await readFile(fd, "image", 5);
    let image: string | undefined;
    if (file) {
      image = `${me.id}/event-${Date.now()}.${file.ext}`;
      const up = await supabase.storage.from("posts").upload(image, file.bytes, { contentType: file.type });
      if (up.error) return fail(up.error);
    }
    const { error } = await supabase.rpc("save_event", { p_id: id as string, p_title: str(fd, "title"), p_description: str(fd, "description") || (null as unknown as string),
      p_location: str(fd, "location") || (null as unknown as string), p_starts_at: when + ":00", p_audience: str(fd, "audience") || "everyone",
      p_image_path: image, p_email: fd.get("email") === "on" });
    if (error) return fail(error);
    revalidatePath("/events");
    return { ok: true, message: id ? "Event updated. Everyone affected has been told about any change of time or place." : "Event posted. Everyone has been notified." };
  } catch (e) { return fail(e); }
}

export async function cancelEvent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser(["super_admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_event", { p_id: z.string().uuid().parse(fd.get("id")), p_reason: str(fd, "reason") || undefined });
    if (error) return fail(error);
    revalidatePath("/events");
    return { ok: true, message: "Event cancelled. Everyone has been told." };
  } catch (e) { return fail(e); }
}

export async function rsvpEvent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser();
    const supabase = await createClient();
    const response = fd.get("response") === "going" ? "going" : "not_going";
    const { error } = await supabase.rpc("rsvp_event", { p_id: z.string().uuid().parse(fd.get("id")), p_response: response });
    if (error) return fail(error);
    revalidatePath("/events");
    return { ok: true, message: response === "going" ? "Great — you're down as attending." : "Thanks for letting us know." };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------- updates ----
export async function submitUpdate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser(["team_member", "administrator"]);
    const supabase = await createClient();
    const file = await readFile(fd, "attachment", 5);
    let path: string | undefined;
    if (file) {
      path = `${me.id}/update-${Date.now()}.${file.ext}`;
      const up = await supabase.storage.from("posts").upload(path, file.bytes, { contentType: file.type });
      if (up.error) return fail(up.error);
    }
    const { error } = await supabase.rpc("submit_update", { p_kind: str(fd, "kind"), p_title: str(fd, "title"), p_body: str(fd, "body"),
      p_link: str(fd, "link") || undefined, p_attachment_path: path });
    if (error) { if (path) await supabase.storage.from("posts").remove([path]); return fail(error); }
    revalidatePath("/updates");
    return { ok: true, message: "Thank you! The Super Admin will review your update." };
  } catch (e) { return fail(e); }
}

export async function reviewUpdate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    deliverSoon();
    await assertUser(["super_admin"]);
    const publish = fd.get("decision") === "publish";
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("review_update", { p_id: z.string().uuid().parse(fd.get("id")), p_publish: publish,
      p_title: str(fd, "title") || undefined, p_body: str(fd, "body") || undefined, p_audience: str(fd, "audience") || "everyone",
      p_email: fd.get("email") === "on", p_note: str(fd, "note") || undefined });
    if (error) return fail(error);
    revalidatePath("/updates");
    return { ok: true, message: publish ? `Published to ${data} people.` : "Marked as not published. The sender has been told." };
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------- complaints ----
export async function submitComplaint(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["team_member", "administrator"]);
    const file = await readFile(fd, "attachment", 5);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_complaint", { p_category: str(fd, "category"), p_body: str(fd, "body"), p_anonymous: fd.get("anonymous") === "on" });
    if (error) return fail(error);
    const r = data as { id: string; code: string };
    if (file) {
      // Uploaded by the server so the file carries no link to the sender.
      const db = createAdminClient();
      const path = `${r.id}/attachment.${file.ext}`;
      const up = await db.storage.from("complaint-files").upload(path, file.bytes, { contentType: file.type });
      if (!up.error) await db.from("complaints").update({ attachment_path: path }).eq("id", r.id);
    }
    revalidatePath("/complaints");
    return { ok: true, message: "Your complaint has been sent to the Super Admin.", data: { code: r.code } };
  } catch (e) { return fail(e); }
}

export async function manageComplaint(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("manage_complaint", { p_id: z.string().uuid().parse(fd.get("id")), p_status: str(fd, "status"),
      p_notes: str(fd, "notes") || undefined, p_reply: str(fd, "reply") || undefined });
    if (error) return fail(error);
    revalidatePath("/super-admin/complaints");
    return { ok: true, message: "Saved." };
  } catch (e) { return fail(e); }
}
