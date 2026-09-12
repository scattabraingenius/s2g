const CACHE_NAME = "scattabrain-unified-shell-v5-99d58d27dd07";
// Cache Storage is per-origin, not per service-worker scope: /the-grind/ and /s2g/ share one
// origin (scattabraingenius.github.io), so an unqualified CACHE_NAME could let one site's
// activate cleanup delete the other site's live cache once their content hashes diverge.
// Suffix the cache key by the registering scope's path so each site only ever opens and
// cleans up its own caches. The suffix is appended (not prepended) so CACHE_KEY still starts
// with the plain CACHE_NAME string that existing tooling matches against.
const SCOPE_ID = new URL(self.registration.scope).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "root";
const SITE_SUFFIX = ":" + SCOPE_ID;
const CACHE_KEY = CACHE_NAME + SITE_SUFFIX;
const APP_SHELL = [
  "./",
  "./index.html",
  "./mm-home/",
  "./mm-home/index.html",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./mm-home-icon-64.png",
  "./mm-home-icon-512.png",
  "./icons/nav/neon-atlas.png",
  "./icons/nav/family-all.png",
  "./icons/nav/family-portraits.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_KEY).then(cache => cache.addAll(APP_SHELL.map(url=>new Request(url,{cache:"reload"})))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("scattabrain-unified-shell-") && key.endsWith(SITE_SUFFIX) && key !== CACHE_KEY).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  if(request.mode === "navigate"){
    event.respondWith(
      fetch(new Request(request,{cache:"no-cache"})).then(response => {
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_KEY).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(request).then(response => response ||
          (url.pathname.includes("/mm-home/") ? caches.match("./mm-home/index.html") : caches.match("./index.html")))
      )
    );
    return;
  }

  if(["style", "script", "image", "font", "manifest"].includes(request.destination)){
    event.respondWith(
      caches.match(request).then(cached => {
        const refreshed = fetch(request).then(response => {
          if(response && response.ok){
            const copy = response.clone();
            caches.open(CACHE_KEY).then(cache => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || refreshed;
      })
    );
  }
});
