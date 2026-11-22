import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, serverEnv } from "@/lib/env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emailHtml(title: string, body: string | null, link: string | null) {
  const url = link ? `${env.siteUrl}${link.startsWith("/") ? link : "/"}` : env.siteUrl;
  return `<!doctype html><html><body style="margin:0;background:#F9FAFB;font-family:Inter,Arial,sans-serif;color:#1F2937">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E5E7EB;border-radius:8px">
<tr><td style="background:#080808;padding:16px 24px;border-radius:8px 8px 0 0"><img src="${env.siteUrl}/brand/icon-192.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:6px"> <span style="color:#fff;font-weight:700;font-size:16px;vertical-align:middle">&nbsp;Winners Team</span></td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 8px;font-size:20px;color:#090C1D">${esc(title)}</h1>
${body ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#4B5563">${esc(body)}</p>` : ""}
<a href="${esc(url)}" style="display:inline-block;background:#5a45cb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;font-size:14px">Open Winners Team</a></td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E5E7EB;font-size:12px;color:#9CA3AF">You can change which e-mails you receive under Notifications → Preferences.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const { resendApiKey, emailFrom } = serverEnv();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Deliver pending e-mail and push notifications. Idempotent and bounded per run. */
export async function dispatchNotifications(limit = 200) {
  const db = createAdminClient();
  const cfg = serverEnv();
  const emailOn = Boolean(cfg.resendApiKey && cfg.emailFrom);
  const pushOn = Boolean(env.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject);
  if (pushOn) setVapidDetails(cfg.vapidSubject, env.vapidPublicKey, cfg.vapidPrivateKey);
  const out = { email: { sent: 0, failed: 0, skipped: 0 }, push: { sent: 0, failed: 0, skipped: 0 }, emailConfigured: emailOn, pushConfigured: pushOn };

  const { data: emails } = await db.from("notifications").select("id,title,body,link,attempts,user:profiles!notifications_user_id_fkey(email,status)")
    .eq("email_status", "pending").order("created_at").limit(limit);
  for (const n of emails ?? []) {
    const user = n.user as unknown as { email: string; status: string } | null;
    if (!emailOn || !user || user.status === "removed" || user.status === "deactivated") {
      await db.from("notifications").update({ email_status: "skipped" }).eq("id", n.id);
      await db.from("notification_delivery_logs").insert({ notification_id: n.id, channel: "email", status: "skipped", detail: emailOn ? "inactive account" : "e-mail provider not configured" });
      out.email.skipped++; continue;
    }
    // Claim the row first (optimistic lock on `attempts`) so concurrent runs never double-send.
    const { data: claimed } = await db.from("notifications").update({ attempts: n.attempts + 1 })
      .eq("id", n.id).eq("email_status", "pending").eq("attempts", n.attempts).select("id");
    if (!claimed?.length) continue;
    try {
      await sendEmail(user.email, `Winners Team: ${n.title}`, emailHtml(n.title, n.body, n.link));
      await db.from("notifications").update({ email_status: "sent" }).eq("id", n.id);
      await db.from("notification_delivery_logs").insert({ notification_id: n.id, channel: "email", status: "sent" });
      out.email.sent++;
    } catch (e) {
      const final = n.attempts + 1 >= 3;
      await db.from("notifications").update({ email_status: final ? "failed" : "pending" }).eq("id", n.id);
      await db.from("notification_delivery_logs").insert({ notification_id: n.id, channel: "email", status: "failed", detail: e instanceof Error ? e.message.slice(0, 300) : "error" });
      out.email.failed++;
    }
  }

  const { data: pushes } = await db.from("notifications").select("id,user_id,title,body,link").eq("push_status", "pending").order("created_at").limit(limit);
  for (const n of pushes ?? []) {
    const { data: claimedPush } = await db.from("notifications").update({ push_status: "skipped" })
      .eq("id", n.id).eq("push_status", "pending").select("id");
    if (!claimedPush?.length) continue;
    const { data: subs } = pushOn ? await db.from("push_subscriptions").select("*").eq("user_id", n.user_id) : { data: [] };
    if (!pushOn || !subs?.length) {
      await db.from("notifications").update({ push_status: "skipped" }).eq("id", n.id);
      out.push.skipped++; continue;
    }
    let ok = 0;
    for (const s of subs) {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body ?? "", link: n.link ?? "/notifications", tag: n.id }), { TTL: 3600 });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    await db.from("notifications").update({ push_status: ok ? "sent" : "failed" }).eq("id", n.id);
    await db.from("notification_delivery_logs").insert({ notification_id: n.id, channel: "push", status: ok ? "sent" : "failed", detail: `${ok}/${subs.length} devices` });
    if (ok) out.push.sent++; else out.push.failed++;
  }
  return out;
}

/** Send a test push to every device the given user has enabled. */
export async function sendTestPush(userId: string) {
  const cfg = serverEnv();
  if (!(env.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject)) return { sent: 0, devices: 0, configured: false };
  setVapidDetails(cfg.vapidSubject, env.vapidPublicKey, cfg.vapidPrivateKey);
  const db = createAdminClient();
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: "Winners Team", body: "Browser notifications are working on this device. 🎉", link: "/notifications", tag: "test-push" }), { TTL: 600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      console.error("test push failed", code, e instanceof Error ? e.message : e);
    }
  }
  return { sent, devices: subs?.length ?? 0, configured: true };
}
