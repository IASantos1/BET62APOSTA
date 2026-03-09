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
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          (window as any).swRegistration = reg
        })
        .catch(() => null)
    } else {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (reg) reg.unregister()
        })
        .catch(() => null)
    }
  }
} catch { /* do nothing */ }
