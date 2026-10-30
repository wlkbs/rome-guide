/* 코미꼬 로마 오디오 가이드 — 오프라인 서비스 워커 */
const BUILD = '6ec7dff0d4';
const SHELL = 'shell-v2-' + BUILD;
const CONTENT = 'content-v2';
const SHELL_FILES = ["./", "index.html", "app.css", "app.js", "lib/leaflet.js", "lib/leaflet.css", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "data/catalog.json", "data/check.7a576e28.bin", "maps/map_V.jpg", "maps/map_C.jpg"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== CONTENT).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = u.pathname.startsWith(scope) ? u.pathname.slice(scope.length) : u.pathname;
  if (rel.startsWith('c/')) {                       // 암호화된 오디오·사진·대본: 캐시 우선
    e.respondWith(caches.open(CONTENT).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (rel === '' || rel === 'index.html' || rel === 'data/catalog.json') {   // 앱 본체: 네트워크 우선, 안 되면 캐시
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(SHELL).then(c => c.put(req, cl)); } return r; })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match(scope + 'index.html') || caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
    if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(req, cl)); }
    return res;
  })).catch(() => new Response('', { status: 504 })));
});
