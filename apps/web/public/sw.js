const CACHE_PREFIX = 'bullion-ledger-shell-';
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_REVISION__`;
const PRECACHE_ASSETS = /* __PRECACHE_ASSETS__ */ [];
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/bullion-ledger-icon.svg',
  '/bullion-ledger-icon-32.png',
  '/bullion-ledger-icon-192.png',
  '/bullion-ledger-icon-512.png',
  '/bullion-ledger-icon-1024.png',
  '/apple-touch-icon-120.png',
  '/apple-touch-icon-152.png',
  '/apple-touch-icon-167.png',
  '/apple-touch-icon.png',
  '/safari-pinned-tab.svg',
  ...PRECACHE_ASSETS,
];
const CACHEABLE_STATIC_PATHS = new Set(SHELL.filter((path) => path !== '/'));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/attachments/') ||
    url.searchParams.has('X-Amz-Signature')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!url.pathname.startsWith('/assets/') && !CACHEABLE_STATIC_PATHS.has(url.pathname)) return;

  const networkResponse = fetchAndCache(request);
  event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((cached) => cached ?? networkResponse),
  );
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
  }
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
