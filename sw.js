/* Service worker: makes the site work offline. Cache-first for this site's own files; the build fills in the version and the list of files. */
const CACHE = "nn-dashboard-20261123214124";
const CORE = ["./", "./index.html", "./site.css", "./icon-192.png", "./demo/", "./demo/index.html", "./demo/static/dashboard.css", "./demo/static/dashboard.js", "./playground/", "./playground/index.html", "./playground/playground.js", "./contribute/", "./contribute/index.html", "./contribute/core.js", "./contribute/worker.js", "./contribute/contribute.js", "./contribute/phase_diagram.json", "./register-sw.js", "./play/", "./play/index.html", "./play/bot.js", "./play/driver.js", "./play/pixels781.json", "./demo/data/live.json", "./demo/data/1h.json", "./demo/data/6h.json", "./demo/data/24h.json", "./demo/data/7d.json", "./demo/data/all.json", "./demo/data/run.json", "./docs/PLAIN_ENGLISH.html", "./docs/README.html"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match("./index.html"))));
});
