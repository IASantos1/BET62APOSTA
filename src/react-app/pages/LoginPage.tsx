import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/react-app/contexts/AppContext';
import { useAuth } from '@/react-app/contexts/AuthContext';
import { TwoFactor } from '@/react-app/components/TwoFactorSetup';

export default function LoginPage() {
  const navigate = useNavigate();
  const { darkMode, addNotification } = useApp();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending2faUserId, setPending2faUserId] = useState<string | null>(null);

  const inputClass = useMemo(
    () =>
      `w-full rounded-xl border px-4 py-3 outline-none transition-colors ${
        darkMode
          ? 'border-gray-700 bg-gray-900 text-white placeholder:text-gray-500 focus:border-red-500'
          : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-red-500'
      }`,
    [darkMode],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await signIn(identifier.trim(), password);
      if (result.success) {
        addNotification({ type: 'success', message: 'Sessão iniciada com sucesso' });
        navigate('/');
        return;
      }
      if (result.requires2fa && result.userId) {
        setPending2faUserId(result.userId);
        return;
      }
      setError(result.error || 'Credenciais inválidas. Verifique o email/utilizador e a senha.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar sessão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`min-h-[calc(100vh-140px)] px-4 py-8 ${darkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section
            className={`rounded-3xl border p-6 shadow-xl ${
              darkMode ? 'border-gray-800 bg-gray-900/70' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="mb-8 text-center">
              <div className="mb-4 flex justify-center">
                <div className={`flex h-20 w-20 items-center justify-center rounded-full border-4 shadow-lg ${
                  darkMode ? 'border-amber-300/80 bg-amber-300/10' : 'border-amber-300 bg-amber-50'
                }`}>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-[1.35rem] font-black tracking-tight text-white shadow-inner">
                    62
                  </div>
                </div>
              </div>
              <h1 className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>Entrar na sua conta</h1>
              <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Acesso direto sem recarregar a página principal por baixo.
              </p>
            </div>

            {pending2faUserId ? (
              <TwoFactor
                mode="login"
                userId={pending2faUserId}
                onSuccess={() => {
                  addNotification({ type: 'success', message: '2FA validado com sucesso' });
                  navigate('/');
                }}
                onCancel={() => setPending2faUserId(null)}
              />
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
                    Email ou utilizador
                  </label>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={inputClass}
                    placeholder="email@exemplo.com"
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
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 font-black text-white transition hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? <i className="ri-loader-4-line animate-spin text-lg"></i> : <i className="ri-shield-user-line text-lg"></i>}
                  <span>{loading ? 'A validar acesso...' : 'Entrar'}</span>
                </button>

                <div className={`flex items-center justify-between border-t pt-4 text-sm ${darkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                  <span>Ainda não tem conta?</span>
                  <Link to="/register" className="font-bold text-red-500 hover:text-red-600">
                    Criar conta
                  </Link>
                </div>
              </form>
            )}
          </section>

          <aside
            className={`rounded-3xl border p-6 shadow-xl ${
              darkMode ? 'border-gray-800 bg-gray-900/50 text-white' : 'border-gray-200 bg-white text-gray-900'
            }`}
          >
            <h2 className="text-xl font-black">Acesso Profissional</h2>
            <div className={`mt-5 space-y-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <div className="rounded-2xl bg-red-600/10 px-4 py-3">
                <div className="font-bold text-red-500">Sessão segura</div>
                <div className="mt-1">Tokens com renovação silenciosa e suporte para 2FA.</div>
              </div>
              <div className="rounded-2xl bg-blue-600/10 px-4 py-3">
                <div className="font-bold text-blue-500">Sem reload da home</div>
                <div className="mt-1">A autenticação agora acontece numa página própria.</div>
              </div>
              <div className="rounded-2xl bg-emerald-600/10 px-4 py-3">
                <div className="font-bold text-emerald-500">Mais rapidez</div>
                <div className="mt-1">O login usa a resposta do backend para reduzir passos extras.</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
