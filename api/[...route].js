import { Hono } from 'hono'
import { handle } from '@hono/node-server/vercel'

const app = new Hono()

app.all('*', async (c) => {
  try {
    if (c.req.path === '/__ping') {
      return c.json({ ok: true, path: c.req.path, url: c.req.url })
    }
    const { default: rawApp } = await import('../backend/src/index.js')
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith('/api')) {
      url.pathname = `/api${url.pathname}`
    }
    const req = new Request(url, c.req.raw)
    return await rawApp.fetch(req)
  } catch (err) {
    try { console.error(err) } catch {}
    return c.json({ error: err?.message || String(err) }, 500)
  }
})

export default handle(app)
