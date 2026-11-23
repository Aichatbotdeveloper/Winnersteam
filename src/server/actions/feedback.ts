"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertUser, getCurrentProfile } from "@/lib/auth";
import { deliverSoon } from "@/server/deliverSoon";
import type { ActionResult } from "@/components/ui/client";

const LIMIT_PER_HOUR = 5;

const schema = z.object({
  type: z.enum(["suggestion", "problem", "compliment", "other"], { message: "Choose what your feedback is about" }),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  message: z.string().trim().min(3, "Please write a short message").max(4000, "Please keep it under 4,000 characters"),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254).optional(),
  page: z.string().trim().max(300).optional(),
});

/** Public: visitors (email required) and signed-in members can send feedback. */
export async function submitFeedback(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    // Hidden field real people never fill in: quietly accept and drop bot submissions.
    if (String(fd.get("company") ?? "").trim()) return { ok: true, message: "Thank you! Your feedback has been sent." };
    const get = (k: string) => { const v = fd.get(k); return v === null || v === "" ? undefined : String(v); };
    const parsed = schema.safeParse({ type: get("type"), rating: get("rating"), message: get("message"), name: get("name"), email: get("email"), page: get("page") });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
    const me = await getCurrentProfile();
    const user = me && me.status === "approved" ? me : null;
    if (!user && !parsed.data.email) return { ok: false, message: "Please enter your email address so we can reply." };

    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0]!.trim();
    const ipHash = ip ? createHash("sha256").update(`wt-feedback:${ip}`).digest("hex") : null;

    const db = createAdminClient();
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const who = user ? `user_id.eq.${user.id}` : `email.eq.${parsed.data.email}`;
    const { count } = await db.from("feedback").select("id", { count: "exact", head: true }).gte("created_at", since)
      .or(ipHash ? `${who},ip_hash.eq.${ipHash}` : who);
    if ((count ?? 0) >= LIMIT_PER_HOUR) return { ok: false, message: "You've sent a lot of feedback in the last hour. Please try again a little later." };

    const { error } = await db.from("feedback").insert({
      user_id: user?.id ?? null,
      name: user ? user.full_name : parsed.data.name ?? null,
      email: user ? user.email : parsed.data.email!,
      type: parsed.data.type, rating: parsed.data.rating ?? null, message: parsed.data.message,
      page: parsed.data.page ?? null, ip_hash: ipHash,
    });
    if (error) return { ok: false, message: "Sorry, your feedback could not be sent. Please try again." };
    deliverSoon();
    return { ok: true, message: "Thank you! Your feedback has been sent." };
  } catch {
    return { ok: false, message: "Sorry, your feedback could not be sent. Please try again." };
  }
}

/** Super Admin: mark feedback as new / read / done. */
export async function setFeedbackStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertUser(["super_admin"]);
    const id = z.string().uuid().parse(fd.get("id"));
    const status = z.enum(["new", "read", "done"]).parse(fd.get("status"));
    const supabase = await createClient();
    const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/super-admin/feedback");
    return { ok: true, message: status === "done" ? "Marked as done" : status === "read" ? "Marked as read" : "Marked as new" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Update failed" }; }
}
