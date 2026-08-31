const CACHE_NAME = 'awh-shell-__AWH_WEB_RELEASE_ID__';
const APP_SHELL = ['./', './index.html', './styles.css?release=__AWH_WEB_RELEASE_ID__', './awh-design-system.css?release=__AWH_WEB_RELEASE_ID__', './responsive-layout.css?release=__AWH_WEB_RELEASE_ID__', './navigation.js?release=__AWH_WEB_RELEASE_ID__', './dashboard.css?release=__AWH_WEB_RELEASE_ID__', './app.js?release=__AWH_WEB_RELEASE_ID__', './dashboard.js?release=__AWH_WEB_RELEASE_ID__', './execution-ux.js?release=__AWH_WEB_RELEASE_ID__', './tool-registry.js?release=__AWH_WEB_RELEASE_ID__', './school-tools.js?release=__AWH_WEB_RELEASE_ID__', './vendor/pdf-lib.min.js?release=__AWH_WEB_RELEASE_ID__', './vendor/qrcode.js?release=__AWH_WEB_RELEASE_ID__', './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__', './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__', './database.html', './database.css?release=__AWH_WEB_RELEASE_ID__', './database.js?release=__AWH_WEB_RELEASE_ID__', './infrastructure.html', './infrastructure.css?release=__AWH_WEB_RELEASE_ID__', './infrastructure.js?release=__AWH_WEB_RELEASE_ID__', './hosting.html', './hosting.css?release=__AWH_WEB_RELEASE_ID__', './hosting.js?release=__AWH_WEB_RELEASE_ID__', './trust.html', './trust.css?release=__AWH_WEB_RELEASE_ID__', './trust.js?release=__AWH_WEB_RELEASE_ID__', './review.html', './review.css?release=__AWH_WEB_RELEASE_ID__', './review.js?release=__AWH_WEB_RELEASE_ID__', './manifest.webmanifest?release=__AWH_WEB_RELEASE_ID__', './logo-256x256.png?release=__AWH_WEB_RELEASE_ID__'];

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
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request)));
});
