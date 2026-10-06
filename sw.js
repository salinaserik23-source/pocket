/* Pocket service worker: offline app shell.
   - Precaches the shell (relative to this file, so it works under any subfolder such as /pocket/).
   - Cache-first with a background refresh (stale-while-revalidate) for same-origin GET requests inside this scope.
   - On activate, deletes only older 'pocket-shell-' caches. It never touches other caches or any registration. */
'use strict';

var CACHE = 'pocket-shell-v1.1.2';
var PRECACHE = ['./', 'index.html', 'design/icons/apple-touch-icon.png', 'design/icons/icon-192.png'];

function abs(path) { return new URL(path, self.location.href).href; }

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE.map(function (p) { return new Request(abs(p), { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('pocket-shell-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/** Fetch from the network (revalidating the HTTP cache) and store ok, same-origin ('basic'), non-redirected responses under `key`. */
function refresh(cache, url, key) {
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (res && res.ok && res.type === 'basic' && !res.redirected) return cache.put(key, res.clone()).then(function () { return res; });
    return res;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;                                   // non-GET: untouched
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // cross-origin: untouched
  if (url.href.indexOf(self.registration.scope) !== 0) return;        // outside this scope: untouched

  var isNav = req.mode === 'navigate';
  // Navigations are stored without their query string, so ?today=YYYY-MM-DD opens offline too.
  var key = isNav ? url.origin + url.pathname : req.url;

  event.respondWith(caches.open(CACHE).then(function (cache) {
    var cached = isNav ? cache.match(key, { ignoreSearch: true }) : cache.match(req);
    return cached.then(function (hit) {
      var update = refresh(cache, key, key);
      if (hit) {
        event.waitUntil(update.catch(function () {}));                 // background refresh; offline is fine
        return hit;
      }
      return update.catch(function (err) {
        if (!isNav) throw err;
        return cache.match(abs('./')).then(function (r) { return r || cache.match(abs('index.html')); })
          .then(function (r) { if (r) return r; throw err; });
      });
    });
  }));
});
