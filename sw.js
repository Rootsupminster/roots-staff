// Roots Rota: keeps the app itself available offline. Rota data is never cached here.
const CACHE = 'roots-rota-v4';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // The manager (/manage/) and Money (/money/) apps are separate: never touch them,
  // so they can never be swapped for the staff page.
  const base = new URL('./', self.registration.scope).pathname;
  if (u.pathname.startsWith(base + 'manage') || u.pathname.startsWith(base + 'money')) return;
  // Network first so staff always get the newest app; fall back to the saved copy offline.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
