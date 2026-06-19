const CACHE_NAME = 'django-voip-v1';
const ASSETS_TO_CACHE = [
    '/menu/',
    '/about/',
    '/static/css/style.css',

    '/static/js/main.js',
    '/static/js/ws.js',
    '/static/js/ui.js',
    '/static/js/admin.js',
    '/static/js/media.js',
    '/static/js/cameras.js',
    '/static/js/chat.js',
    '/static/js/state.js',
    '/static/js/utils.js',

    '/static/images/icon-192.png',
    '/static/images/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/') || event.request.url.includes('ws://') || event.request.url.includes('wss://')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (event.request.mode === 'navigate') {
                        return caches.match('/menu/');
                    }
                });
            })
    );
});
