import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Bet62Intro } from './components/Bet62Intro';

const queryClient = new QueryClient();
import { AuthProvider } from '@/react-app/contexts/AuthContext';
import { AppProvider, useApp } from '@/react-app/contexts/AppContext';
// import { RealtimeProvider } from './contexts/RealtimeContext'; // Removed
import { Header } from './components/Header';
import { ToastContainer } from './components/Toast';
import { Footer } from './components/Footer';
import { BackLink } from './components/BackLink';
import { SWUpdateBar } from './components/SWUpdateBar';
import { InstallBar } from './components/InstallBar';
import HomePage from './pages/Home';
import PaymentsPage from "./pages/PaymentsPage";
import WithdrawPage from "./pages/WithdrawPage";
import KycPage from "./pages/KycPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import WalletPage from "./pages/WalletPage";
import EventDetails from "./pages/EventDetails";
import Promotions from "./pages/Promotions";
import ProfilePage from "./pages/ProfilePage";
import MyBetsPage from "./pages/MyBetsPage";
import { AdminRoute } from './routes/AdminRoute';
import AdminKycPage from "./pages/AdminKycPage";
import AdminWithdrawalsPage from "./pages/AdminWithdrawalsPage";
import AdminPayoutsPage from "./pages/AdminPayoutsPage";
import MetricsPage from "./pages/Metrics";
import TradingPanelPage from "./pages/TradingPanelPage";
// import LiveOddsPage from "./pages/LiveOddsPage"; // Removed

import AdminPanel from "./components/AdminPanel";
import AdminRisk from "./pages/AdminRisk";
import { AuthModal } from './components/AuthModal';
import { CookieBanner } from './components/CookieBanner';
import { MobileBetSlip } from './components/MobileBetSlip';
import { DashboardSidebar } from './components/DashboardSidebar';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  const [showIntro, setShowIntro] = useState(() => {
    try { return !sessionStorage.getItem('bet62_intro_shown'); } catch { return true; }
  });

  useEffect(() => {
    if (showIntro) {
      try { sessionStorage.setItem('bet62_intro_shown', '1'); } catch { /* empty */ }
      const t = setTimeout(() => setShowIntro(false), 3200);
      return () => clearTimeout(t);
    }
  }, [showIntro]);

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage || {});
      keys.forEach((k) => {
        if (
          k.startsWith('event_') ||
          k.startsWith('events_cache_') ||
          k.startsWith('odds_cache_') ||
          k.startsWith('upcoming_cache_')
        ) {
          try { localStorage.removeItem(k); } catch { /* empty */ }
        }
      });
      try { localStorage.removeItem('home:pregame:v2'); } catch { /* empty */ }
      try { if ((window as any).caches) (window as any).caches.delete('betarena-static-v1'); } catch { /* empty */ }
      try { if (navigator?.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' }); } catch { /* empty */ }
    } catch { /* empty */ }
  }, []);

  return (
    <ErrorBoundary>
      {showIntro && <Bet62Intro />}
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppProvider>
              <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <InnerApp />
              </Router>
          </AppProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Separate component to safely use contexts (AppProvider, AuthProvider)
function InnerApp() {
    return (
        <>
            <Header />
            <AppContent />
            <Footer />
        </>
    );
}

function AppContent() {
  const { showAdminPanel, authModalOpen, authModalMode, authModalUserId, closeAuthModal, openAuthModal } = useApp();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/login') {
      openAuthModal('login');
    } else if (location.pathname === '/register') {
      openAuthModal('register');
    }
  }, [location.pathname]);

  if (showAdminPanel) {
    return <AdminPanel />;
  }

  return (
    <>
      <SWUpdateBar />
      <InstallBar />
      <CookieBanner />
      <BackLink />
      {authModalOpen && (
        <AuthModal 
          mode={authModalMode}
          tempUserId={authModalUserId}
          onClose={closeAuthModal}
          onLoginSuccess={() => {
              closeAuthModal();
          }}
          onRequire2FA={(userId) => openAuthModal('2fa', userId)}
          onSwitchMode={(mode) => openAuthModal(mode)}
        />
      )}
      <Routes>
        <Route path="/" element={<HomePage mode="home" />} />
        <Route path="/live" element={<HomePage mode="live" />} />
        {/* <Route path="/live-odds" element={<LiveOddsPage />} /> Removed */}
        <Route path="/event/:id" element={<EventDetails />} />
        <Route path="/deposit" element={<PaymentsPage />} />
        <Route path="/withdraw" element={<WithdrawPage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/my-bets" element={<MyBetsPage />} />
        <Route path="/register" element={<HomePage />} />
        <Route path="/login" element={<HomePage />} />
        <Route path="/deposit-success" element={<h2>Depósito efetuado com sucesso!</h2>} />
        <Route path="/promotions" element={<Promotions />} />
        <Route path="/admin/payouts" element={
          <AdminRoute>
            <AdminPayoutsPage />
          </AdminRoute>
        } />
        <Route path="/metrics" element={
          <AdminRoute>
            <MetricsPage />
          </AdminRoute>
        } />
        <Route path="/trading-panel" element={
          <AdminRoute>
            <TradingPanelPage />
          </AdminRoute>
        } />
        <Route path="/admin/risk" element={
          <AdminRoute>
            <AdminRisk />
          </AdminRoute>
        } />
        <Route path="/admin/kyc" element={
          <AdminRoute>
            <AdminKycPage />
          </AdminRoute>
        } />
        <Route path="/admin/withdrawals" element={
          <AdminRoute>
            <AdminWithdrawalsPage />
          </AdminRoute>
        } />

        
      </Routes>
      <MobileBetSlip />
      <DashboardSidebar />
      <ToastContainer />
    </>
  );
}
