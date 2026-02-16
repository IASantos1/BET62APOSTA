import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header } from '../../components/feature/Header';
import { Footer } from '../../components/feature/Footer';
import { useAuth } from '../../contexts/AuthContext';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    birthDate: '',
    acceptTerms: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | null>(null);
  const _navigate = useNavigate();
  const { signUp, signInWithProvider } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setError(null);
  };

  const _validateAge = (birthDate: string): boolean => {
    if (!birthDate) return true;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (formData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setIsSubmitting(true);

    try {
      await signUp(formData.email, formData.password, {
        full_name: formData.fullName,
        phone: formData.phone,
        birth_date: formData.birthDate || '',
      });

      setSuccess(true);
    } catch (err: any) {
      console.error('Erro no registo:', err);
      
      // Tratamento específico para rate limit de email
      if (err.message?.includes('email rate limit exceeded') || err.message?.includes('rate limit')) {
        setError('⚠️ Limite de emails atingido. Isto acontece por segurança quando muitos emails são enviados num curto período. Por favor, aguarde 1 hora e tente novamente, ou contacte o suporte se já se registou recentemente.');
      } else if (err.message?.includes('User already registered')) {
        setError('Este email já está registado. Tente fazer login ou use outro email.');
      } else if (err.message?.includes('Password should be')) {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else if (err.message?.includes('Invalid email')) {
        setError('Por favor, insira um email válido.');
      } else if (err.message?.includes('Email not confirmed')) {
        setError('Email ainda não confirmado. Verifique sua caixa de entrada.');
      } else {
        setError(`Erro ao criar conta: ${err.message || 'Tente novamente mais tarde.'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialSignUp = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider);
    setError(null);
    
    try {
      await signInWithProvider(provider);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `Erro ao registar com ${provider}`;
      setError(errorMessage);
    } finally {
      setSocialLoading(null);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
        <Header isLoggedIn={false} />

        <main className="flex-1 flex items-center justify-center py-12 px-6">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="ri-check-line text-5xl text-green-600"></i>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-3">Conta Criada com Sucesso!</h1>
              <p className="text-gray-600 mb-6">
                Enviámos um email de confirmação para <strong>{formData.email}</strong>. 
                Por favor, verifique sua caixa de entrada e clique no link para ativar sua conta.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <i className="ri-information-line text-amber-600 mr-2 mt-0.5"></i>
                  <p className="text-sm text-amber-800 text-left">
                    Não recebeu o email? Verifique a pasta de spam ou lixo eletrônico.
                  </p>
                </div>
              </div>
              <Link
                to="/verify-email"
                className="inline-flex items-center justify-center w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap mb-3"
              >
                <i className="ri-mail-check-line mr-2"></i>
                Verificar Email
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-login-box-line mr-2"></i>
                Ir para Login
              </Link>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Header isLoggedIn={false} />

      <main className="flex-1 py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <i className="ri-user-add-line text-3xl text-white"></i>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Criar Conta na BET62</h1>
              <p className="text-gray-600">Cadastro rápido em menos de 2 minutos</p>
            </div>

            {/* Social Sign Up Buttons */}
            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={() => handleSocialSignUp('google')}
                disabled={socialLoading !== null}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-800 font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {socialLoading === 'google' ? (
                  <i className="ri-loader-4-line animate-spin text-lg"></i>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                <span>Registar com Google</span>
              </button>

              <button
                type="button"
                onClick={() => handleSocialSignUp('facebook')}
                disabled={socialLoading !== null}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-[#1877F2] hover:bg-[#166FE5] text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {socialLoading === 'facebook' ? (
                  <i className="ri-loader-4-line animate-spin text-lg"></i>
                ) : (
                  <i className="ri-facebook-fill text-xl"></i>
                )}
                <span>Registar com Facebook</span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white text-gray-500">ou preencha o formulário</span>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
                <i className="ri-error-warning-line text-red-500 mr-3 mt-0.5 flex-shrink-0"></i>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="fullName" className="block text-sm font-semibold text-gray-700 mb-2">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    id="fullName"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                    placeholder="João Silva"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-2">
                    Telefone
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                    placeholder="+351 912 345 678"
                  />
                </div>

                <div>
                  <label htmlFor="birthDate" className="block text-sm font-semibold text-gray-700 mb-2">
                    Data de Nascimento
                  </label>
                  <input
                    type="date"
                    id="birthDate"
                    name="birthDate"
                    value={formData.birthDate}
                    onChange={handleChange}
                    max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Deve ter pelo menos 18 anos</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                    Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      required
                      minLength={8}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm pr-12"
                      placeholder="Mínimo 8 caracteres"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      <i className={showPassword ? 'ri-eye-off-line text-xl' : 'ri-eye-line text-xl'}></i>
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                    Confirmar Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      id="confirmPassword"
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      required
                      minLength={8}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm pr-12"
                      placeholder="Repita a senha"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      <i className={showConfirmPassword ? 'ri-eye-off-line text-xl' : 'ri-eye-line text-xl'}></i>
                    </button>
                  </div>
                </div>
              </div>

              {/* Password strength indicator */}
              {formData.password && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2 text-xs">
                    <span className={`flex items-center ${formData.password.length >= 8 ? 'text-green-600' : 'text-gray-400'}`}>
                      <i className={`${formData.password.length >= 8 ? 'ri-check-line' : 'ri-close-line'} mr-1`}></i>
                      8+ caracteres
                    </span>
                    <span className={`flex items-center ${/[A-Z]/.test(formData.password) ? 'text-green-600' : 'text-gray-400'}`}>
                      <i className={`${/[A-Z]/.test(formData.password) ? 'ri-check-line' : 'ri-close-line'} mr-1`}></i>
                      Maiúscula
                    </span>
                    <span className={`flex items-center ${/[0-9]/.test(formData.password) ? 'text-green-600' : 'text-gray-400'}`}>
                      <i className={`${/[0-9]/.test(formData.password) ? 'ri-check-line' : 'ri-close-line'} mr-1`}></i>
                      Número
                    </span>
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    name="acceptTerms"
                    checked={formData.acceptTerms}
                    onChange={handleChange}
                    required
                    className="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-green-500 mt-0.5 cursor-pointer"
                  />
                  <span className="ml-3 text-sm text-gray-700">
                    Eu confirmo que tenho mais de 18 anos e aceito os{' '}
                    <a href="#" className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer">
                      Termos e Condições
                    </a>{' '}
                    e a{' '}
                    <a href="#" className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer">
                      Política de Privacidade
                    </a>
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold rounded-lg transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Criando Conta...
                  </>
                ) : (
                  <>
                    <i className="ri-user-add-line mr-2"></i>
                    Criar Conta e Começar
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-gray-600 text-sm">
                Já tem uma conta?{' '}
                <Link to="/login" className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer">
                  Entrar agora
                </Link>
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-3 gap-4 text-center text-xs text-gray-500">
                <div>
                  <i className="ri-shield-check-line text-green-500 text-xl mb-1"></i>
                  <div>100% Seguro</div>
                </div>
                <div>
                  <i className="ri-time-line text-green-500 text-xl mb-1"></i>
                  <div>Cadastro em 2min</div>
                </div>
                <div>
                  <i className="ri-gift-line text-green-500 text-xl mb-1"></i>
                  <div>Bónus de Boas-Vindas</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
