/* =========================================================
   VETRA service worker: what makes the customer, vendor and rider
   apps installable and lets them open without a connection.
   Registered by pwa.js from the site root, so one worker covers both
   installable apps: "VETRA" for buyers and vendors (manifest.webmanifest)
   and "VETRA Rider" (rider/manifest.webmanifest).

   - Pages: network first, so people always get the latest deploy;
     the last copy seen is used when offline, then offline.html.
   - Scripts and styles: network first too (a new page must never run
     with the previous deploy's JS), cached copy only when offline.
   - Images and fonts: served from cache immediately and refreshed in
     the background (stale-while-revalidate).
   - API calls (api.vetrahq.org) and anything not GET are never touched:
     orders, payments and sessions must always be live.

   Bump VERSION when this file's caching rules change; old caches are
   deleted on activate.
   ========================================================= */

const VERSION = "v1";
const PAGES = `vetra-pages-${VERSION}`;
const ASSETS = `vetra-assets-${VERSION}`;
const MAX_ASSET_ENTRIES = 250;
const MAX_PAGE_ENTRIES = 60;

const PRECACHE = [
  "offline.html",
  "app.html",
  "vetra-tokens.css",
  "surface.css",
  "theme.js",
  "pwa.js",
  "assets/brand/app/icon-192.png",
  "assets/brand/logo-full.png",
  "assets/brand/logo-full-white.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSETS).then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, ASSETS]);
      for (const key of await caches.keys()) {
        if (key.startsWith("vetra-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      // Stored without the query string, so ?source=pwa or ?q=... don't
      // fill the cache with copies of the same page.
      const url = new URL(request.url);
      url.search = "";
      cache.put(url.href, response.clone()).then(() => trim(PAGES, MAX_PAGE_ENTRIES));
    }
    return response;
  } catch (err) {
    const url = new URL(request.url);
    url.search = "";
    return (
      (await cache.match(url.href)) ||
      (await caches.match(new URL("offline.html", self.registration.scope).href)) ||
      new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(ASSETS);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone()).then(() => trim(ASSETS, MAX_ASSET_ENTRIES));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(event.request, response.clone()).then(() => trim(ASSETS, MAX_ASSET_ENTRIES));
      }
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API, payments, chat widget: always live

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (/\.(?:css|js)$/i.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/* ---------- Push notifications (backend/src/utils/push.js, push.js) ----------
   Every in-app notification also arrives here when the user turned
   notifications on, and shows on the lock screen even with VETRA closed.
   Tapping it opens (or focuses) the page it's about. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const scope = self.registration.scope;
  const options = {
    body: data.body || "",
    icon: new URL("assets/brand/app/icon-192.png", scope).href,
    badge: new URL("assets/brand/app/icon-192.png", scope).href,
    data: { url: data.url || new URL("app.html", scope).href },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(data.title || "VETRA", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "app.html";
  let target = new URL(raw, self.registration.scope);
  // Only ever open this site.
  if (target.origin !== self.location.origin) target = new URL("app.html", self.registration.scope);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target.href && "focus" in client) return client.focus();
      }
      // An open VETRA window: reuse it instead of stacking new ones.
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin && "navigate" in c);
      if (open) {
        try {
          await open.navigate(target.href);
          return open.focus();
        } catch (err) {
          /* navigate() is refused for an uncontrolled window; fall through */
        }
      }
      return self.clients.openWindow(target.href);
    })()
  );
});

// The browser replaced the subscription (keys rotated): register the new
// one. The next page load re-sends it with the user's token too (push.js).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "vetra-push-resync" }));
    })()
  );
});
