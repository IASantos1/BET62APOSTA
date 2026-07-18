import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BrandMark } from '@/react-app/components/BrandMark';
import { useApp } from '@/react-app/contexts/AppContext';

const SUPPORT_EMAIL = 'atendimentoaoclientebet62@gmail.com';

export default function RecoverPasswordPage() {
  const location = useLocation();
  const { darkMode, addNotification } = useApp();
  const isAdmin = location.pathname.startsWith('/admin/');
  const [identifier, setIdentifier] = useState('');

  const cardClass = useMemo(
    () =>
      darkMode ? 'border-gray-800 bg-gray-900/70 text-white' : 'border-gray-200 bg-white text-gray-900',
    [darkMode],
  );

  const openSupport = () => {
    const trimmed = identifier.trim();
    const subject = encodeURIComponent(isAdmin ? 'Recuperar senha admin BET62' : 'Recuperar senha conta BET62');
    const body = encodeURIComponent(
      [
        isAdmin ? 'Pedido de recuperação de senha do painel admin.' : 'Pedido de recuperação de senha da conta BET62.',
        '',
        `Identificador: ${trimmed || '(não informado)'}`,
        isAdmin
          ? 'Nota: a senha administrativa é controlada por ADMIN_PASSWORD no Railway e pode ser alterada diretamente lá.'
          : 'Nota: preciso de apoio para redefinir a senha da minha conta.',
      ].join('\n'),
    );
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    addNotification({ type: 'success', message: 'Abrimos o contacto de suporte para recuperar a senha' });
  };

  return (
    <main className={`min-h-screen px-4 py-8 ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <section className={`rounded-3xl border p-6 shadow-xl ${cardClass}`}>
            <div className="mb-8 text-center">
              <div className="mb-4 flex justify-center">
                <BrandMark size={64} rounded="circle" />
              </div>
              <h1 className="text-3xl font-black">{isAdmin ? 'Recuperar Senha Admin' : 'Recuperar Senha'}</h1>
              <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {isAdmin
                  ? 'Fluxo dedicado para recuperar o acesso ao painel administrativo.'
                  : 'Fluxo dedicado para recuperar o acesso à conta da plataforma.'}
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {isAdmin ? 'Utilizador admin ou email' : 'Email ou utilizador'}
                </label>
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className={`w-full rounded-xl border px-4 py-3 outline-none transition-colors ${
                    darkMode
                      ? 'border-gray-700 bg-gray-900 text-white placeholder:text-gray-500 focus:border-red-500'
                      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-red-500'
                  }`}
                  placeholder={isAdmin ? 'Israel ou suportebet62@gmail.com' : 'email@exemplo.com'}
                />
              </div>

              <button
                type="button"
                onClick={openSupport}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 font-black text-white transition hover:from-red-700 hover:to-red-800"
              >
                <i className="ri-mail-send-line text-lg"></i>
                <span>Recuperar senha</span>
              </button>

              <div className={`rounded-2xl border px-4 py-4 text-sm ${darkMode ? 'border-gray-800 bg-gray-900/80 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                {isAdmin ? (
                  <>
                    A recuperação do admin passa pelo suporte e pela variável `ADMIN_PASSWORD` no Railway.
                    Podes redefinir a senha diretamente no Railway e depois voltar a entrar em `/admin`.
                  </>
                ) : (
                  <>
                    O pedido é enviado ao suporte para validação e redefinição segura da senha da conta.
                  </>
                )}
              </div>

              <div className={`flex items-center justify-between border-t pt-4 text-sm ${darkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                <span>{isAdmin ? 'Voltar ao acesso administrativo?' : 'Voltar ao login normal?'}</span>
                <Link to={isAdmin ? '/admin' : '/login'} className="font-bold text-red-500 hover:text-red-600">
                  Entrar
                </Link>
              </div>
            </div>
          </section>

          <aside className={`rounded-3xl border p-6 shadow-xl ${cardClass}`}>
            <h2 className="text-xl font-black">Suporte</h2>
            <div className={`mt-5 space-y-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <div className="rounded-2xl bg-blue-600/10 px-4 py-3">
                <div className="font-bold text-blue-500">Email de apoio</div>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-1 block break-all text-red-500 hover:text-red-600">
                  {SUPPORT_EMAIL}
                </a>
              </div>
              <div className="rounded-2xl bg-emerald-600/10 px-4 py-3">
                <div className="font-bold text-emerald-500">Segurança</div>
                <div className="mt-1">A senha não é mostrada nem enviada pelo site; o fluxo segue por suporte validado.</div>
              </div>
              {isAdmin ? (
                <div className="rounded-2xl bg-amber-600/10 px-4 py-3">
                  <div className="font-bold text-amber-500">Railway</div>
                  <div className="mt-1">Se precisares, altera `ADMIN_PASSWORD` no Railway e faz novo deploy para atualizar o acesso admin.</div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
