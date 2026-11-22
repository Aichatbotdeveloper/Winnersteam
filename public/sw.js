/* Winners Team service worker — browser push notifications only. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Winners Team", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Winners Team", {
    body: data.body || "", icon: "/brand/icon-192.png", badge: "/brand/icon-192.png", data: { link: data.link || "/notifications" }, tag: data.tag,
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.link ? event.notification.data.link : "/notifications", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url.href); return c.focus(); } }
    return self.clients.openWindow(url.href);
  }));
});
