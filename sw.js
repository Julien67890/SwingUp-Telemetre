/* =========================================================
   SwingUp — Télémètre · Service Worker
   Cache PROPRE à cette application : ne partage rien avec
   la carte de score, même si les deux sont sur le même domaine.
   Incrémenter CACHE_VERSION à chaque mise en ligne.
   ========================================================= */
const CACHE_VERSION = 'swingup-telemetre-v8';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './confidentialite.html',
  './privacy.html',
  './favicon.ico',
  './fr-poly.js',
  './leaflet/leaflet.js',
  './leaflet/leaflet.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

/* Domaines externes mis en cache à l'usage, jamais bloquants. */
const RUNTIME_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com'
];

/* Fournisseurs de tuiles et d'altimétrie.
   Volontairement NON mis en cache : les conditions d'utilisation d'Esri
   et de l'IGN encadrent la conservation des tuiles, et une carte périmée
   fausserait les distances. Le réseau, ou rien. */
const TILE_HOSTS = [
  'data.geopf.fr',
  'ibasemaps-api.arcgis.com',
  'server.arcgisonline.com',
  'api.open-meteo.com',
  'overpass-api.de'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pré-cache partiel :', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Extensions du navigateur et autres schémas : le cache les refuse. */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Tuiles, altimétrie, Overpass : on laisse passer sans intervenir. */
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) return;

  /* Firebase et Firestore : toujours le réseau, jamais de cache,
     sinon l'état d'abonnement serait servi périmé. */
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis.com') && !RUNTIME_HOSTS.includes(url.hostname)) {
    return;
  }

  /* Domaines tiers non prévus : on ne s'en mêle pas. */
  if (url.origin !== self.location.origin && !RUNTIME_HOSTS.includes(url.hostname)) return;

  /* Navigation : réseau d'abord, cache en secours. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Polices et SDK : cache d'abord, réseau en secours. */
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  /* Fichiers de l'application : cache d'abord, réseau en secours. */
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
