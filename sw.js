// Service worker Keel: показывает напоминания, которые присылает GitHub Actions
// из репозитория с данными (.github/remind.mjs), и открывает Keel по нажатию.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let m;
  try { m = e.data.json(); } catch { m = { title: "Keel", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Keel", {
    body: m.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: m.key || "keel", data: { url: m.url || "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); if (win.navigate) await win.navigate(url); return; }
    await self.clients.openWindow(url);
  })());
});
