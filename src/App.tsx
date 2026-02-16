import { BrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppRoutes } from './router';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';

const CacheHealthMonitor = lazy(() => import('./components/feature/CacheHealthMonitor'));

function App() {
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
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
