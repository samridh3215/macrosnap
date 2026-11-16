const VERSION = "macrosnap-v28";
const SHELL = ["/", "/index.html", "/styles.css", "/manifest.webmanifest", "/icons/icon-192.png",
  "/js/main.js", "/js/api.js", "/js/util.js", "/js/today.js", "/js/review.js", "/js/foods.js", "/js/trends.js", "/js/settings.js", "/js/charts.js", "/js/camera.js", "/js/onboarding.js", "/js/login.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "shared").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Android share sheet → POST /share with the photo. Stash it, then open the app.
  if (e.request.method === "POST" && url.pathname === "/share") {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.getAll("image").find((f) => f && f.size);
      const text = [form.get("title"), form.get("text")].filter(Boolean).join(" ").trim();
      const cache = await caches.open("shared");
      if (file) await cache.put("/shared-image", new Response(file, { headers: { "content-type": file.type || "image/jpeg" } }));
      if (text) await cache.put("/shared-text", new Response(text));
      return Response.redirect("/?shared=1#/today", 303);
    })());
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // App shell: network-first so updates land immediately; cache fallback offline.
  // cache: "no-cache" revalidates with the server, so an old copy in the browser cache never mixes with new files.
  e.respondWith(fetch(e.request, { cache: "no-cache" })
    .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("/index.html"))));
});
