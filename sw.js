/* O âmbito é o diretório desta PWA; só removemos caches com o nosso prefixo. */
const CACHE_NAME = "assistente-fiscal-pt-shell-v15";
const CACHE_PREFIX = "assistente-fiscal-pt-";
const SHELL = [
  "./", "./index.html", "./styles.css?v=0.5.0", "./app.js?v=0.5.4", "./manifest.webmanifest?v=0.4.0",
  "./assets/icon-192.png?v=0.4.0", "./assets/icon-512.png?v=0.4.0", "./assets/icon.svg",
  "./vendor/jszip.min.js", "./vendor/pdf.min.mjs", "./vendor/pdf.worker.min.mjs"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }
  if (url.pathname.endsWith("/data/legal-index.json")) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request,response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    }));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});
