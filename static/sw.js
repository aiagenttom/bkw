/**
 * BKW Solar Dashboard – Service Worker
 *
 * Strategie:
 *  - SvelteKit Build-Assets (_app/immutable/*): Cache-first (hash-versioned, unveränderlich)
 *  - CDN-Assets (Bootstrap, Icons): Cache-first
 *  - Icons + Manifest: Cache-first
 *  - API-Routen (/api/*): Network-only (Live-Daten)
 *  - Navigation (HTML-Seiten): Network-first → Cache-Fallback
 */

const CACHE_NAME = 'bkw-v1';

// Muster für Ressourcen die dauerhaft gecacht werden können
const CACHEABLE = [
  /\/_app\/immutable\//,       // SvelteKit hash-versioned JS/CSS
  /cdnjs\.cloudflare\.com/,    // Bootstrap + Bootstrap Icons (CDN)
  /\/style\.css$/,             // App CSS
  /\/icons\//,                 // PWA Icons
  /\/favicon\./,               // Favicon
  /\/manifest\.webmanifest$/,  // Manifest
];

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Activate: veraltete Caches löschen ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Nur GET behandeln
  if (request.method !== 'GET') return;
  // Chrome-Extensions ignorieren
  if (!url.protocol.startsWith('http')) return;

  // API-Routen: immer Netzwerk (Echtzeit-Solardaten, Auth-geschützt)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Statische Assets: Cache-first
  if (CACHEABLE.some(pattern => pattern.test(url.href))) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation & alles andere: Network-first, Cache als Fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        // Erfolgreiche Navigation cachen (für Offline-Fallback)
        if (response.ok && request.mode === 'navigate') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
