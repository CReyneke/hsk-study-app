/* Stale-while-revalidate for the static app shell, so it opens (mostly) offline once
   visited. GitHub API sync calls are a different origin and are explicitly skipped
   below -- this worker must never intercept or cache those. */
const CACHE_NAME = "hsk3-study-v3";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.json",
  "./js/data.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/app.js",
  "./js/sync.js",
  "./ui-assets/pixel-font.ttf",
  "./ui-assets/icon-star.png",
  "./ui-assets/icon-coin.png"
];

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
