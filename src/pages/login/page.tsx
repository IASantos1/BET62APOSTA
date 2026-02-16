import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { requestEmailVerification } from '../../services/backendClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResendButton, setShowResendButton] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    setShowResendButton(false);
    setResendSuccess(false);

    try {
      console.log('🔑 Iniciando login...');
      await signIn(email, password);
      console.log('✅ Login bem-sucedido, redirecionando...');
      navigate('/');
    } catch (err) {
      console.error('❌ Erro no login:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro ao fazer login';
      setError(errorMessage);

      // Mostrar botão de reenviar se for erro de email não confirmado
      if (
        errorMessage.includes('confirme o seu email') ||
        errorMessage.includes('Email not confirmed') ||
        errorMessage.toLowerCase().includes('não verificado')
      ) {
        setShowResendButton(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      setError('Por favor, insira o seu email primeiro.');
      return;
    }

    setIsResending(true);
    setError('');
    setResendSuccess(false);

    try {
      await requestEmailVerification(email.trim().toLowerCase());
      setResendSuccess(true);
      setShowResendButton(false);
      setError('');
    } catch (err) {
      console.error('Erro ao reenviar:', err);
      setError('Erro ao reenviar email de confirmação. Tente novamente mais tarde.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 rounded-2xl mb-4 shadow-2xl">
            <i className="ri-trophy-line text-4xl text-black"></i>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Bem-vindo de volta</h1>
          <p className="text-gray-400">Entre na sua conta para continuar</p>
        </div>

        {/* Login Form */}
        <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl p-8 border border-amber-500/20 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <i className="ri-error-warning-line text-xl text-red-400 flex-shrink-0 mt-0.5"></i>
                  <div className="flex-1">
                    <p className="text-sm text-red-400">{error}</p>
                    {showResendButton && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-red-300/80">
                          O seu email ainda não foi confirmado. Pode confirmar agora ou reenviar o email de confirmação.
                        </p>
                        <div className="flex items-center justify-between">
                          <Link
                            to="/verify-email"
                            className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors whitespace-nowrap"
                          >
                            <i className="ri-mail-check-line"></i>
                            Verificar Email
                          </Link>
                          <span className="text-xs text-red-300/80">
                            Não recebeu? Use “Reenviar Email” abaixo.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Success Message */}
            {resendSuccess && (
              <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <i className="ri-checkbox-circle-line text-xl text-amber-400 flex-shrink-0 mt-0.5"></i>
                  <div className="flex-1">
                    <p className="text-sm text-amber-400 font-medium mb-1">✅ Email reenviado com sucesso!</p>
                    <p className="text-xs text-amber-300/80">
                      Verifique a sua caixa de entrada e pasta de spam. O link de confirmação é válido por 24 horas.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <i className="ri-mail-line text-gray-400 text-lg"></i>
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-12 pr-4 py-3 bg-gray-950/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all text-sm"
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <i className="ri-lock-line text-gray-400 text-lg"></i>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-12 pr-4 py-3 bg-gray-950/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* Forgot Password + Verify Email */}
            <div className="flex items-center justify-between">
              <Link
                to="/verify-email"
                className="text-sm text-green-400 hover:text-green-300 transition-colors whitespace-nowrap flex items-center gap-1"
              >
                <i className="ri-mail-check-line"></i>
                Verificar Email
              </Link>
              <Link
                to="/forgot-password"
                className="text-sm text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap"
              >
                Esqueceu a senha?
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black py-3 rounded-lg font-bold hover:from-amber-600 hover:to-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap text-sm shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-lg"></i>
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <i className="ri-login-box-line text-lg"></i>
                  <span>Entrar</span>
                </>
              )}
            </button>

            {/* Resend Confirmation Button */}
            {showResendButton && (
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={isResending}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap text-sm"
              >
                {isResending ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-lg"></i>
                    <span>Reenviando...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-mail-send-line text-lg"></i>
                    <span>Reenviar Email de Confirmação</span>
                  </>
                )}
              </button>
            )}
          </form>

          {/* Help Box */}
          {showResendButton && (
            <div className="mt-6 bg-gray-950/50 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                <i className="ri-information-line text-amber-400"></i>
                Precisa de ajuda?
              </h3>
              <ul className="text-xs text-gray-400 space-y-1.5">
                <li className="flex items-start gap-2">
                  <i className="ri-checkbox-circle-line text-amber-400 mt-0.5 flex-shrink-0"></i>
                  <span>Verifique a pasta de spam ou lixo eletrônico</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="ri-checkbox-circle-line text-amber-400 mt-0.5 flex-shrink-0"></i>
                  <span>Aguarde alguns minutos - o email pode demorar</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="ri-checkbox-circle-line text-amber-400 mt-0.5 flex-shrink-0"></i>
                  <span>Certifique-se de que digitou o email correto</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="ri-mail-check-line text-green-400 mt-0.5 flex-shrink-0"></i>
                  <Link
                    to="/verify-email"
                    className="text-green-400 hover:text-green-300 transition-colors"
                  >
                    Confirmar agora: Verificar Email
                  </Link>
                </li>
              </ul>
            </div>
          )}

          {/* Register Link */}
          <div className="mt-6 text-center">
            <p className="text-gray-400 text-sm">
              Não tem uma conta?{' '}
              <Link
                to="/registrar"
                className="text-amber-400 hover:text-amber-300 font-medium transition-colors whitespace-nowrap"
              >
                Cadastre-se agora
              </Link>
            </p>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-6 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm whitespace-nowrap"
          >
            <i className="ri-arrow-left-line"></i>
            <span>Voltar à página inicial</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
