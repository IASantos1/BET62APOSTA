import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/backendClient';

interface MultibancoFormProps {
  amount: number;
  onSubmit: () => void;
  loading: boolean;
}

export default function MultibancoForm({ amount, onSubmit, loading: _loading }: MultibancoFormProps) {
  const { user } = useAuth();
  const [generatingRef, setGeneratingRef] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [entity, setEntity] = useState('');
  const [reference, setReference] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [hostedVoucherUrl, setHostedVoucherUrl] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'completed'>('idle');
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState<boolean | null>(null);

  const generated = Boolean(entity && reference);

  const applyVoucherDetails = (voucher?: {
    entity?: string;
    reference?: string;
    expiresAt?: number | null;
    hostedVoucherUrl?: string;
  } | null) => {
    if (!voucher) return false;
    const hasCoreVoucher = Boolean(voucher.entity && voucher.reference);
    if (!hasCoreVoucher) return false;
    setEntity(String(voucher.entity || ''));
    setReference(String(voucher.reference || ''));
    setExpiresAt(typeof voucher.expiresAt === 'number' ? voucher.expiresAt : null);
    setHostedVoucherUrl(String(voucher.hostedVoucherUrl || ''));
    return true;
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const cfg = await apiFetch<{ available?: boolean; publishableKey?: string }>('/stripe/config');
        if (!active) return;
        if (!cfg?.available || !cfg?.publishableKey) {
          setStripeAvailable(false);
          setError('Stripe não está configurado corretamente para Multibanco.');
          return;
        }
        setStripePromise(loadStripe(cfg.publishableKey));
        setStripeAvailable(true);
      } catch (err: any) {
        if (!active) return;
        setStripeAvailable(false);
        setError(err?.message || 'Falha ao carregar Stripe para Multibanco.');
      }
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (paymentStatus !== 'pending' || !paymentIntentId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await apiFetch<{
          status?: string;
          error?: string;
          voucher?: {
            entity?: string;
            reference?: string;
            expiresAt?: number | null;
            hostedVoucherUrl?: string;
          } | null;
        }>(`/stripe/payment-intent-status?paymentIntentId=${encodeURIComponent(paymentIntentId)}`, {
          method: 'GET',
        });

        if (cancelled) return;

        applyVoucherDetails(status?.voucher || null);

        if (status?.status === 'succeeded') {
          setPaymentStatus('completed');
          clearInterval(interval);
          return;
        }

        if (status?.status === 'requires_payment_method' || status?.status === 'canceled') {
          setPaymentStatus('idle');
          setError(status?.error || 'A referência Multibanco deixou de estar válida.');
          clearInterval(interval);
        }
      } catch {
        if (!cancelled) {
          // Ignore transient polling errors.
        }
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paymentIntentId, paymentStatus]);

  const handleGenerate = async () => {
    if (!user) {
      setError('Sessão expirada. Faz login para gerar a referência Multibanco.');
      return;
    }
    setGeneratingRef(true);
    setError('');

    try {
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe ainda está a carregar. Tenta novamente.');
      const stripeAny = stripe as any;
      if (typeof stripeAny.confirmMultibancoPayment !== 'function') {
        throw new Error('A versão atual do Stripe.js não suporta Multibanco.');
      }

      const result = await apiFetch<{ clientSecret?: string; paymentIntentId?: string; error?: string }>(
        '/stripe/create-payment-intent',
        {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMethod: 'multibanco' }),
      },
      );

      if (!result?.clientSecret) throw new Error(result?.error || 'Erro ao gerar referência Multibanco');

      const confirmation = await stripeAny.confirmMultibancoPayment(result.clientSecret, {
        payment_method: {
          billing_details: {
            email: user.email,
          },
        },
      });

      if (confirmation?.error) {
        throw new Error(confirmation.error.message || 'Erro ao confirmar pagamento Multibanco');
      }

      const paymentIntent = confirmation?.paymentIntent;
      if (!paymentIntent?.id) {
        throw new Error('Não foi possível gerar a referência Multibanco.');
      }

      setPaymentIntentId(paymentIntent.id);
      const inlineVoucher = applyVoucherDetails(
        (paymentIntent?.next_action as any)?.multibanco_display_details
          ? {
              entity: (paymentIntent?.next_action as any)?.multibanco_display_details?.entity,
              reference: (paymentIntent?.next_action as any)?.multibanco_display_details?.reference,
              expiresAt: (paymentIntent?.next_action as any)?.multibanco_display_details?.expires_at,
              hostedVoucherUrl: (paymentIntent?.next_action as any)?.multibanco_display_details?.hosted_voucher_url,
            }
          : null,
      );

      if (!inlineVoucher) {
        const status = await apiFetch<{
          voucher?: {
            entity?: string;
            reference?: string;
            expiresAt?: number | null;
            hostedVoucherUrl?: string;
          } | null;
        }>(`/stripe/payment-intent-status?paymentIntentId=${encodeURIComponent(paymentIntent.id)}`, {
          method: 'GET',
        });
        applyVoucherDetails(status?.voucher || null);
      }

      setPaymentStatus('pending');
      onSubmit();
    } catch (err) {
      console.error('❌ Erro:', err);
      setError(err instanceof Error ? err.message : 'Erro ao gerar referência');
    } finally {
      setGeneratingRef(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text.replace(/\s/g, ''));
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatReference = (ref: string) => {
    // Formatar referência em grupos de 3 dígitos
    return ref.match(/.{1,3}/g)?.join(' ') || ref;
  };

  if (!user) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-center">
        <i className="ri-lock-line text-3xl text-yellow-600 mb-2"></i>
        <p className="text-sm text-yellow-800 font-medium">Inicia sessão para gerar a referência Multibanco.</p>
      </div>
    );
  }

  if (generated && !generatingRef) {
    return (
      <div>
        {paymentStatus === 'completed' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5">
            <p className="text-sm font-medium text-emerald-800">Pagamento Multibanco confirmado. O saldo já foi creditado.</p>
          </div>
        )}
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="ri-atm-line text-4xl text-teal-600"></i>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Referência Multibanco Gerada</h3>
          <p className="text-sm text-gray-500">Usa estes dados para pagar num ATM ou homebanking</p>
        </div>

        <div className="bg-gradient-to-br from-teal-50 to-teal-100/50 rounded-2xl p-6 mb-5 border border-teal-200">
          <div className="mb-5">
            <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Entidade</p>
            <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-teal-200">
              <span className="text-2xl font-bold font-mono text-gray-900 tracking-wider">{entity}</span>
              <button
                onClick={() => copyToClipboard(entity, 'entity')}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer"
              >
                <i className={`${copied === 'entity' ? 'ri-check-line text-teal-600' : 'ri-file-copy-line text-teal-500'} text-lg`}></i>
              </button>
            </div>
          </div>

          <div className="mb-5">
            <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Referência</p>
            <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-teal-200">
              <span className="text-2xl font-bold font-mono text-gray-900 tracking-wider">{formatReference(reference)}</span>
              <button
                onClick={() => copyToClipboard(reference, 'reference')}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer"
              >
                <i className={`${copied === 'reference' ? 'ri-check-line text-teal-600' : 'ri-file-copy-line text-teal-500'} text-lg`}></i>
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-teal-600 font-medium uppercase tracking-wider mb-1">Valor</p>
            <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-teal-200">
              <span className="text-2xl font-bold font-mono text-gray-900">€{amount.toFixed(2)}</span>
              <button
                onClick={() => copyToClipboard(amount.toFixed(2), 'amount')}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-teal-50 hover:bg-teal-100 transition-colors cursor-pointer"
              >
                <i className={`${copied === 'amount' ? 'ri-check-line text-teal-600' : 'ri-file-copy-line text-teal-500'} text-lg`}></i>
              </button>
            </div>
          </div>
        </div>

        <div className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-200">
          <div className="flex items-start gap-2">
            <i className="ri-timer-line text-amber-600 mt-0.5"></i>
            <div>
              <p className="text-sm font-medium text-amber-800">
                Referência válida até {expiresAt ? new Date(expiresAt * 1000).toLocaleDateString('pt-PT') : '24 horas'}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Após efetuares o pagamento, o saldo será creditado quando a Stripe confirmar a cobrança.
              </p>
            </div>
          </div>
        </div>

        {hostedVoucherUrl && (
          <button
            type="button"
            onClick={() => window.open(hostedVoucherUrl, '_blank', 'noopener,noreferrer')}
            className="w-full mb-4 bg-white border border-teal-200 text-teal-700 py-3 rounded-xl font-semibold hover:bg-teal-50 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <i className="ri-external-link-line text-lg"></i>
            <span>Abrir voucher da Stripe</span>
          </button>
        )}

        <div className="space-y-2 text-sm text-gray-600">
          <p className="font-medium text-gray-800 mb-2">Como pagar:</p>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold shrink-0">1</span>
            <span>Acede ao teu homebanking ou vai a um ATM Multibanco</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold shrink-0">2</span>
            <span>Seleciona &quot;Pagamentos de Serviços&quot;</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold shrink-0">3</span>
            <span>Insere a Entidade, Referência e Valor</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold shrink-0">4</span>
            <span>Confirma o pagamento</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <i className="ri-error-warning-line text-red-500 text-lg flex-shrink-0"></i>
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {stripeAvailable === false && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <i className="ri-error-warning-line text-red-500 text-lg flex-shrink-0"></i>
          <p className="text-sm text-red-800">Multibanco indisponível neste ambiente Stripe.</p>
        </div>
      )}

      <div className="bg-teal-50 rounded-xl p-4 mb-5 flex items-start gap-3">
        <i className="ri-information-line text-teal-600 text-lg mt-0.5"></i>
        <div>
          <p className="text-sm text-teal-800 font-medium">Como funciona o Multibanco?</p>
          <p className="text-xs text-teal-600 mt-1">
            Será gerada uma referência real da Stripe para usares em qualquer ATM Multibanco ou no teu homebanking. O saldo é creditado quando o pagamento for confirmado.
          </p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-5 mb-5 text-center">
        <i className="ri-atm-line text-5xl text-teal-500 mb-3"></i>
        <p className="text-sm text-gray-600 mb-1">Valor do depósito</p>
        <p className="text-3xl font-bold text-gray-900">€{amount.toFixed(2)}</p>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generatingRef || stripeAvailable !== true}
        className="w-full bg-gradient-to-r from-teal-500 to-teal-600 text-white py-4 rounded-xl font-semibold hover:from-teal-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer shadow-lg shadow-teal-200"
      >
        {generatingRef ? (
          <>
            <i className="ri-loader-4-line animate-spin text-xl"></i>
            <span>A gerar referência...</span>
          </>
        ) : (
          <>
            <i className="ri-qr-code-line text-xl"></i>
            <span>Gerar Referência Multibanco</span>
          </>
        )}
      </button>
    </div>
  );
}
