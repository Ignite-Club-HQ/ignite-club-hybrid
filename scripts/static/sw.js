/*
 * Ignite service worker (shipped by scripts/build-preview.mjs as dist/sw.js).
 *
 * Main job: page-refresh fallback. The Lovable static hosting for this
 * project only serves "/" — any refresh or opened link on a deeper address
 * (/auth, /messages, /teams/123 …) answers a plain-text "Not Found". When a
 * page load comes back 404, this worker answers with the app shell from "/"
 * instead, keeping the address so the app opens the right screen.
 *
 * Also handles web push display + taps so the push manager can share it.
 */
const SHELL_URL = "/";
const CACHE_NAME = "ignite-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("ignite-shell-") && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function shellResponse() {
  try {
    const fresh = await fetch(SHELL_URL, { cache: "no-store" });
    if (fresh.ok && !fresh.redirected) {
      const copy = fresh.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {});
      return fresh;
    }
  } catch {
    /* offline — fall through to the cached shell */
  }
  const cached = await caches.match(SHELL_URL);
  return cached || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.status !== 404) return response;
      } catch {
        /* network failure — serve the shell */
      }
      return shellResponse();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Ignite";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      badge: data.badge || "/badge-96.png",
      tag: data.tag,
      data: { url: data.url || (data.data && data.data.url) || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
