import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { initializePreloader } from './services/assetPreloader';
import { initializeLazyLoading } from './services/lazyLoadManager';
import { performanceMonitor } from './services/performanceMonitor';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const schedule = (cb: () => void) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as any).requestIdleCallback(cb);
  } else {
    setTimeout(cb, 0);
  }
};

schedule(() => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const clearLegacyCaches = async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [] as ServiceWorkerRegistration[]);
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));

      if ('caches' in window) {
        const cacheKeys = await caches.keys().catch(() => [] as string[]);
        await Promise.all(cacheKeys.map((key) => caches.delete(key).catch(() => false)));
      }
    } catch (error) {
      console.warn('⚠️ Falha ao limpar cache antigo:', error);
    }
  };

  void clearLegacyCaches();
});

schedule(() => {
  initializePreloader();
  initializeLazyLoading();
  performanceMonitor.initialize();

  setTimeout(() => {
    const score = performanceMonitor.getPerformanceScore();
    if (score < 80 && import.meta.env.PROD) {
      const recommendations = performanceMonitor.getRecommendations();
      console.warn('⚠️ Recomendações de otimização:', recommendations);
    }
  }, 5000);
});
