/* Normie Quest — minimal service worker.
 *
 * Purpose: make the game an installable PWA (Add to Home Screen / dApp Store TWA) and
 * give it an offline fallback. Deliberately conservative so it can NEVER serve a stale
 * game after a deploy:
 *   - navigations (the game page)  -> network-FIRST, cache fallback only when offline
 *   - static assets (icons, fonts) -> stale-while-revalidate
 *   - /api/*                       -> never touched (always live network)
 * Served from the site root (scope "/") so it can control /normie-quest-x7.
 */
'use strict';

var CACHE = 'nq-v1';
var ASSETS = [
  '/nq-assets/icon-192.png',
  '/nq-assets/icon-512.png',
  '/nq-assets/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // let cross-origin (fonts CDN, RPC) go straight to network
  if (url.pathname.indexOf('/api/') === 0) return;       // never cache API calls

  // Navigations (the game document): always try the network first so a fresh deploy wins;
  // fall back to the last cached copy only when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('/normie-quest-x7'); });
      })
    );
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
