/* =========================================================
   SwingUp — Télémètre · Service Worker
   Cache PROPRE à cette application : ne partage rien avec
   la carte de score, même si les deux sont sur le même domaine.
   Incrémenter CACHE_VERSION à chaque mise en ligne.
   ========================================================= */
const CACHE_VERSION = 'swingup-telemetre-v9';

/* Cache des tuiles d'imagerie : nom FIXE, volontairement en dehors de
   CACHE_VERSION, pour survivre aux mises à jour de l'appli (sinon chaque
   déploiement reviderait tout le cache et redemanderait les mêmes tuiles
   à Esri/IGN pour rien). Limité en durée et en taille : voir plus bas. */
const TILE_CACHE = 'swingup-telemetre-tiles';
const TILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; /* 30 jours : un green ne bouge pas */
const TILE_MAX_ENTRIES = 4000; /* large pour plusieurs parcours, raisonnable en place disque */

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

/* Imagerie aérienne/satellite : mise en cache limitée dans le temps
   (30 jours) et en volume (TILE_MAX_ENTRIES). Rejouer le même parcours
   ne redemande donc plus les mêmes tuiles à chaque partie — ça réduit
   nettement la consommation du quota ArcGIS sans jamais servir une
   image trop ancienne. */
const IMAGERY_HOSTS = [
  'data.geopf.fr',
  'ibasemaps-api.arcgis.com',
  'server.arcgisonline.com'
];

/* Données dynamiques (altitude, POI) : toujours le réseau, jamais de cache. */
const TILE_HOSTS = [
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
        keys.filter(k => k !== CACHE_VERSION && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Cache-first avec expiration pour les tuiles d'imagerie. */
async function repondreTuile(req){
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit){
    const stamp = Number(hit.headers.get('sw-cached-at') || 0);
    if (Date.now() - stamp < TILE_MAX_AGE_MS) return hit;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok){
      const blob = await res.clone().blob();
      const headers = new Headers(res.headers);
      headers.set('sw-cached-at', String(Date.now()));
      cache.put(req, new Response(blob, { status: res.status, statusText: res.statusText, headers }));
      trimTuiles(cache);
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}
async function trimTuiles(cache){
  const keys = await cache.keys();
  const excedent = keys.length - TILE_MAX_ENTRIES;
  for (let i = 0; i < excedent; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Extensions du navigateur et autres schémas : le cache les refuse. */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Altimétrie, Overpass : on laisse passer sans intervenir (données changeantes). */
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) return;

  /* Imagerie aérienne/satellite : cache-first avec expiration (30 jours). */
  if (IMAGERY_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(repondreTuile(req));
    return;
  }

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
