import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/backendClient';
import { useNavigate } from 'react-router-dom';

interface MBWayFormProps {
  amount?: number;
  onSubmit?: (phone: string) => void;
  onSuccess?: () => void;
  loading?: boolean;
}

export default function MBWayForm({
  amount: propAmount,
  onSubmit,
  onSuccess,
  loading: externalLoading,
}: MBWayFormProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'succeeded'>('idle');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const successHandledRef = useRef(false);

  const depositAmount = Number(propAmount || 0);

  const normalizePhone = (value: string): string => {
    const clean = value.replace(/[^\d+]/g, '').trim();
    if (!clean) return '';
    if (clean.startsWith('+')) return clean;
    if (clean.startsWith('00')) return `+${clean.slice(2)}`;
    if (/^351\d{9}$/.test(clean)) return `+${clean}`;
    if (/^9\d{8}$/.test(clean)) return `+351${clean}`;
    return clean;
  };

  const finishSuccess = () => {
    if (successHandledRef.current) return;
    successHandledRef.current = true;
    setPaymentStatus('succeeded');
    setSuccess('Pagamento MB WAY confirmado! Saldo atualizado.');
    if (typeof onSuccess === 'function') onSuccess();
  };

  useEffect(() => {
    if (user) {
      setIsAuthenticated(true);
    } else {
      setError('Sessão expirada. A redirecionar para login...');
      setTimeout(() => navigate('/login'), 2000);
    }
  }, [user, navigate]);

  useEffect(() => {
    let active = true;
    const loadStripeConfig = async () => {
      try {
        const cfg = await apiFetch<{ available?: boolean; publishableKey?: string }>('/stripe/config');
        if (!active) return;
        if (!cfg?.available || !cfg?.publishableKey) {
          setStripeAvailable(false);
          setError('Stripe não está configurado corretamente para MB WAY.');
          return;
        }
        setStripePromise(loadStripe(cfg.publishableKey));
        setStripeAvailable(true);
      } catch (err: any) {
        if (!active) return;
        setStripeAvailable(false);
        setError(err?.message || 'Falha ao carregar Stripe para MB WAY.');
      }
    };
    loadStripeConfig();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (paymentStatus !== 'pending' || !paymentIntentId || successHandledRef.current) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await apiFetch<{
          status?: string;
          error?: string;
          balance?: number;
        }>(`/stripe/payment-intent-status?paymentIntentId=${encodeURIComponent(paymentIntentId)}`, {
          method: 'GET',
        });

        if (cancelled) return;

        if (status?.status === 'succeeded') {
          finishSuccess();
          clearInterval(interval);
          return;
        }

        if (status?.status === 'requires_payment_method' || status?.status === 'canceled') {
          setPaymentStatus('idle');
          setError(status?.error || 'O pagamento MB WAY não foi concluído.');
          setSuccess('');
          clearInterval(interval);
        }
      } catch {
        if (!cancelled) {
          // Continue polling quietly for temporary network issues.
        }
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paymentStatus, paymentIntentId]);

  const startMbWayPayment = async (depositAmount: number) => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (!user) throw new Error('Sessão expirada. Por favor, faça login novamente.');
      if (isNaN(depositAmount) || depositAmount < 10) throw new Error('Valor mínimo de depósito é €10');
      if (depositAmount > 10000) throw new Error('Valor máximo de depósito é €10.000');
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone || normalizedPhone.length < 9) {
        throw new Error('Introduz um número de telemóvel válido associado ao MB WAY.');
      }

      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe ainda está a carregar. Tenta novamente.');
      const stripeAny = stripe as any;
      if (typeof stripeAny.confirmMbWayPayment !== 'function') {
        throw new Error('A versão atual do Stripe.js não suporta MB WAY.');
      }

      const response = await apiFetch<{ clientSecret?: string; paymentIntentId?: string; error?: string }>(
        '/stripe/create-payment-intent',
        {
        method: 'POST',
        body: JSON.stringify({ amount: depositAmount, paymentMethod: 'mbway' }),
      },
      );

      if (!response?.clientSecret) throw new Error(response?.error || 'Erro ao iniciar pagamento MB WAY');

      if (typeof onSubmit === 'function') onSubmit(normalizedPhone);

      const result = await stripeAny.confirmMbWayPayment(response.clientSecret, {
        payment_method: {
          billing_details: {
            phone: normalizedPhone,
            email: user.email,
          },
        },
      });

      if (result?.error) throw new Error(result.error.message || 'Pagamento MB WAY recusado.');

      const paymentIntent = result?.paymentIntent;
      if (!paymentIntent?.id) throw new Error('Não foi possível confirmar o pedido MB WAY.');

      setPaymentIntentId(paymentIntent.id);

      if (paymentIntent.status === 'succeeded') {
        await apiFetch('/stripe/confirm', {
          method: 'POST',
          body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
        });
        finishSuccess();
        return;
      }

      setSuccess('Pedido MB WAY enviado. Confirma o pagamento na app MB WAY.');
      setPaymentStatus('pending');
    } catch (err: any) {
      const msg = String(err?.message || 'Erro ao processar pagamento');
      if (msg.includes('Sessão expirada') || msg.includes('login novamente')) {
        setError(`${msg} Redirecionando...`);
        setTimeout(() => navigate('/login'), 2000);
      } else {
        setError(msg);
      }
      setPaymentStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await startMbWayPayment(depositAmount);
  };

  if (!isAuthenticated) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-center">
        <i className="ri-lock-line text-3xl text-yellow-600 mb-2"></i>
        <p className="text-sm text-yellow-800 font-medium">A verificar sessão...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Número MB WAY</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">+</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="351 912 345 678"
            required
            disabled={loading || paymentStatus !== 'idle'}
            className="w-full pl-10 pr-4 py-3.5 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          />
        </div>
        <p className="mt-2 text-xs text-gray-400">Usa o número de telemóvel associado à tua app MB WAY.</p>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
        <p className="text-sm text-gray-600">
          Valor: <span className="font-bold text-gray-900">€{depositAmount.toFixed(2)}</span>
        </p>
      </div>
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-sm text-green-700">{success}</p>
          {paymentStatus === 'pending' && (
            <div className="mt-3 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-green-600">A aguardar confirmação...</span>
            </div>
          )}
        </div>
      )}
      {stripeAvailable === false && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700">MB WAY indisponível neste ambiente Stripe.</p>
        </div>
      )}
      {stripeAvailable === null && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-700">A carregar Stripe para MB WAY...</p>
        </div>
      )}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <h4 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <i className="ri-information-line text-teal-500"></i>
          Como funciona o MB WAY
        </h4>
        <ul className="text-xs text-gray-500 space-y-1 ml-6">
          <li>• Introduz o número associado ao MB WAY</li>
          <li>• Receberás um pedido de aprovação na app</li>
          <li>• O saldo é creditado assim que a Stripe confirmar o pagamento</li>
        </ul>
      </div>
      <button
        type="submit"
        disabled={loading || externalLoading || paymentStatus !== 'idle' || stripeAvailable !== true}
        className="w-full py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
      >
        {loading ? (
          <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>A processar...</span></>
        ) : paymentStatus === 'pending' ? (
          <><i className="ri-smartphone-line text-lg"></i><span>Aguardando confirmação...</span></>
        ) : (
          <><i className="ri-smartphone-line text-lg"></i><span>Pagar com MB WAY</span></>
        )}
      </button>
    </form>
  );
}
