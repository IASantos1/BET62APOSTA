import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { serviceWorkerManager } from './services/serviceWorkerManager';
import { initializePreloader } from './services/assetPreloader';
import { initializeLazyLoading } from './services/lazyLoadManager';
import { performanceMonitor } from './services/performanceMonitor';

// Inicializar Service Worker
if (import.meta.env.PROD) {
  serviceWorkerManager.register().catch((error) => {
    console.error('❌ Erro ao registrar Service Worker:', error);
  });
}

// Inicializar Asset Preloader
initializePreloader();

// Inicializar Lazy Loading
initializeLazyLoading();

// Inicializar Performance Monitor
performanceMonitor.initialize();

// Log de performance após 5 segundos
setTimeout(() => {
  const score = performanceMonitor.getPerformanceScore();
  console.log('📊 Performance Score:', score);
  
  if (score < 80) {
    const recommendations = performanceMonitor.getRecommendations();
    console.warn('⚠️ Recomendações de otimização:', recommendations);
  }
}, 5000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
