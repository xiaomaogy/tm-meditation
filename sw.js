const CACHE = 'tm-v18';
const ASSETS = [
    './',
    './index.html',
    './vendor/nosleep.min.js',
    './keep-awake.js',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
            return resp;
        }))
    );
});
