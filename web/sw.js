const CACHE_NAME = 'awh-shell-__AWH_WEB_RELEASE_ID__';
const APP_SHELL = ['./', './index.html', './styles.css?release=__AWH_WEB_RELEASE_ID__', './app.js?release=__AWH_WEB_RELEASE_ID__', './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__', './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__', './manifest.webmanifest?release=__AWH_WEB_RELEASE_ID__', './logo-256x256.png?release=__AWH_WEB_RELEASE_ID__'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('awh-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  const staticAsset = ['document', 'script', 'style', 'image', 'manifest'].includes(request.destination);
  if (!staticAsset) return;
  if (request.destination === 'document') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request)));
});
