import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { COUNTRIES } from '@/shared/constants';
import { useApp } from '@/react-app/contexts/AppContext';
import { useAuth } from '@/react-app/contexts/AuthContext';

type RegisterForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nif: string;
  dob: string;
  country: string;
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
  dob: '',
  country: 'PT',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const { darkMode, addNotification } = useApp();
  const { signUp } = useAuth();

  const [form, setForm] = useState<RegisterForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const inputClass = useMemo(
    () =>
      `w-full rounded-xl border px-4 py-3 outline-none transition-colors ${
        darkMode
          ? 'border-gray-700 bg-gray-900 text-white placeholder:text-gray-500 focus:border-red-500'
          : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-red-500'
      }`,
    [darkMode],
  );

  const maxBirthDate = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date.toISOString().split('T')[0];
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    const nextValue =
      e.target instanceof HTMLInputElement && e.target.type === 'checkbox'
        ? e.target.checked
        : value;
    setForm((prev) => ({ ...prev, [name]: nextValue }));
    setError(null);
  };

  const passwordChecks = useMemo(
    () => ({
      length: form.password.length >= 8,
      uppercase: /[A-Z]/.test(form.password),
      number: /\d/.test(form.password),
      symbol: /[^A-Za-z0-9]/.test(form.password),
    }),
    [form.password],
  );

  const validate = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return 'Preencha nome e apelido.';
    if (!form.email.trim()) return 'Preencha o email.';
    if (!form.dob) return 'Preencha a data de nascimento.';
    if (!form.country) return 'Selecione o país.';
    if (!form.phone.trim()) return 'Preencha o telefone.';
    if (!form.nif.trim()) return 'Preencha o NIF.';
    if (form.password !== form.confirmPassword) return 'As senhas não coincidem.';
    if (!passwordChecks.length || !passwordChecks.uppercase || !passwordChecks.number || !passwordChecks.symbol) {
      return 'A senha deve ter 8+ caracteres, maiúscula, número e símbolo.';
    }
    if (!form.acceptTerms) return 'Tem de aceitar os termos e condições.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await signUp({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        nif: form.nif.trim(),
        dob: form.dob,
        country: form.country,
      });

      if (!result.success) {
        setError(result.error || 'Não foi possível criar a conta. Verifique os dados e tente novamente.');
        return;
      }

      addNotification({ type: 'success', message: 'Conta criada com sucesso' });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`min-h-[calc(100vh-140px)] px-4 py-8 ${darkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section
            className={`rounded-3xl border p-6 shadow-xl ${
              darkMode ? 'border-gray-800 bg-gray-900/70' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="mb-8">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 text-white shadow-lg">
                <i className="ri-user-add-line text-2xl"></i>
              </div>
              <h1 className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>Criar conta profissional</h1>
              <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Registo com mais validações, dados civis e segurança de acesso.
              </p>
            </div>

            {error ? (
              <div
                className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
                  darkMode ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Nome
                  </label>
                  <input name="firstName" value={form.firstName} onChange={handleChange} className={inputClass} placeholder="João" required />
                </div>
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Apelido
                  </label>
                  <input name="lastName" value={form.lastName} onChange={handleChange} className={inputClass} placeholder="Silva" required />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Email
                  </label>
                  <input type="email" name="email" value={form.email} onChange={handleChange} className={inputClass} placeholder="email@exemplo.com" required />
                </div>
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Telefone
                  </label>
                  <input type="tel" name="phone" value={form.phone} onChange={handleChange} className={inputClass} placeholder="+351 912 345 678" required />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    NIF
                  </label>
                  <input name="nif" value={form.nif} onChange={handleChange} className={inputClass} placeholder="123456789" required />
                </div>
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Nascimento
                  </label>
                  <input type="date" name="dob" value={form.dob} onChange={handleChange} max={maxBirthDate} className={inputClass} required />
                </div>
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    País
                  </label>
                  <select name="country" value={form.country} onChange={handleChange} className={inputClass} required>
                    {COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      className={`${inputClass} pr-12`}
                      placeholder="Crie uma senha forte"
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
                <div>
                  <label className={`mb-2 block text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Confirmar senha
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      value={form.confirmPassword}
                      onChange={handleChange}
                      className={`${inputClass} pr-12`}
                      placeholder="Repita a senha"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 text-lg ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      <i className={showConfirmPassword ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
                    </button>
                  </div>
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${darkMode ? 'border-gray-800 bg-gray-950/70' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`mb-2 text-xs font-black uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Requisitos da senha
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    { ok: passwordChecks.length, label: '8 ou mais caracteres' },
                    { ok: passwordChecks.uppercase, label: '1 letra maiúscula' },
                    { ok: passwordChecks.number, label: '1 número' },
                    { ok: passwordChecks.symbol, label: '1 símbolo' },
                  ].map((item) => (
                    <div key={item.label} className={`text-sm ${item.ok ? 'text-emerald-500' : darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      <i className={`${item.ok ? 'ri-checkbox-circle-line' : 'ri-checkbox-blank-circle-line'} mr-2`}></i>
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>

              <label className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${darkMode ? 'border-gray-800 bg-gray-950/70 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                <input type="checkbox" name="acceptTerms" checked={form.acceptTerms} onChange={handleChange} className="mt-1" />
                <span>
                  Confirmo que tenho pelo menos 18 anos, que os meus dados civis são verdadeiros e que aceito os termos, a política de privacidade e as verificações de conformidade da conta.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 font-black text-white transition hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <i className="ri-loader-4-line animate-spin text-lg"></i> : <i className="ri-shield-check-line text-lg"></i>}
                <span>{loading ? 'A criar conta...' : 'Criar conta'}</span>
              </button>

              <div className={`flex items-center justify-between border-t pt-4 text-sm ${darkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                <span>Já tem conta?</span>
                <Link to="/login" className="font-bold text-red-500 hover:text-red-600">
                  Entrar
                </Link>
              </div>
            </form>
          </section>

          <aside
            className={`rounded-3xl border p-6 shadow-xl ${
              darkMode ? 'border-gray-800 bg-gray-900/50 text-white' : 'border-gray-200 bg-white text-gray-900'
            }`}
          >
            <h2 className="text-xl font-black">Verificação inicial</h2>
            <div className={`mt-5 space-y-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <div className="rounded-2xl bg-blue-600/10 px-4 py-3">
                <div className="font-bold text-blue-500">Dados civis</div>
                <div className="mt-1">Nome, NIF, data de nascimento e contacto ficam preparados logo no registo.</div>
              </div>
              <div className="rounded-2xl bg-amber-600/10 px-4 py-3">
                <div className="font-bold text-amber-500">Conta pronta para KYC</div>
                <div className="mt-1">A estrutura já fica mais alinhada com um fluxo profissional de apostas.</div>
              </div>
              <div className="rounded-2xl bg-emerald-600/10 px-4 py-3">
                <div className="font-bold text-emerald-500">Fluxo moderno</div>
                <div className="mt-1">Sem abrir modal sobre a home e com formulário completo de criação de conta.</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
