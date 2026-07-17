import { 
   createContext, 
   useContext, 
   useEffect, 
   useState, 
   ReactNode, 
 } from 'react'; 
import { apiFetch } from '../utils/api';
 
 type User = { 
  userId: string; 
  username: string; 
  is_operator?: number;
  kyc_status?: 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended' | 'closed';
}; 

type AuthActionResult = {
  success: boolean;
  requires2fa?: boolean;
  userId?: string;
  error?: string;
  errorCode?: 'invalid_credentials' | 'invalid_2fa' | 'validation' | 'timeout' | 'network' | 'server';
};

type SignUpResult = {
  success: boolean;
  error?: string;
  errorCode?: 'validation' | 'timeout' | 'network' | 'server';
};
 
 type AuthContextType = { 
   user: User | null; 
   loading: boolean; 
 
   signIn: ( 
     username: string, 
     password: string, 
     twoFactorCode?: string 
  ) => Promise<AuthActionResult>; 
 
   signUp: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    nif?: string;
    dob: string;
    country: string;
    referralCode?: string;
  }) => Promise<SignUpResult>;

  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

function markCookieSessionActive(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.setItem('auth_session', '1');
}

function clearLegacyAuthStorage(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('auth_session');
}

function mapAuthTechnicalError(err: any, fallbackMessage: string): { error: string; errorCode: 'timeout' | 'network' | 'server' } {
  const status = Number(err?.status || 0);
  const message = String(err?.message || '').trim();
  const lowered = message.toLowerCase();
  const isTimeout =
    err?.name === 'AbortError' ||
    lowered.includes('timed out') ||
    lowered.includes('timeout') ||
    lowered.includes('signal is aborted');
  const isNetwork =
    lowered.includes('failed to fetch') ||
    lowered.includes('networkerror') ||
    lowered.includes('load failed') ||
    lowered.includes('network request failed') ||
    lowered.includes('offline');

  if (isTimeout) {
    return {
      error: 'O pedido demorou demasiado tempo. Verifique a ligação e tente novamente.',
      errorCode: 'timeout',
    };
  }
  if (isNetwork || !status) {
    return {
      error: 'Falha de ligação ao servidor. Verifique a internet e tente novamente.',
      errorCode: 'network',
    };
  }
  return {
    error: fallbackMessage,
    errorCode: 'server',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /* ================================
     REFRESH USER
  ================================= */
  const refreshUser = async () => {
    try {
      const data = await apiFetch<any>('/api/auth/me', {
        cache: 'no-store',
      });

      setUser(data.user || data);
    } catch {
      setUser(null);
    }
  };

 useEffect(() => {
    let alive = true;

    apiFetch<any>('/api/auth/me', { timeout: 8000 })
      .then((u) => {
        if (!alive) return;
        if (u && typeof u === 'object' && 'user' in u) {
          setUser(u.user);
        } else {
          setUser(u);
        }
      })
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  }, []);

  /* ================================
     SIGN IN (SUPPORTS 2FA)
  ================================= */
  const signIn: AuthContextType['signIn'] = async (
    username: string,
    password: string,
    twoFactorCode?: string
  ) => {
    try {
      // STEP 1 — NORMAL LOGIN
      const data = await apiFetch<any>('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        timeout: 12_000,
      });

      // Requires 2FA
      if (data.requires2fa) {
        if (!twoFactorCode) {
          return {
            success: false,
            requires2fa: true,
            userId: data.userId,
          };
        }

        // STEP 2 — 2FA VALIDATION
        const two = await apiFetch<any>('/api/auth/2fa/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: data.userId,
            token: twoFactorCode,
          }),
          timeout: 12_000,
        });
        if (two?.success !== false) {
          markCookieSessionActive();
        }
      } else {
        markCookieSessionActive();
      }

      await refreshUser();
      return { success: true };
    } catch (err: any) {
      const status = Number(err?.status || 0);
      if (twoFactorCode && (status === 400 || status === 401 || status === 403)) {
        return {
          success: false,
          error: 'Código de autenticação inválido. Tente novamente.',
          errorCode: 'invalid_2fa',
        };
      }
      if (!twoFactorCode && (status === 400 || status === 401 || status === 403)) {
        return {
          success: false,
          error: 'Credenciais inválidas. Verifique o email/utilizador e a senha.',
          errorCode: 'invalid_credentials',
        };
      }
      const technical = mapAuthTechnicalError(err, 'Não foi possível iniciar sessão agora. Tente novamente em instantes.');
      return { success: false, ...technical };
    }
  };

  /* ================================
     SIGN UP
  ================================= */
  const signUp: AuthContextType['signUp'] = async (data) => {
    try {
      await apiFetch<any>('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        timeout: 15_000,
      });

      markCookieSessionActive();

      await refreshUser();
      return { success: true };
    } catch (err: any) {
      const status = Number(err?.status || 0);
      if (status === 400 || status === 409 || status === 422) {
        return {
          success: false,
          error: 'Os dados de registo foram rejeitados. Verifique o formulário e tente novamente.',
          errorCode: 'validation',
        };
      }
      const technical = mapAuthTechnicalError(err, 'Não foi possível criar a conta agora. Tente novamente em instantes.');
      return { success: false, ...technical };
    }
  }; 
 
   /* ================================
     LOCAL LOGOUT HELPER
  ================================= */
  const localLogout = () => {
    clearLegacyAuthStorage();
    setUser(null);
  };

  /* ================================ 
     SIGN OUT 
  ================================= */ 
  const signOut = async () => { 
    try { 
      await apiFetch('/api/auth/logout', { 
        method: 'POST', 
      }); 
    } finally { 
      localLogout();
    } 
  };

  /* ================================
     AUTO LOGOUT LISTENER
  ================================= */
  useEffect(() => {
    const handleUnauthorized = () => {
      localLogout();
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []); 

  /* ================================
     IDLE TIMER & SILENT REFRESH
  ================================= */
  useEffect(() => {
    if (!user) return;

    // --- IDLE TIMER (24 Hours) ---
    let idleTimeout: NodeJS.Timeout;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        console.log('[Auth] Inatividade detectada (24h). Encerrando sessão...');
        signOut().catch(() => localLogout());
      }, 24 * 60 * 60 * 1000); // 24 hours
    };

    // Events to detect activity
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetIdleTimer));

    // Initialize timer
    resetIdleTimer();

    // --- SILENT REFRESH (Every 5 Minutes) ---
    const refreshInterval = setInterval(async () => {
       try {
         const refresh = await apiFetch<any>('/api/auth/refresh', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({})
         });
         if (refresh?.token || refresh?.refreshToken || user) {
           markCookieSessionActive();
         }
         
         console.log('[Auth] Token renovado com sucesso.');
       } catch (err) {
         // Do NOT logout on generic refresh error. 
         // Only 401 triggers 'auth:unauthorized' which handles logout.
         console.error('[Auth] Falha ao renovar token (tentativa):', err);
       }
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      clearTimeout(idleTimeout);
      clearInterval(refreshInterval);
      events.forEach(event => window.removeEventListener(event, resetIdleTimer));
    };
  }, [user]); // Re-run when user state changes
 
   return ( 
     <AuthContext.Provider 
       value={{ 
         user, 
         loading, 
         signIn, 
         signUp, 
         signOut, 
         refreshUser, 
       }} 
     > 
       {children} 
     </AuthContext.Provider> 
   ); 
 } 
 
 /* ================================ 
    HOOK 
 ================================= */ 
export function useAuth(): AuthContextType { 
   const ctx = useContext(AuthContext); 
  if (!ctx) { 
    return { 
      user: null, 
      loading: false, 
      signIn: async () => ({ success: false, error: 'Autenticação indisponível', errorCode: 'server' as const }), 
      signUp: async () => ({ success: false, error: 'Registo indisponível', errorCode: 'server' as const }), 
      signOut: async () => {}, 
      refreshUser: async () => {} 
    }; 
  } 
  return ctx; 
 }
