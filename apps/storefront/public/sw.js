/*
 * Patron store service worker (registered by components/ServiceWorker.tsx).
 *
 * Only the app shell is cached: the offline page, the icons and the
 * build's hashed static files. Pages are always fetched from the network
 * (they may belong to a signed-in customer) and fall back to the offline
 * page when there is none. Nothing from another origin — the API — and no
 * request other than GET is ever touched, so API responses are never cached.
 */
const VERSION = 'patron-shell-v1';
const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// hashed build output never changes under the same name; art and icons may be regenerated
const IMMUTABLE = /^\/_next\/static\//;
const REFRESHED = /^\/(art|icons)\//;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the API and other hosts: straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (REFRESHED.test(url.pathname) || SHELL.includes(url.pathname)) {
    // stale-while-revalidate: instant from the cache, refreshed in the background
    event.respondWith(
      caches.open(VERSION).then((c) =>
        c.match(req).then((hit) => {
          const fresh = fetch(req)
            .then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            })
            .catch(() => hit || Response.error());
          return hit || fresh;
        }),
      ),
    );
  }
});
