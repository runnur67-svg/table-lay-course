/* TABLE LAY PWA — all assets are relative so GitHub Pages project URLs work. */
const CACHE_NAME = 'tablelay-offline-v5-20261126-board-taps';
const APP_FILES = [
  './',
  './index.html',
  './static/app-v5.js',
  './static/sync-v5.js',
  './static/style-v5.css',
  './static/manifest.webmanifest',
  './static/icon.svg',
  './static/icon-180.png',
  './static/icon-192.png',
  './static/icon-512.png'
];
const SHELL = new URL('./index.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES.map(path => new URL(path, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tablelay-offline-') && k !== CACHE_NAME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept other projects under the same github.io origin.
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const fresh=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(SHELL, fresh)));
      }
      return response;
    }).catch(async () => (await caches.match(SHELL)) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request, {ignoreSearch:true})
    .then(cached => cached || fetch(request).then(response => {
      if(response.ok){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)));
      }
      return response;
    })));
});
