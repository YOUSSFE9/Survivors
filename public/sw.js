/**
 * Minimal Service Worker — makes the app installable as a PWA.
 * Caches the app shell so it works offline after first load.
 */
const CACHE_NAME = 'ss-maze-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Network-first for game assets (always fresh), cache-first for shell
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(() => caches.match('/index.html'))
        );
    }
});
