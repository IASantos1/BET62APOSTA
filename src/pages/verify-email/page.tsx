import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Header } from '../../components/feature/Header';
import { Footer } from '../../components/feature/Footer';
import { requestEmailVerification, verifyEmail } from '../../services/backendClient';
import { useAuth } from '../../contexts/AuthContext';

export default function VerifyEmailPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState(user?.email || '');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [debugCode, setDebugCode] = useState<string | undefined>(undefined);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const res = await requestEmailVerification(email.trim().toLowerCase());
      setStatus('success');
      setMessage('Código enviado. Verifique o seu email.');
      setDebugCode(res.debugCode);
      setStep('verify');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Falha ao solicitar código');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const res = await verifyEmail(email.trim().toLowerCase(), code.trim());
      if (res?.ok) {
        setStatus('success');
        setMessage('Email verificado com sucesso.');
      } else {
        setStatus('error');
        setMessage('Não foi possível verificar o email');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Falha na verificação');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Header isLoggedIn={!!user} />
      <main className="flex-1 py-12 px-6">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Verificar Email</h1>
            <p className="text-gray-600 mb-6">
              Receba um código de verificação por email e confirme a sua conta.
            </p>

            {step === 'request' && (
              <form onSubmit={handleRequest} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                    placeholder="seu@email.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'loading' ? <i className="ri-loader-4-line animate-spin"></i> : <i className="ri-mail-send-line"></i>}
                  <span>Enviar Código</span>
                </button>
                {debugCode && (
                  <div className="text-xs text-gray-500 mt-2">
                    Código de teste (dev): <span className="font-mono">{debugCode}</span>
                  </div>
                )}
              </form>
            )}

            {step === 'verify' && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Código</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    pattern="[0-9]{6}"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all text-sm"
                    placeholder="6 dígitos"
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'loading' ? <i className="ri-loader-4-line animate-spin"></i> : <i className="ri-shield-check-line"></i>}
                  <span>Confirmar</span>
                </button>
              </form>
            )}

            {message && (
              <div className={`mt-4 text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </div>
            )}

            <div className="mt-6 text-center text-sm">
              <Link to="/login" className="text-green-700 hover:text-green-800">Voltar ao Login</Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
