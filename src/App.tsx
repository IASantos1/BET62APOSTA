import { BrowserRouter } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { AppRoutes } from './router';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { preloadLiveMatches } from './hooks/useLiveMatches';
import { Analytics } from '@vercel/analytics/react';

const CacheHealthMonitor = lazy(() => import('./components/feature/CacheHealthMonitor'));

function App() {
  useEffect(() => {
    preloadLiveMatches();
  }, []);

  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <ThemeProvider>
        <AuthProvider>
          <NotificationProvider>
            <AppRoutes />
            {import.meta.env.DEV && (
              <Suspense fallback={null}>
                <CacheHealthMonitor />
              </Suspense>
            )}
            <Analytics />
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
