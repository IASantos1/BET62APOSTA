import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import * as Sentry from '@sentry/react'

// Filter out annoying "<no value>" logs from environment/trae-preview
const originalLog = console.log;
console.log = (...args) => {
  if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('<no value>')) {
    return;
  }
  originalLog(...args);
};

try {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (dsn) {
    Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0 })
  }
} catch { /* no-op */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Sentry.ErrorBoundary fallback={<div style={{ padding: 16 }}>Ocorreu um erro inesperado.</div>}>
    <App />
  </Sentry.ErrorBoundary>,
)

try {
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
  if (sw) {
    const clearLegacyPwa = async () => {
      const registrations = await sw.getRegistrations().catch(() => [] as ServiceWorkerRegistration[])
      const hadRegistrations = registrations.length > 0
      await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)))

      if ('caches' in window) {
        const cacheKeys = await caches.keys().catch(() => [] as string[])
        await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)))
      }

      (window as any).swRegistration = null

      try {
        const reloadFlag = 'bet62_pwa_cache_cleared_v3'
        const shouldReload = sessionStorage.getItem(reloadFlag) !== '1'
        if (shouldReload) {
          sessionStorage.setItem(reloadFlag, '1')
          window.location.replace(window.location.href)
          return
        }
        sessionStorage.removeItem(reloadFlag)
      } catch {
        /* no-op */
      }
    }

    void clearLegacyPwa()
  }
} catch { /* do nothing */ }
