"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { removePushSubscription, savePushSubscription, sendTestPushToMe } from "@/server/actions/notifications";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<"unsupported" | "unconfigured" | "off" | "on" | "denied" | "loading">("loading");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
      // Browser-only state (URL fragment / Push API) is only readable after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!vapidKey) return setState("unconfigured");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.register("/sw.js").then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off")).catch(() => setState("unsupported"));
  }, [vapidKey]);

  async function enable() {
    setMsg(null);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
    setMsg(r?.message ?? null);
    setState(r?.ok ? "on" : "off");
  }
  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
  }

  const text: Record<typeof state, string> = {
    loading: "Checking browser support…", unsupported: "This browser does not support push notifications.",
    unconfigured: "Browser push is not configured on this server (VAPID keys missing).", denied: "Notifications are blocked in your browser settings.",
    off: "Get reminders on this device even when Winners Team is closed.", on: "Browser notifications are enabled on this device.",
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-alt px-4 py-3">
      <span className="text-body-md text-muted-text">{msg ?? text[state]}</span>
      {state === "off" && <Button size="sm" icon="notifications_active" onClick={enable}>Enable browser notifications</Button>}
      {state === "on" && (
        <span className="flex flex-wrap gap-2">
          <Button size="sm" icon="notifications_active" onClick={async () => { setMsg("Sending…"); const r = await sendTestPushToMe(); setMsg(r?.message ?? null); }}>Send a test notification</Button>
          <Button size="sm" variant="outline" icon="notifications_off" onClick={disable}>Disable on this device</Button>
        </span>
      )}
    </div>
  );
}
