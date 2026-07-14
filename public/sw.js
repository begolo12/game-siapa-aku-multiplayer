const CACHE = "siapa-aku-v2";
const ASSETS = ["/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache API / websocket traffic
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached shell
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/").then((r) => r || fetch(req)))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
