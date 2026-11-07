/* Service worker ZanTV v1.7.43.
   - Halaman, CSS, dan JS: ambil dari jaringan dulu (selalu versi terbaru), cadangan dari cache saat offline.
   - Pustaka di /vendor/ (nama file berversi): dari cache dulu.
   - /api/ dan stream video tidak pernah disimpan. */
var VERSION = 'zantv-v1.7.43';
var SHELL = [
  './',
  './index.html',
  './style.css?v=1.7.43',
  './app.js?v=1.7.43',
  './zan-sig.js?v=1.7.43',
  './zan-sports.js?v=1.7.43',
  './zan-vod.js?v=1.7.43',
  './zan-movie.js?v=1.7.43',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  if (url.pathname.indexOf('/vendor/') === 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }

  e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req.mode === 'navigate' ? './index.html' : req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req.mode === 'navigate' ? './index.html' : req);
  }));
});
