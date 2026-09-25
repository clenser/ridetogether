/*
 * RideTogether service worker.
 *
 * Scope is deliberately narrow. It exists to make the app installable, to show
 * an offline notice when the network is gone, and to display Web Push
 * notifications. It is not a general-purpose cache: authenticated Supabase
 * traffic is never cached, because a cached API response would show one member
 * another member's rides on a shared device.
 */

const VERSION = "ride-together-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const SHELL_URL = "/index.html";
const OFFLINE_URL = "/offline.html";

/** Hashed build output, plus the files the app needs before any JS runs. */
const SHELL_ASSETS = [
  "/",
  SHELL_URL,
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `addAll` rejects the whole batch if any single file 404s, which would
      // leave the worker uninstalled. Caching each entry independently keeps a
      // missing optional asset from breaking the install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isSupabaseTraffic = (url) =>
  url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in");

const isMapTile = (url) =>
  url.hostname.includes("openfreemap.org")
  || url.hostname.includes("maptiler.com")
  || url.hostname.includes("tile.openstreetmap.org");

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch anything but safe, same-origin GETs. Skipping the rest keeps
  // RLS authoritative and leaves POST/PUT/DELETE for the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "https:" && url.origin !== self.location.origin) return;
  if (isSupabaseTraffic(url)) return;

  // Map tiles are large and immutable per style version: serve from cache first
  // and refresh in the background so a panned map keeps working offline.
  if (isMapTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached ?? Response.error());
        return cached ?? network;
      }),
    );
    return;
  }

  // Navigations: network first, so a deploy is picked up immediately, falling
  // back to the cached shell and then to the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(SHELL_URL))
            ?? (await cache.match(OFFLINE_URL))
            ?? new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }),
    );
    return;
  }

  // Same-origin static assets: cache first, they are content-hashed.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});

/* ---------------------------------------------------------------------------
 * Web Push
 * ------------------------------------------------------------------------- */

self.addEventListener("push", (event) => {
  // A push with no payload is still worth surfacing so a member learns that
  // something happened while the app was closed.
  let payload = { title: "RideTogether", body: "You have a new update." };
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed.title === "string") {
        // A same-origin path is trusted to stay in-app. `//host` is rejected too:
        // it is a protocol-relative URL, so allowing it would let a crafted
        // payload navigate a member off-site from what looks like our own window.
        const isSafePath = (value) =>
          typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
        payload = {
          title: parsed.title.slice(0, 80),
          body: typeof parsed.body === "string" ? parsed.body.slice(0, 240) : "",
          url: isSafePath(parsed.url) ? parsed.url : "/",
          tag: typeof parsed.tag === "string" ? parsed.tag.slice(0, 64) : "ride-together",
        };
      }
    } catch {
      // Keep the default copy rather than dropping the notification.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Tagging per member replaces that member's previous notification instead
      // of stacking a column of near-identical ones.
      tag: payload.tag ?? "ride-together",
      renotify: true,
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab rather than stacking duplicates.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          void client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("message", (event) => {
  // Lets the page trigger an immediate skipWaiting after an update is accepted.
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
