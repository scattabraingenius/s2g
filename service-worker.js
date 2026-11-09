const CACHE_NAME = "scattabrain-unified-shell-v5-4c1d2e7a9b30";
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
  "./mm/",
  "./mm/index.html",
  "./lyrics/",
  "./lyrics/index.html",
  "./lyrics/songs.js",
  "./lyrics/audio-links.js",
  "./lyrics/sync.js",
  "./lyrics/board.js",
  "./lyrics/board.css",
  "./lyrics/review.css",
  "./lyrics/review-tools.js",
  "./lyrics/lyric-review.js",
  "./audio/",
  "./audio/index.html",
  "./audio/classic.html",
  "./audio/tracks.js",
  "./audio/manifest.webmanifest",
  "./audio/album/",
  "./audio/album/index.html",
  "./audio/album/planner.js",
  "./audio/album/planner-sync.js",
  "./audio/album/planner-status.js",
  "./audio/album/planner.css",
  "./dash/",
  "./dash/index.html",
  "./dash/dashboard.js?v=20261108-runway2",
  "./dash/dashboard.css?v=20261108-runway2",
  "./dash/usage-widgets.js?v=20261108-runway2",
  "./lyrics/icons/lyric-notebook-32.png",
  "./lyrics/icons/lyric-notebook-180.png",
  "./lyrics/icons/lyric-notebook-192.png",
  "./lyrics/icons/lyric-notebook-512.png",
  "./lyrics/icons/lyric-notebook-maskable-512.png",
  "./audio/icons/audio-cassette-32.png",
  "./audio/icons/audio-cassette-180.png",
  "./audio/icons/audio-cassette-192.png",
  "./audio/icons/audio-cassette-512.png",
  "./audio/icons/audio-cassette-maskable-512.png",
  "./lyrics/manifest.webmanifest",
  "./lyrics/icons/album-cassette-32.png",
  "./lyrics/icons/album-cassette-180.png",
  "./lyrics/icons/album-cassette-192.png",
  "./lyrics/icons/album-cassette-512.png",
  "./lyrics/icons/album-cassette-maskable-512.png",
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
          (url.pathname.includes("/audio/") ? caches.match("./audio/index.html") : url.pathname.includes("/lyrics/") ? caches.match("./lyrics/index.html") : url.pathname.includes("/mm/") ? caches.match("./mm/index.html") : url.pathname.includes("/dash/") ? caches.match("./dash/index.html") : caches.match("./index.html")))
      )
    );
    return;
  }

  // Scripts, styles and manifests: try the network first so a new deploy shows up on the next load, not the one after.
  if(["style", "script", "manifest"].includes(request.destination)){
    event.respondWith(
      fetch(request).then(response => {
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_KEY).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if(["image", "font"].includes(request.destination)){
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
