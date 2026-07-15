import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { COUNTRIES } from '../../shared/constants';
import { Header } from '../../components/feature/Header';
import { Footer } from '../../components/feature/Footer';
import { useAuth } from '../../contexts/AuthContext';

type RegisterForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nif: string;
  country: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
};

const initialForm: RegisterForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nif: '',
  country: 'PT',
  birthDate: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

export default function RegisterPage() {
  const [formData, setFormData] = useState<RegisterForm>(initialForm);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const maxBirthDate = useMemo(() => {
    const today = new Date();
    today.setFullYear(today.getFullYear() - 18);
    return today.toISOString().split('T')[0];
  }, []);

  const passwordChecks = useMemo(
    () => ({
      length: formData.password.length >= 8,
      uppercase: /[A-Z]/.test(formData.password),
      number: /\d/.test(formData.password),
      symbol: /[^A-Za-z0-9]/.test(formData.password),
    }),
    [formData.password],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const nextValue =
      e.target instanceof HTMLInputElement && e.target.type === 'checkbox'
        ? e.target.checked
        : value;

    setFormData((prev) => ({
      ...prev,
      [name]: nextValue,
    }));
    setError(null);
  };

  const validateAge = (birthDate: string): boolean => {
    if (!birthDate) return false;

    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }

    return age >= 18;
  };

  const validateForm = (): string | null => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      return 'Preencha nome e apelido.';
    }

    if (!formData.email.trim()) {
      return 'Preencha o email.';
    }

    if (!formData.phone.trim()) {
      return 'Preencha o telefone.';
    }

    if (!formData.nif.trim()) {
      return 'Preencha o NIF.';
    }

    if (!formData.country) {
      return 'Selecione o país.';
    }

    if (!validateAge(formData.birthDate)) {
      return 'Tem de ter pelo menos 18 anos para criar conta.';
    }

    if (formData.password !== formData.confirmPassword) {
      return 'As senhas não coincidem.';
    }

    if (!passwordChecks.length || !passwordChecks.uppercase || !passwordChecks.number || !passwordChecks.symbol) {
      return 'A senha deve ter 8+ caracteres, uma maiúscula, um número e um símbolo.';
    }

    if (!formData.acceptTerms) {
      return 'Tem de aceitar os Termos e a Política de Privacidade.';
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await signUp(formData.email.trim(), formData.password, {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        nif: formData.nif.trim(),
        country: formData.country,
        birth_date: formData.birthDate,
      });

      navigate('/');
    } catch (err: any) {
      if (err.message?.includes('rate limit')) {
        setError('Limite temporário de emails atingido. Aguarde um pouco e tente novamente.');
      } else if (err.message?.includes('already')) {
        setError('Este email já está registado. Faça login ou use outro email.');
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao criar conta. Tente novamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordCheckItems = [
    { ok: passwordChecks.length, label: '8+ caracteres' },
    { ok: passwordChecks.uppercase, label: 'Uma letra maiúscula' },
    { ok: passwordChecks.number, label: 'Um número' },
    { ok: passwordChecks.symbol, label: 'Um símbolo' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Header isLoggedIn={false} />

      <main className="flex-1 px-4 py-10 md:px-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl md:p-8">
            <div className="mb-8">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg">
                <i className="ri-user-add-line text-3xl"></i>
              </div>
              <h1 className="text-3xl font-black text-gray-900">Criar Conta na BET62</h1>
              <p className="mt-2 text-sm text-gray-600">
                Registo completo com dados civis, validação reforçada e acesso imediato.
              </p>
            </div>

            {error ? (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <i className="ri-error-warning-line mt-0.5 text-lg text-red-500"></i>
                <span>{error}</span>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor="firstName" className="mb-2 block text-sm font-semibold text-gray-700">
                    Nome
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    autoComplete="given-name"
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="João"
                  />
                </div>

                <div>
                  <label htmlFor="lastName" className="mb-2 block text-sm font-semibold text-gray-700">
                    Apelido
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    autoComplete="family-name"
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Silva"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-semibold text-gray-700">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="seu@email.com"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="mb-2 block text-sm font-semibold text-gray-700">
                    Telefone
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    autoComplete="tel"
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="+351 912 345 678"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <div>
                  <label htmlFor="nif" className="mb-2 block text-sm font-semibold text-gray-700">
                    NIF
                  </label>
                  <input
                    id="nif"
                    name="nif"
                    value={formData.nif}
                    onChange={handleChange}
                    autoComplete="off"
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="123456789"
                  />
                </div>

                <div>
                  <label htmlFor="country" className="mb-2 block text-sm font-semibold text-gray-700">
                    País
                  </label>
                  <select
                    id="country"
                    name="country"
                    value={formData.country}
                    onChange={handleChange}
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="birthDate" className="mb-2 block text-sm font-semibold text-gray-700">
                    Data de Nascimento
                  </label>
                  <input
                    id="birthDate"
                    type="date"
                    name="birthDate"
                    value={formData.birthDate}
                    onChange={handleChange}
                    max={maxBirthDate}
                    required
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-semibold text-gray-700">
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 pr-12 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Crie uma senha forte"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-800"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      <i className={showPassword ? 'ri-eye-off-line text-xl' : 'ri-eye-line text-xl'}></i>
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-gray-700">
                    Confirmar Senha
                  </label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 pr-12 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Repita a senha"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-800"
                      aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                    >
                      <i className={showConfirmPassword ? 'ri-eye-off-line text-xl' : 'ri-eye-line text-xl'}></i>
                    </button>
                  </div>
                </div>
              </div>

              {formData.password ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="mb-3 text-sm font-semibold text-gray-700">Força da senha</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {passwordCheckItems.map((item) => (
                      <div
                        key={item.label}
                        className={`flex items-center gap-2 text-sm ${
                          item.ok ? 'text-emerald-600' : 'text-gray-500'
                        }`}
                      >
                        <i className={item.ok ? 'ri-check-line' : 'ri-close-line'}></i>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <label className="flex items-start gap-3 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    name="acceptTerms"
                    checked={formData.acceptTerms}
                    onChange={handleChange}
                    required
                    className="mt-0.5 h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span>
                    Confirmo que tenho mais de 18 anos e aceito os{' '}
                    <Link to="/termos-e-condicoes" className="font-semibold text-red-600 hover:text-red-700">
                      Termos e Condições
                    </Link>{' '}
                    e a{' '}
                    <Link to="/politica-de-privacidade" className="font-semibold text-red-600 hover:text-red-700">
                      Política de Privacidade
                    </Link>
                    .
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-4 font-bold text-white transition-all hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-lg"></i>
                    <span>A criar conta...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-user-add-line text-lg"></i>
                    <span>Criar Conta e Entrar</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-600">
              Já tem uma conta?{' '}
              <Link to="/login" className="font-semibold text-red-600 hover:text-red-700">
                Entrar agora
              </Link>
            </div>
          </section>

          <aside className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl md:p-8">
            <h2 className="text-xl font-black text-gray-900">Registo Profissional</h2>
            <p className="mt-2 text-sm text-gray-600">
              O fluxo novo evita formulários simples antigos e mantém a conta pronta logo após o cadastro.
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl bg-red-50 p-4">
                <div className="font-semibold text-red-700">Dados completos</div>
                <div className="mt-1 text-sm text-red-600">
                  Nome, apelido, telefone, NIF, país e data de nascimento no mesmo fluxo.
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-50 p-4">
                <div className="font-semibold text-emerald-700">Entrada imediata</div>
                <div className="mt-1 text-sm text-emerald-600">
                  O backend já devolve o utilizador autenticado no signup para evitar uma chamada extra.
                </div>
              </div>

              <div className="rounded-2xl bg-blue-50 p-4">
                <div className="font-semibold text-blue-700">Segurança visível</div>
                <div className="mt-1 text-sm text-blue-600">
                  Checklist de senha forte e campos com validação clara para reduzir erros.
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="grid grid-cols-3 gap-4 text-center text-xs text-gray-500">
                <div>
                  <i className="ri-shield-check-line mb-1 text-xl text-red-500"></i>
                  <div>Fluxo seguro</div>
                </div>
                <div>
                  <i className="ri-flashlight-line mb-1 text-xl text-red-500"></i>
                  <div>Menos passos</div>
                </div>
                <div>
                  <i className="ri-layout-grid-line mb-1 text-xl text-red-500"></i>
                  <div>Sem legado</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}
