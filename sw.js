/**
 * sw.js - Service Worker para Carlicos Portal Maestro PWA
 * Estrategia Network-First para activos locales.
 * NUNCA intercepta ni cachea peticiones a Supabase ni APIs externas.
 */

var CACHE_NAME = 'carlicos-portal-v1';
var STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(STATIC_ASSETS);
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) {
                    return key !== CACHE_NAME;
                }).map(function (key) {
                    return caches.delete(key);
                })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function (event) {
    var url = event.request.url;

    // Regla estricta: NUNCA cachear llamadas a Supabase ni métodos no GET
    if (event.request.method !== 'GET' || url.indexOf('supabase.co') !== -1) {
        return;
    }

    // Estrategia Network-First para archivos estáticos locales
    event.respondWith(
        fetch(event.request)
            .then(function (networkResponse) {
                if (networkResponse && networkResponse.status === 200) {
                    var responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(function () {
                return caches.match(event.request);
            })
    );
});
