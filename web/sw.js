const CACHE_NAME = 'awh-shell-__AWH_WEB_RELEASE_ID__';
const APP_SHELL = ['./', './index.html', './styles.css?release=__AWH_WEB_RELEASE_ID__', './awh-design-system.css?release=__AWH_WEB_RELEASE_ID__', './awh-light-system.css?release=__AWH_WEB_RELEASE_ID__', './kruart-system.css?release=__AWH_WEB_RELEASE_ID__', './responsive-layout.css?release=__AWH_WEB_RELEASE_ID__', './navigation.js?release=__AWH_WEB_RELEASE_ID__', './dashboard.css?release=__AWH_WEB_RELEASE_ID__', './app.js?release=__AWH_WEB_RELEASE_ID__', './dashboard.js?release=__AWH_WEB_RELEASE_ID__', './execution-ux.js?release=__AWH_WEB_RELEASE_ID__', './tool-registry.js?release=__AWH_WEB_RELEASE_ID__', './school-tools.js?release=__AWH_WEB_RELEASE_ID__', './vendor/pdf-lib.min.js?release=__AWH_WEB_RELEASE_ID__', './vendor/qrcode.js?release=__AWH_WEB_RELEASE_ID__', './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__', './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__', './database.html', './database.css?release=__AWH_WEB_RELEASE_ID__', './database.js?release=__AWH_WEB_RELEASE_ID__', './infrastructure.html', './infrastructure.css?release=__AWH_WEB_RELEASE_ID__', './infrastructure.js?release=__AWH_WEB_RELEASE_ID__', './hosting.html', './hosting.css?release=__AWH_WEB_RELEASE_ID__', './hosting.js?release=__AWH_WEB_RELEASE_ID__', './trust.html', './trust.css?release=__AWH_WEB_RELEASE_ID__', './trust.js?release=__AWH_WEB_RELEASE_ID__', './review.html', './review.css?release=__AWH_WEB_RELEASE_ID__', './review.js?release=__AWH_WEB_RELEASE_ID__', './panel.html', './panel.css?release=__AWH_WEB_RELEASE_ID__', './panel.js?release=__AWH_WEB_RELEASE_ID__', './manifest.webmanifest?release=__AWH_WEB_RELEASE_ID__', './logo-256x256.png?release=__AWH_WEB_RELEASE_ID__', './assets/bay-mark.svg', './assets/bay-computer.svg', './assets/bay-shield.svg', './bay-golden-mark.svg?release=__AWH_WEB_RELEASE_ID__', './bay-golden-mascot.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-home.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-ecosystem.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-learnlab.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-apps.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-download.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-status.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-web.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-work.svg?release=__AWH_WEB_RELEASE_ID__', './bay-icon-school.svg?release=__AWH_WEB_RELEASE_ID__', './kruart-campus-bg.svg?release=__AWH_WEB_RELEASE_ID__', './kruart-hero-final.webp?release=__AWH_WEB_RELEASE_ID__', './kruart-app-icon-512.png?release=__AWH_WEB_RELEASE_ID__', './brand-kruart-workspace.webp?release=__AWH_WEB_RELEASE_ID__'];
const RUNTIME_VISUALS = new Set([
  './kruart-role-student-final.webp',
  './kruart-role-teacher-final.webp',
  './kruart-role-parent-final.webp',
  './kruart-role-staff-final.webp',
  './kruart-footer-final.webp',
  './kruart-logo-final.webp',
  './today-community.webp',
  './system-infrastructure.webp',
  './system-hosting.webp',
  './system-control-panel.webp',
  './project-school.webp',
  './project-parent-connect.webp',
  './project-learnlab.webp',
  './project-learnlab-overview.webp',
  './project-kruart-workspace.webp',
  './project-kruart-online.webp',
  './project-computer-lab.webp',
  './project-bay-excuse-x.webp',
  './project-awh.webp',
  './owner-control.webp',
  './news-school-activity.webp',
  './news-pride.webp',
  './news-learning.webp',
  './logo-school.webp',
  './logo-bay-learnlab.webp',
  './logo-bay-excuse-x.webp',
  './logo-bay-computer-lab.webp',
  './logo-bay-app.webp',
  './brand-kruart-online.webp',
  './brand-awh.webp',
  './awh-home-hero.webp',
  './account-avatar.webp',
]);

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
  const runtimeVisual = request.destination === 'image' && RUNTIME_VISUALS.has(url.pathname.startsWith('/') ? `.${url.pathname}` : url.pathname);
  if (runtimeVisual) {
    event.respondWith(fetch(request).then((response) => { if (response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy)); } return response; }).catch(() => caches.match(request)));
    return;
  }
  if (request.destination === 'document') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request)));
});
