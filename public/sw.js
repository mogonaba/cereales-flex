// Service worker minimal : met en cache la coquille de l'application (CSS/JS/HTML statiques)
// pour un chargement plus rapide et une tolérance aux coupures réseau ponctuelles.
// Les appels API (/api/...) ne sont volontairement jamais mis en cache : les données
// (stock, prix, commandes...) doivent toujours être fraîches.

const CACHE = 'cereales-flex-v1';
const FICHIERS_COQUILLE = [
  '/', '/css/style.css', '/js/main.js', '/manifest.json', '/images/icone.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FICHIERS_COQUILLE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return; // laisser passer directement au réseau
  }
  event.respondWith(
    caches.match(event.request).then((reponse) => reponse || fetch(event.request).then((res) => {
      const copie = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copie));
      return res;
    }).catch(() => reponse))
  );
});
