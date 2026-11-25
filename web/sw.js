/* Service worker: makes the site work offline. Network-first for this site's own files, cache as the fallback; the build fills in the version and the list of files.
   The host lets browsers reuse a file for 10 minutes without asking, so every request here asks the server whether it changed ("no-cache"), and the answer is handed to the page marked the same way, so the
   browser does not keep reusing it from memory. Otherwise a refresh can run old files or mix old and new ones. */
const CACHE = "nn-dashboard-@@VERSION@@";
const CORE = @@CORE@@;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const fresh = (res) => { if (res.type !== "basic") return res; const headers = new Headers(res.headers); headers.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers }); };
self.addEventListener("fetch", (e) => {          // network first, so updates show up straight away; the cache is the offline fallback
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return fresh(res); })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))));
});
