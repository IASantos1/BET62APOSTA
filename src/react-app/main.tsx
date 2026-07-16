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
  if (sw && import.meta.env.PROD) {
    const registerPwa = async () => {
      const registration = await sw.register('/sw.js', { scope: '/' });
      (window as any).swRegistration = registration;

      if (registration.waiting) {
        window.dispatchEvent(new CustomEvent('bet62-sw-update'));
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && sw.controller) {
            (window as any).swRegistration = registration;
            window.dispatchEvent(new CustomEvent('bet62-sw-update'));
          }
        });
      });

      void registration.update().catch(() => void 0);
    };

    void registerPwa().catch(() => void 0);
  }
} catch { /* do nothing */ }
