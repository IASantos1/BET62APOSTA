const CACHE_STATIC = 'betarena-static-v4'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((c) => c.addAll(['/offline.html'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

const isAsset = (url) => {
  return url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.jpeg') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.ico') || url.pathname.includes('/assets/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req))
    return
  }
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_STATIC)
        const offline = await cache.match('/offline.html')
        return offline || Response.error()
      })
    )
    return
  }
  if (url.origin === self.location.origin && isAsset(url)) {
    event.respondWith(
      fetch(req).then(async (res) => {
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE_STATIC)
          cache.put(req, res.clone())
        }
        return res
      }).catch(async () => {
        const cache = await caches.open(CACHE_STATIC)
        const cached = await cache.match(req)
        return cached || Response.error()
      })
    )
    return
  }
  event.respondWith(fetch(req))
})

self.addEventListener('message', (event) => {
  const d = event.data
  if (d && d.type === 'SKIP_WAITING') self.skipWaiting()
})
