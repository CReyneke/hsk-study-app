/* Stale-while-revalidate for the static app shell, so it opens (mostly) offline once
   visited. GitHub API sync calls are a different origin and are explicitly skipped
   below -- this worker must never intercept or cache those. */
const CACHE_NAME = "hsk3-study-v7";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.json",
  "./js/data.js",
  "./js/char-data.js",
  "./js/word-freq.js",
  "./js/state.js",
  "./js/strokes.js",
  "./js/ui.js",
  "./js/app.js",
  "./js/sync.js",
  "./vendor/hanzi-writer.min.js",
  "./ui-assets/pixel-font.ttf",
  "./ui-assets/icon-star.png",
  "./ui-assets/icon-coin.png"
];
// NOTE: stroke-data/*.json (655 files, ~1.4MB) is deliberately absent from the list
// above. Precaching it would make every install pay for data most sessions never open;
// instead the generic fetch handler below caches each character the first time it's
// actually viewed, so the characters you personally study become available offline
// while the rest cost nothing.

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(cached=>{
      const network = fetch(req).then(res=>{
        if(res && res.ok) caches.open(CACHE_NAME).then(c=>c.put(req, res.clone()));
        return res;
      }).catch(()=> cached);
      return cached || network;
    })
  );
});
