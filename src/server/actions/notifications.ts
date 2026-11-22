"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUser } from "@/lib/auth";
import { NOTIFICATION_CATEGORIES } from "@/lib/labels";
import type { ActionResult } from "@/components/ui/client";

export async function savePreferences(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const channels: Record<string, { in_app: boolean; email: boolean; push: boolean }> = {};
    for (const [key] of NOTIFICATION_CATEGORIES) {
      channels[key] = { in_app: fd.get(`${key}.in_app`) === "on", email: fd.get(`${key}.email`) === "on", push: fd.get(`${key}.push`) === "on" };
    }
    const supabase = await createClient();
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: me.id, channels, email_enabled: fd.get("email_enabled") === "on", push_enabled: fd.get("push_enabled") === "on",
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/notifications");
    return { ok: true, message: "Notification preferences saved." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Save failed" }; }
}

export async function markNotificationRead(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await assertUser();
  const id = z.string().uuid().parse(fd.get("id"));
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/notifications");
  return { ok: true, message: "Marked as read" };
}

export async function markAllRead(_prev: ActionResult): Promise<ActionResult> {
  await assertUser();
  const supabase = await createClient();
  await supabase.rpc("mark_all_notifications_read");
  revalidatePath("/notifications");
  return { ok: true, message: "All notifications marked as read" };
}

const subSchema = z.object({ endpoint: z.string().url().startsWith("https://"), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

export async function savePushSubscription(sub: unknown, userAgent: string): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const s = subSchema.parse(sub);
    const supabase = await createClient();
    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: me.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: userAgent.slice(0, 300) }, { onConflict: "endpoint" });
    if (error) return { ok: false, message: error.message };
    await supabase.from("notification_preferences").update({ push_enabled: true }).eq("user_id", me.id);
    revalidatePath("/notifications");
    return { ok: true, message: "Browser notifications enabled on this device." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Could not save subscription" }; }
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  await assertUser();
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  revalidatePath("/notifications");
  return { ok: true, message: "Browser notifications disabled on this device." };
}

export async function sendTestPushToMe(): Promise<ActionResult> {
  try {
    const me = await assertUser();
    const { sendTestPush } = await import("@/server/delivery");
    const r = await sendTestPush(me.id);
    if (!r.configured) return { ok: false, message: "Browser push is not configured on the server." };
    if (r.devices === 0) return { ok: false, message: "No device is registered yet — enable browser notifications first." };
    return r.sent ? { ok: true, message: `Test notification sent to ${r.sent} device(s). It should pop up in a few seconds.` }
      : { ok: false, message: "The notification could not be delivered. Turn browser notifications off and on again on this device." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Test failed" }; }
}
