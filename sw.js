/* Service worker: permite instalar la app y abrirla rápido.
   Solo guarda en caché los archivos propios; los datos de Supabase nunca se cachean. */
const VERSION = 'bco-v4';
const ARCHIVOS = [
  '/', '/index.html', '/styles.css', '/app.js', '/importador.js', '/manifest.webmanifest',
  '/vendor/supabase.js', '/vendor/591.supabase.js', '/vendor/exceljs.min.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png', '/icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fuentes, etc.: siempre por red

  // Red primero (para recibir siempre la última versión publicada); caché si no hay conexión.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/index.html') : undefined)))
  );
});
