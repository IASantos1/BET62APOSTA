const clearAllCaches = async () => {
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await clearAllCaches()
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
    })()
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
  if (data && data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches())
  }
})
