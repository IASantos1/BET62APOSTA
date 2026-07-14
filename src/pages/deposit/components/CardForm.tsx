
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/backendClient';

interface CardFormProps {
  amount: number;
  onSubmit: () => void;
  loading?: boolean;
}

function StripeCardFormInner({
  amount,
  onSubmit,
  externalLoading,
}: {
  amount: number;
  onSubmit: () => void;
  externalLoading?: boolean;
}) {
  const { user } = useAuth();
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { setError('Sessão expirada. Faça login novamente.'); return; }
    if (!stripe || !elements) { setError('Stripe ainda está a carregar. Tenta novamente.'); return; }
    const card = elements.getElement(CardElement);
    if (!card) { setError('Campo de cartão não encontrado.'); return; }
    setError('');
    setLoading(true);
    try {
      const cfg = await apiFetch<{ available?: boolean; publishableKey?: string }>('/stripe/config');
      if (!cfg?.available) throw new Error('Pagamento por cartão indisponível de momento.');

      const pi = await apiFetch<{ clientSecret?: string; error?: string }>('/stripe/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount,
        }),
      });
      if (!pi?.clientSecret) throw new Error(pi?.error || 'Erro ao iniciar pagamento');

      const confirmed = await stripe.confirmCardPayment(pi.clientSecret, {
        payment_method: { card },
      });
      if (confirmed.error) throw new Error(confirmed.error.message || 'Pagamento recusado');
      if (confirmed.paymentIntent?.status !== 'succeeded') throw new Error('Pagamento não confirmado');

      await apiFetch('/stripe/confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId: confirmed.paymentIntent.id,
        }),
      });
      setSuccess(true);
      onSubmit();
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao processar pagamento');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
          <i className="ri-checkbox-circle-fill text-3xl text-green-600"></i>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Pagamento Confirmado!</h3>
        <p className="text-sm text-gray-600 mb-4">O teu depósito de €{amount.toFixed(2)} foi processado com sucesso.</p>
        <p className="text-xs text-gray-500">O saldo será atualizado em instantes.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-100 shrink-0">
            <i className="ri-bank-card-line text-blue-600 text-lg"></i>
          </div>
          <div>
            <p className="font-semibold text-blue-900 text-sm mb-1">Pagamento Seguro por Cartão</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Visa, Mastercard. Transação 100% segura e encriptada.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
        <p className="text-sm text-gray-600">Valor: <span className="font-bold text-gray-900">€{amount.toFixed(2)}</span></p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Dados do Cartão</label>
        <div className="rounded-lg border border-gray-300 p-3 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#111827',
                  '::placeholder': { color: '#9ca3af' },
                  iconColor: '#6b7280',
                },
                invalid: {
                  color: '#dc2626',
                },
              },
              hidePostalCode: false,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">Pagamento seguro via Stripe. Os dados do cartão não são guardados nos nossos servidores.</p>
      </div>

      <button
        type="submit"
        disabled={loading || externalLoading || !stripe}
        className="w-full py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>A processar...</span></>
        ) : (
          <><i className="ri-bank-card-line text-lg"></i><span>Pagar €{amount.toFixed(2)} com Cartão</span></>
        )}
      </button>
    </form>
  );
}

export default function CardForm({ amount, onSubmit, loading: externalLoading }: CardFormProps) {
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const cfg = await apiFetch<{ available?: boolean; publishableKey?: string }>('/stripe/config');
        if (!active) return;
        if (!cfg?.available || !cfg?.publishableKey) {
          setAvailable(false);
          setError('Stripe não está configurado corretamente no ambiente publicado.');
          return;
        }
        setStripePromise(loadStripe(cfg.publishableKey));
        setAvailable(true);
      } catch (err: any) {
        if (!active) return;
        setAvailable(false);
        setError(err?.message || 'Falha ao carregar configuração do cartão.');
      }
    };
    run();
    return () => { active = false; };
  }, []);

  const options = useMemo(() => ({ locale: 'pt' as const }), []);

  if (available === false) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
        <p className="text-sm text-red-700">{error || 'Pagamento por cartão indisponível.'}</p>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm text-gray-700">A carregar Stripe...</p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <StripeCardFormInner amount={amount} onSubmit={onSubmit} externalLoading={externalLoading} />
    </Elements>
  );
}

CardForm.propTypes = {
  amount: PropTypes.number.isRequired,
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};
