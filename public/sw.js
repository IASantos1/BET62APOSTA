const RUNTIME_CACHE = 'bet62-runtime-v1'

const clearOldCaches = async () => {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key))
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await clearOldCaches()
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request))
    return
  }

  const isNavigation = event.request.mode === 'navigate'
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/icons/icon.svg'

  if (!isNavigation && !isStaticAsset) {
    event.respondWith(fetch(event.request))
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE)
      try {
        const response = await fetch(event.request, { cache: 'no-store' })
        if (response && response.ok) {
          cache.put(event.request, response.clone()).catch(() => null)
        }
        return response
      } catch (error) {
        const cached = await cache.match(event.request)
        if (cached) return cached
        throw error
      }
    })()
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
  if (data && data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearOldCaches())
  }
})
