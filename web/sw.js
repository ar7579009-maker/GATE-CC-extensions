// Offline-first service worker (replaces web/sw.js). Cache-first with background refresh:
// the app opens instantly from cache in airplane mode AND on "connected but no internet" Wi-Fi.
// v7 was network-first with no timeout, so on a dead hotspot every launch waited for the browser's own
// network timeout (often 30-60 s) before falling back to the cache.
const V = 'gcc-__BUILD__';
const SHELL = ['./', 'index.html', 'bundle.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // cache:'reload' skips the browser HTTP cache so a new build never precaches the previous build's files.
  e.waitUntil(caches.open(V).then((c) => Promise.all(SHELL.map((u) =>
    fetch(new Request(u, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return c.put(u === './' ? 'index.html' : u, r); })
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;                 // Supabase etc. pass straight through
  const key = r.mode === 'navigate' ? 'index.html' : r;                           // every page load is the single app shell
  e.respondWith((async () => {
    const c = await caches.open(V), hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(r).then((res) => { if (res.ok) c.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }                    // instant; refresh for the next launch
    return net.catch(() => (r.mode === 'navigate' ? c.match('index.html') : Response.error()));
  })());
});
