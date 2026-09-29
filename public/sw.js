// Minimal service worker — exists only for PWA installability.
// Does NOT cache anything. Vite hashed filenames + Firebase Cache-Control
// headers handle caching correctly. A caching SW caused stale version issues.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Purge any caches left over from previous SW versions
  e.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

// No fetch handler — let the browser handle all requests normally
