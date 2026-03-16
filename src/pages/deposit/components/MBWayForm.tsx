
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/backendClient';
import { useNavigate } from 'react-router-dom';

/**
 * MBWayForm component
 *
 * Props:
 * - amount (number) – optional fixed amount to deposit
 * - onSubmit (function) – optional callback receiving the formatted phone number
 * - onSuccess (function) – optional callback after a successful payment
 * - loading (boolean) – optional external loading flag
 */
interface MBWayFormProps {
  amount?: number;
  onSubmit?: (phone: string) => void;
  onSuccess?: () => void;
  loading?: boolean;
}

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

interface MBWayStripeConfirmProps {
  onConfirmed: () => void;
  disabled: boolean;
}

function MBWayStripeConfirm({ onConfirmed, disabled }: MBWayStripeConfirmProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleConfirm = async () => {
    if (!stripe || !elements) {
      return;
    }
    setLocalError('');
    setSubmitting(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (result.error) {
        const raw = result.error.message || 'Erro ao confirmar pagamento MB WAY';
        const friendly =
          raw.includes('missing a payment method') ||
          raw.toLowerCase().includes('paymentintent')
            ? 'Para confirmar o pagamento MB WAY, preenche primeiro o número de telemóvel no bloco acima e volta a tentar.'
            : raw;
        setLocalError(friendly);
        return;
      }

      const pi = result.paymentIntent;
      if (pi?.id) {
        try {
          const response = await apiFetch('/payments/stripe/mbway/confirm', {
            method: 'POST',
            body: JSON.stringify({ payment_intent_id: pi.id }),
          });
          if (response?.ok) {
            onConfirmed();
          } else if (response?.error) {
            setLocalError(response.error);
          } else {
            setLocalError('Não foi possível confirmar o pagamento MB WAY. Tenta novamente em instantes.');
          }
        } catch (err: any) {
          const msg = err?.message || 'Erro ao confirmar pagamento MB WAY';
          setLocalError(msg);
        }
      } else {
        onConfirmed();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl p-4 bg-white">
        <PaymentElement />
      </div>
      {localError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-xs text-red-700">{localError}</p>
        </div>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={disabled || submitting}
        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            <span>A confirmar com MB WAY...</span>
          </>
        ) : (
          <>
            <i className="ri-smartphone-line text-lg" />
            <span>Confirmar pagamento MB WAY</span>
          </>
        )}
      </button>
    </div>
  );
}

export default function MBWayForm({
  amount: propAmount,
  onSubmit,
  onSuccess,
  loading: _externalLoading,
}: MBWayFormProps) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('idle'); // 'idle' | 'pending' | 'checking'
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [initialBalance, setInitialBalance] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  /** ----------------------------------------------------------------------
   *  Authentication check – runs once on mount
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    if (user) {
      setIsAuthenticated(true);
    } else {
      setError('Sessão expirada. A redirecionar para login...');
      setTimeout(() => navigate('/login'), 2000);
    }
  }, [user, navigate]);

  useEffect(() => {
    if (paymentStatus !== 'pending' || initialBalance == null) {
      return;
    }

    let cancelled = false;
    const interval = setInterval(async () => {
      const wallet = await apiFetch('/wallet', { method: 'GET' });
      const currentBalance = Number(wallet?.balance ?? 0);
      if (!cancelled && currentBalance > initialBalance) {
        setSuccess('Pagamento MB WAY confirmado! Saldo atualizado.');
        setPaymentStatus('idle');
        clearInterval(interval);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paymentStatus, initialBalance]);

  const startMbWayPayment = async (depositAmount: number) => {
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!user) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }

      if (isNaN(depositAmount) || depositAmount < 10) {
        throw new Error('Valor mínimo de depósito é €10');
      }
      if (depositAmount > 10000) {
        throw new Error('Valor máximo de depósito é €10.000');
      }

      const wallet = await apiFetch('/wallet', { method: 'GET' });
      const startBalance = Number(wallet?.balance ?? 0);
      setInitialBalance(startBalance);

      if (typeof onSubmit === 'function') {
        onSubmit('');
      }

      const response = await apiFetch('/payments/stripe/mbway', {
        method: 'POST',
        body: JSON.stringify({
          amount: depositAmount,
        }),
      });

      if (!response?.ok || !response.client_secret) {
        throw new Error('Erro ao iniciar pagamento MB WAY');
      }

      setClientSecret(response.client_secret);
      setSuccess('📱 Pedido MB WAY criado. Confirme o pagamento abaixo para receber a notificação na app MB WAY.');

      if (typeof onSuccess === 'function') {
        onSuccess();
      }
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
    const depositAmount = propAmount ?? parseFloat(amount);
    await startMbWayPayment(depositAmount);
  };

  useEffect(() => {
    if (!propAmount || !isAuthenticated || clientSecret || loading) {
      return;
    }
    const depositAmount = propAmount;
    startMbWayPayment(depositAmount);
  }, [propAmount, isAuthenticated]);

  /** ----------------------------------------------------------------------
   *  Render
   * ---------------------------------------------------------------------- */
  if (!isAuthenticated) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-center">
        <i className="ri-lock-line text-3xl text-yellow-600 mb-2"></i>
        <p className="text-sm text-yellow-800 font-medium">A verificar sessão...</p>
      </div>
    );
  }

  if (propAmount) {
    return (
      <div className="space-y-6">
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

        {loading && !clientSecret && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-700">
              A preparar pagamento MB WAY seguro...
            </p>
          </div>
        )}

        {clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <MBWayStripeConfirm
              disabled={loading || paymentStatus === 'pending'}
              onConfirmed={() => {
                setPaymentStatus('pending');
                setSuccess('📱 Pedido MB WAY enviado. Confirme o pagamento na app MB WAY.');
              }}
            />
          </Elements>
        )}

        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
          <h4 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <i className="ri-information-line text-teal-500"></i>
            Como funciona o MB WAY
          </h4>
          <ul className="text-xs text-gray-500 space-y-1 ml-6">
            <li>• Receberá uma notificação na app MB WAY</li>
            <li>• Confirme o pagamento no telemóvel</li>
            <li>• O saldo será creditado automaticamente na carteira</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Amount input – only when amount not forced via prop */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Valor do Depósito
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
            €
          </span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10.00"
            min="10"
            max="10000"
            step="0.01"
            required
            disabled={loading || paymentStatus !== 'idle'}
            className="w-full pl-10 pr-4 py-3.5 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          />
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Valor mínimo: €10.00 | Máximo: €10.000
        </p>
      </div>

      {/* Error / Success messages */}
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

      {/* Submit button */}
      <button
        type="submit"
        disabled={loading || paymentStatus !== 'idle' || !!clientSecret}
        className="w-full py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
      >
        {loading ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>A processar...</span>
          </>
        ) : paymentStatus === 'pending' ? (
          <>
            <i className="ri-smartphone-line text-lg"></i>
            <span>Aguardando confirmação...</span>
          </>
        ) : (
          <>
            <i className="ri-smartphone-line text-lg"></i>
            <span>Pagar com MB WAY</span>
          </>
        )}
      </button>

      {clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <MBWayStripeConfirm
            disabled={loading || paymentStatus === 'pending'}
            onConfirmed={() => {
              setPaymentStatus('pending');
              setSuccess('📱 Pedido MB WAY enviado. Confirme o pagamento na app MB WAY.');
              setAmount('');
            }}
          />
        </Elements>
      )}
    </form>
  );
}
