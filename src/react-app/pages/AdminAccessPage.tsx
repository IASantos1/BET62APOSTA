import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { useAuth } from '@/react-app/contexts/AuthContext';
import { TwoFactor } from '@/react-app/components/TwoFactorSetup';
import { BrandMark } from '@/react-app/components/BrandMark';

export default function AdminAccessPage() {
  const navigate = useNavigate();
  const { darkMode, addNotification } = useApp();
  const { user, loading, signIn, signOut } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending2faUserId, setPending2faUserId] = useState<string | null>(null);

  const isOperator = !!(user as any)?.is_operator;
  const isLoggedWithoutAccess = !!user && !isOperator;

  const inputClass = useMemo(
    () =>
      `w-full rounded-2xl border px-4 py-3 outline-none transition-colors ${
        darkMode
          ? 'border-gray-700 bg-gray-900 text-white placeholder:text-gray-500 focus:border-red-500'
          : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-red-500'
      }`,
    [darkMode],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn(identifier.trim(), password);
      if (result.success) {
        addNotification({ type: 'success', message: 'Acesso administrativo validado' });
        navigate('/admin/dashboard', { replace: true });
        return;
      }
      if (result.requires2fa && result.userId) {
        setPending2faUserId(result.userId);
        return;
      }
      setError(result.error || 'Credenciais inválidas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar sessão');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loading && isOperator) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <main className={`min-h-screen px-4 py-8 ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-900'}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            to="/"
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
              darkMode ? 'border-gray-800 bg-gray-900 hover:bg-gray-800' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <i className="ri-arrow-left-line text-base"></i>
            <span>Voltar ao site</span>
          </Link>
          <span className={`text-xs font-black uppercase tracking-[0.24em] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Painel Administrativo
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <section
            className={`rounded-[28px] border p-6 shadow-2xl ${
              darkMode ? 'border-gray-800 bg-gray-900/80' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="mb-8 text-center">
              <div className="mb-4 flex justify-center">
                <BrandMark size={70} rounded="circle" />
              </div>
              <h1 className="text-3xl font-black">Acesso Admin BET62</h1>
              <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Página externa do administrador ligada ao backend da plataforma.
              </p>
            </div>

            {loading ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <div className="flex items-center gap-3 text-sm font-bold text-gray-400">
                  <i className="ri-loader-4-line animate-spin text-xl"></i>
                  <span>A validar sessão administrativa...</span>
                </div>
              </div>
            ) : pending2faUserId ? (
              <TwoFactor
                mode="login"
                userId={pending2faUserId}
                onSuccess={() => {
                  addNotification({ type: 'success', message: '2FA validado com sucesso' });
                  navigate('/admin/dashboard', { replace: true });
                }}
                onCancel={() => setPending2faUserId(null)}
              />
            ) : isLoggedWithoutAccess ? (
              <div className="space-y-5">
                <div
                  className={`rounded-2xl border px-4 py-4 text-sm ${
                    darkMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  Esta sessão existe, mas não tem permissões de operador para entrar no painel administrativo.
                </div>

                <button
                  type="button"
                  onClick={() => signOut()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 font-black text-white transition hover:bg-red-700"
                >
                  <i className="ri-logout-box-r-line text-lg"></i>
                  <span>Terminar sessão atual</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {error ? (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      darkMode ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {error}
                  </div>
                ) : null}

                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Utilizador ou email
                  </label>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={inputClass}
                    placeholder="admin@bet62.plus"
                    autoComplete="username"
                    required
                  />
                </div>

                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputClass} pr-12`}
                      placeholder="Introduza a sua senha"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 text-lg ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
                    </button>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Link to="/admin/recover-password" className="text-sm font-bold text-red-500 hover:text-red-600">
                      Recuperar senha
                    </Link>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 font-black text-white transition hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <i className="ri-loader-4-line animate-spin text-lg"></i> : <i className="ri-shield-user-line text-lg"></i>}
                  <span>{submitting ? 'A validar acesso...' : 'Entrar no Admin'}</span>
                </button>
              </form>
            )}
          </section>

          <aside
            className={`rounded-[28px] border p-6 shadow-2xl ${
              darkMode ? 'border-gray-800 bg-gray-900/60 text-white' : 'border-gray-200 bg-white text-gray-900'
            }`}
          >
            <h2 className="text-xl font-black">Fluxo Separado</h2>
            <div className={`mt-5 space-y-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <div className="rounded-2xl bg-blue-600/10 px-4 py-3">
                <div className="font-bold text-blue-500">URL dedicada</div>
                <div className="mt-1">`/admin` agora deixa de depender da home pública e abre num ecrã próprio.</div>
              </div>
              <div className="rounded-2xl bg-emerald-600/10 px-4 py-3">
                <div className="font-bold text-emerald-500">Ligação à plataforma</div>
                <div className="mt-1">A autenticação continua ligada ao backend existente da BET62 e respeita sessão, cookies e 2FA.</div>
              </div>
              <div className="rounded-2xl bg-red-600/10 px-4 py-3">
                <div className="font-bold text-red-500">Entrada controlada</div>
                <div className="mt-1">Só utilizadores com permissão de operador entram no painel administrativo.</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
