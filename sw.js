/* Service Worker — Личный штаб • LifeStats
   Офлайн-кэширование: precache локальных ресурсов + runtime-кэш
   CDN (Tailwind, Google Fonts) кэшируются при первом успешном запросе
*/
const CACHE_NAME = 'lichniy-shtab-v5';
const RUNTIME_CACHE = 'lichniy-shtab-runtime-v5';

// Локальные файлы, которые всегда должны быть доступны офлайн
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon.png',
  './sw.js'
];

// Внешние ресурсы, которые полезно закэшировать для офлайна
const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Precache локальных ассетов (обязательно)
      await cache.addAll(PRECACHE_ASSETS);

      // Пытаемся закэшировать CDN (не блокируем установку, если сеть недоступна)
      try {
        await Promise.allSettled(
          EXTERNAL_ASSETS.map(async (url) => {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (res && res.ok) {
              await cache.put(url, res);
            }
          })
        );
      } catch (_) {
        // игнорируем — офлайн-установка всё равно пройдёт
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Навигация (открытие страницы) — network-first с fallback на index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetch(request);
          if (networkRes && networkRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', networkRes.clone());
          }
          return networkRes;
        } catch {
          const cached = await caches.match('./index.html') || await caches.match('./');
          return cached || new Response('Офлайн. Приложение недоступно.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // Локальные ресурсы (иконки, manifest, sw и т.д.) — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        try {
          const networkRes = await fetch(request);
          if (networkRes && networkRes.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkRes.clone());
          }
          return networkRes;
        } catch {
          return cached || new Response('', { status: 404 });
        }
      })()
    );
    return;
  }

  // Внешние ресурсы (Tailwind CDN, Google Fonts) — stale-while-revalidate
  if (
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);

        const networkPromise = fetch(request)
          .then((networkRes) => {
            if (networkRes && networkRes.ok) {
              cache.put(request, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => null);

        // Сразу отдаём кэш, если есть, иначе ждём сеть
        return cached || (await networkPromise) || new Response('', { status: 503 });
      })()
    );
  }
});
