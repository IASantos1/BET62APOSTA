import { useState, useEffect, type ChangeEvent } from "react";
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { WithdrawForm } from '@/react-app/components/WithdrawForm';

const QUICK_AMOUNTS = [10, 25, 50, 100, 200, 500];

type Method = 'mbway' | 'multibanco' | 'cartao';
type WalletAction = 'deposit' | 'withdraw';

// ─── MBWay ────────────────────────────────────────────────────────────────────
const MBWayForm = ({ amount, onSuccess, forceLight = false }: { amount: number; onSuccess: () => void; forceLight?: boolean }) => {
  const { addNotification, darkMode } = useApp();
  const uiDarkMode = forceLight ? false : darkMode;
  const [phone, setPhone] = useState('');
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    apiFetch<{ available: boolean; publishableKey?: string }>('/api/stripe/config')
      .then((data) => {
        if (!data.available || !data.publishableKey) {
          setUnavailable(true);
          return;
        }
        setStripePromise(loadStripe(data.publishableKey));
      })
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(() => {
    if (!sent || !paymentIntentId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await apiFetch<{ status?: string; error?: string }>(
          `/api/stripe/payment-intent-status?paymentIntentId=${encodeURIComponent(paymentIntentId)}`,
          { method: 'GET' },
        );
        if (cancelled) return;
        if (status?.status === 'succeeded') {
          if (!confirmed) {
            setConfirmed(true);
            addNotification({ type: 'success', message: '✅ Pagamento MB WAY confirmado. Saldo atualizado.' });
            onSuccess();
          }
          clearInterval(interval);
          return;
        }
        if (status?.status === 'requires_payment_method' || status?.status === 'canceled') {
          setError(status?.error || 'O pagamento MB WAY não foi concluído.');
          clearInterval(interval);
        }
      } catch {
        if (!cancelled) {
          /* no-op */
        }
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sent, paymentIntentId, addNotification, confirmed, onSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 9) { setError('Insere um número de telemóvel válido (9 dígitos)'); return; }
    setLoading(true); setError('');
    try {
      if (unavailable) throw new Error('MB WAY não disponível de momento.');
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe ainda a carregar. Tenta novamente.');
      const stripeAny = stripe as any;
      if (typeof stripeAny.confirmMbWayPayment !== 'function') throw new Error('Stripe.js não suporta MB WAY neste ambiente.');

      const formattedPhone = `+351${phone.replace(/\s/g, '')}`;
      const pi = await apiFetch<{ clientSecret?: string; error?: string }>('/api/stripe/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMethod: 'mbway' }),
      });
      if (!pi.clientSecret) throw new Error(pi.error || 'Erro ao iniciar pagamento MB WAY');

      const result = await stripeAny.confirmMbWayPayment(pi.clientSecret, {
        payment_method: {
          billing_details: {
            phone: formattedPhone,
          },
        },
      });
      if (result?.error) throw new Error(result.error.message || 'Pagamento recusado');

      const intent = result?.paymentIntent;
      if (!intent?.id) throw new Error('Não foi possível iniciar o pagamento MB WAY.');
      setPaymentIntentId(intent.id);

      if (intent.status === 'succeeded') {
        await apiFetch('/api/stripe/confirm', { method: 'POST', body: JSON.stringify({ paymentIntentId: intent.id }) });
        setConfirmed(true);
        addNotification({ type: 'success', message: '✅ Pagamento MB WAY confirmado. Saldo atualizado.' });
        onSuccess();
      }

      setSent(true);
      addNotification({ type: 'success', message: '📱 Pedido MBway enviado! Confirma na tua app.' });
    } catch (err: any) {
      const msg = String(err?.message || '');
      setError(/401|Unauthorized/i.test(msg) ? 'Sessão expirada. Faz login novamente.' : msg || 'Erro ao processar MBway');
    } finally { setLoading(false); }
  };

  if (sent) return (
    <div className="text-center py-6">
      <div className="text-4xl mb-3">📱</div>
      <p className={`font-bold text-lg ${confirmed ? 'text-green-400' : 'text-yellow-400'}`}>
        {confirmed ? 'Pagamento confirmado!' : 'Pedido enviado!'}
      </p>
      <p className={`text-sm mt-1 ${uiDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {confirmed
          ? `Saldo atualizado para o depósito de €${amount.toFixed(2)}.`
          : `Abre a tua app MBway e confirma o pagamento de €${amount.toFixed(2)}.`}
      </p>
      {!confirmed && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <p className={`text-xs ${uiDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>A aguardar confirmação...</p>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-1 ${uiDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Número de Telemóvel</label>
        <div className="flex gap-2">
          <span className={`flex items-center px-3 rounded-l-lg border border-r-0 text-sm font-medium ${uiDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-700'}`}>🇵🇹 +351</span>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} maxLength={9} placeholder="912 345 678"
            className={`flex-1 p-3 rounded-r-lg border outline-none focus:ring-2 focus:ring-red-500 ${uiDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={loading} className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2">
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A enviar...</> : `📱 Pagar €${amount.toFixed(2)} via MBway`}
      </button>
      <p className={`text-xs text-center ${uiDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Receberás uma notificação na tua app MBway para confirmar</p>
    </form>
  );
};

// ─── Multibanco ───────────────────────────────────────────────────────────────
type MultibancoRef = {
  entity: string;
  reference: string;
  amount: number;
  expiresAt: number | null;
  hostedVoucherUrl?: string;
  paymentIntentId: string;
  paid?: boolean;
};

const MultibancoForm = ({ amount, onSuccess, forceLight = false }: { amount: number; onSuccess: () => void; forceLight?: boolean }) => {
  const { addNotification, darkMode, user } = useApp();
  const uiDarkMode = forceLight ? false : darkMode;
  const [email, setEmail] = useState((user as any)?.email || '');
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ref, setRef] = useState<MultibancoRef | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ available: boolean; publishableKey?: string }>('/api/stripe/config')
      .then((data) => {
        if (!data.available || !data.publishableKey) {
          setUnavailable(true);
          return;
        }
        setStripePromise(loadStripe(data.publishableKey));
      })
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(() => {
    if (!ref?.paymentIntentId || ref.paid) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await apiFetch<{
          status?: string;
          error?: string;
          voucher?: { entity?: string; reference?: string; expiresAt?: number | null; hostedVoucherUrl?: string } | null;
        }>(`/api/stripe/payment-intent-status?paymentIntentId=${encodeURIComponent(ref.paymentIntentId)}`, { method: 'GET' });

        if (cancelled) return;

        if (status?.voucher?.entity && status?.voucher?.reference) {
          setRef((prev) =>
            prev
              ? {
                  ...prev,
                  entity: String(status.voucher?.entity || prev.entity),
                  reference: String(status.voucher?.reference || prev.reference),
                  expiresAt: typeof status.voucher?.expiresAt === 'number' ? status.voucher.expiresAt : prev.expiresAt,
                  hostedVoucherUrl: String(status.voucher?.hostedVoucherUrl || prev.hostedVoucherUrl || ''),
                }
              : prev,
          );
        }

        if (status?.status === 'succeeded') {
          setRef((prev) => (prev ? { ...prev, paid: true } : prev));
          addNotification({ type: 'success', message: '✅ Pagamento Multibanco confirmado. Saldo atualizado.' });
          clearInterval(interval);
          return;
        }

        if (status?.status === 'requires_payment_method' || status?.status === 'canceled') {
          setError(status?.error || 'A referência Multibanco deixou de estar válida.');
          clearInterval(interval);
        }
      } catch {
        if (!cancelled) {
          /* no-op */
        }
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ref?.paymentIntentId, ref?.paid, addNotification]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Email inválido'); return; }
    setLoading(true); setError('');
    try {
      if (unavailable) throw new Error('Multibanco não disponível de momento.');
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe ainda a carregar. Tenta novamente.');
      const stripeAny = stripe as any;
      if (typeof stripeAny.confirmMultibancoPayment !== 'function') throw new Error('Stripe.js não suporta Multibanco neste ambiente.');

      const pi = await apiFetch<{ clientSecret?: string; error?: string }>('/api/stripe/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMethod: 'multibanco' }),
      });
      if (!pi.clientSecret) throw new Error(pi.error || 'Erro ao iniciar pagamento Multibanco');

      const confirmation = await stripeAny.confirmMultibancoPayment(pi.clientSecret, {
        payment_method: { billing_details: { email } },
      });
      if (confirmation?.error) throw new Error(confirmation.error.message || 'Erro ao gerar referência Multibanco');

      const intent = confirmation?.paymentIntent;
      if (!intent?.id) throw new Error('Não foi possível gerar a referência. Tenta novamente.');

      const details = (intent?.next_action as any)?.multibanco_display_details;
      const entity = String(details?.entity || '');
      const reference = String(details?.reference || '');
      if (!entity || !reference) throw new Error('Não foi possível obter a referência. Tenta novamente.');
      const expiresAt = typeof details?.expires_at === 'number' ? details.expires_at : null;
      const hostedVoucherUrl = String(details?.hosted_voucher_url || '');
      setRef({ entity, reference, amount, expiresAt, paymentIntentId: intent.id, hostedVoucherUrl });

      addNotification({ type: 'success', message: '🏦 Referência Multibanco gerada!' });
    } catch (err: any) {
      const msg = String(err?.message || '');
      setError(/401|Unauthorized/i.test(msg) ? 'Sessão expirada. Faz login novamente.' : msg || 'Erro ao gerar referência Multibanco');
    } finally { setLoading(false); }
  };

  const copy = (val: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(val.replace(/\s/g, '')); setCopied(key); setTimeout(() => setCopied(null), 1500);
    }
  };

  if (ref) {
    const formatRef = (r: string) => r.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
    const expiresStr = ref.expiresAt
      ? new Date(ref.expiresAt * 1000).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '3 dias';
    return (
      <div className="space-y-4">
        {ref.paid && (
          <div className={`rounded-xl p-4 border ${uiDarkMode ? 'bg-green-900/20 border-green-700/40 text-green-200' : 'bg-green-50 border-green-200 text-green-800'}`}>
            Pagamento confirmado. O saldo já foi creditado.
          </div>
        )}
        <div className={`rounded-xl p-4 border-2 ${uiDarkMode ? 'bg-blue-900/20 border-blue-700' : 'bg-blue-50 border-blue-300'}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`font-bold ${uiDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>Referência gerada</span>
          </div>
          <div className="space-y-2.5">
            <div><p className={`text-xs uppercase tracking-wide ${uiDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Entidade</p>
              <div className="flex items-center justify-between gap-2">
                <code className={`text-2xl font-mono font-bold ${uiDarkMode ? 'text-white' : 'text-gray-900'}`}>{ref.entity}</code>
                <button type="button" onClick={() => copy(ref.entity, 'entity')} className={`text-xs px-2 py-1 rounded ${uiDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border'}`}>{copied === 'entity' ? '✓ Copiado' : 'Copiar'}</button>
              </div>
            </div>
            <div><p className={`text-xs uppercase tracking-wide ${uiDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Referência</p>
              <div className="flex items-center justify-between gap-2">
                <code className={`text-xl font-mono font-bold tracking-wider ${uiDarkMode ? 'text-white' : 'text-gray-900'}`}>{formatRef(ref.reference)}</code>
                <button type="button" onClick={() => copy(ref.reference, 'ref')} className={`text-xs px-2 py-1 rounded ${uiDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border'}`}>{copied === 'ref' ? '✓ Copiado' : 'Copiar'}</button>
              </div>
            </div>
            <div><p className={`text-xs uppercase tracking-wide ${uiDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Valor</p>
              <code className={`text-xl font-mono font-bold ${uiDarkMode ? 'text-white' : 'text-gray-900'}`}>€ {ref.amount.toFixed(2)}</code>
            </div>
            <div className={`text-xs pt-2 border-t ${uiDarkMode ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
              ⏱ Válido até <strong>{expiresStr}</strong>
            </div>
          </div>
        </div>
        {ref.hostedVoucherUrl && (
          <button
            type="button"
            onClick={() => window.open(ref.hostedVoucherUrl!, '_blank', 'noopener,noreferrer')}
            className={`w-full py-3 font-bold rounded-xl transition-colors ${uiDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-800 border'}`}
          >
            Abrir voucher
          </button>
        )}
        <div className={`rounded-lg p-3 text-xs ${uiDarkMode ? 'bg-gray-700/50 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
          <p className="font-semibold mb-1">Como pagar:</p>
          <ul className="space-y-0.5 ml-3"><li>• Caixa ATM → Pagamentos → Outros Serviços</li><li>• Homebanking → Pagamentos → Serviços</li><li>• Crédito automático após confirmação</li></ul>
        </div>
        <button type="button" onClick={onSuccess} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors">
          {ref.paid ? '✅ Confirmado' : 'Ok'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={`p-4 rounded-xl border ${uiDarkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-blue-50 border-blue-200'}`}>
        <p className={`text-sm ${uiDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Vais receber uma <strong>referência Multibanco</strong> aqui mesmo, para pagar em qualquer caixa ATM ou homebanking.</p>
        <ul className={`mt-2 text-xs space-y-1 ${uiDarkMode ? 'text-gray-400' : 'text-gray-500'}`}><li>• Pagamento válido por 3 dias</li><li>• Crédito automático após confirmação</li><li>• Sem taxas adicionais</li></ul>
      </div>
      <div>
        <label className={`block text-sm font-medium mb-1 ${uiDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Email para confirmação</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="o-teu@email.pt"
          className={`w-full p-3 rounded-lg border outline-none focus:ring-2 focus:ring-red-500 ${uiDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={loading} className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2">
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A gerar...</> : `🏦 Gerar Referência €${amount.toFixed(2)}`}
      </button>
    </form>
  );
};

// ─── Stripe Card Form ─────────────────────────────────────────────────────────
const StripeCardFormInner = ({ amount, onSuccess, forceLight = false }: { amount: number; onSuccess: () => void; forceLight?: boolean }) => {
  const { addNotification, darkMode } = useApp();
  const uiDarkMode = forceLight ? false : darkMode;
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) { setError('Stripe ainda a carregar. Tenta de novo.'); return; }
    const card = elements.getElement(CardElement);
    if (!card) { setError('Campo de cartão não encontrado.'); return; }
    setLoading(true); setError('');
    try {
      // 1. Create PaymentIntent on the server
      const { clientSecret, error: piErr } = await apiFetch<{ clientSecret?: string; error?: string }>('/api/stripe/create-payment-intent', {
        method: 'POST', body: JSON.stringify({ amount }),
      });
      if (piErr || !clientSecret) throw new Error(piErr || 'Erro ao iniciar pagamento');

      // 2. Confirm the card payment with Stripe
      const { error: confirmErr, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });
      if (confirmErr) throw new Error(confirmErr.message || 'Pagamento recusado');
      if (paymentIntent?.status !== 'succeeded') throw new Error('Pagamento não confirmado');

      // 3. Inform the server to credit the wallet (idempotent)
      await apiFetch('/api/stripe/confirm', {
        method: 'POST', body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });

      addNotification({ type: 'success', message: `💳 Depósito de €${amount.toFixed(2)} confirmado!` });
      onSuccess();
    } catch (err: any) {
      const msg = String(err?.message || '');
      setError(/401|Unauthorized/i.test(msg) ? 'Sessão expirada. Faz login novamente.' : msg || 'Erro no pagamento');
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-1 ${uiDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Dados do Cartão</label>
        <div className={`p-3 rounded-lg border ${uiDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'}`}>
          <CardElement options={{
            style: {
              base: {
                fontSize: '16px',
                color: uiDarkMode ? '#fff' : '#1f2937',
                '::placeholder': { color: uiDarkMode ? '#6b7280' : '#9ca3af' },
                iconColor: uiDarkMode ? '#9ca3af' : '#6b7280',
              },
              invalid: { color: '#ef4444' },
            },
            hidePostalCode: false,
          }} />
        </div>
      </div>

      <div className={`p-3 rounded-lg text-xs ${uiDarkMode ? 'bg-gray-700/50 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span>🔒</span><span className="font-semibold">Pagamento seguro via Stripe</span>
        </div>
        <p>Os teus dados de cartão são processados de forma segura pela Stripe, nunca armazenados nos nossos servidores.</p>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button type="submit" disabled={loading || !stripe} className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2">
        {loading
          ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A processar...</>
          : `💳 Pagar €${amount.toFixed(2)} com Cartão`
        }
      </button>

      <div className="flex items-center justify-center gap-3 opacity-60">
        {['VISA', 'MC', 'AMEX'].map(b => (
          <span key={b} className={`text-xs font-bold px-2 py-0.5 rounded border ${darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>{b}</span>
        ))}
      </div>
    </form>
  );
};

const StripeCardForm = ({ amount, onSuccess, forceLight = false }: { amount: number; onSuccess: () => void; forceLight?: boolean }) => {
  const { darkMode } = useApp();
  const uiDarkMode = forceLight ? false : darkMode;
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    apiFetch<{ available: boolean; publishableKey?: string }>('/api/stripe/config')
      .then(data => {
        if (!data.available || !data.publishableKey) { setUnavailable(true); return; }
        setStripePromise(loadStripe(data.publishableKey));
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-10">
      <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (unavailable) return (
    <div className={`text-center py-6 ${uiDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
      <div className="text-3xl mb-2">💳</div>
      <p className="text-sm">Pagamento por cartão não disponível de momento.</p>
      <p className="text-xs mt-1 opacity-60">Usa MBway ou Multibanco como alternativa.</p>
    </div>
  );

  return (
    <Elements stripe={stripePromise!} options={{ locale: 'pt' }}>
      <StripeCardFormInner amount={amount} onSuccess={onSuccess} forceLight={forceLight} />
    </Elements>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DepositPage() {
  const { darkMode: appDarkMode, user, openAuthModal } = useApp();
  const [amount, setAmount] = useState("25");
  const [amountError, setAmountError] = useState("");
  const [method, setMethod] = useState<Method>('cartao');
  const [walletAction, setWalletAction] = useState<WalletAction>('deposit');
  const [success, setSuccess] = useState(false);

  const numAmount = parseFloat(amount) || 0;
  const isAdmin = !!(user as any)?.is_operator;
  const minDeposit = isAdmin ? 0.5 : 10;
  const lightDepositMode = walletAction === 'deposit';
  const darkMode = lightDepositMode ? false : appDarkMode;

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmount(val);
    setAmountError(parseFloat(val) < minDeposit ? `Valor mínimo: €${minDeposit.toFixed(2)}` : "");
  };
  const handleQuickAmount = (val: number) => { setAmount(String(val)); setAmountError(''); };
  const handleSuccess = () => setSuccess(true);

  const methodTabs: { key: Method; label: string }[] = [
    { key: 'cartao', label: 'Cartão' },
    { key: 'mbway', label: 'MBway' },
    { key: 'multibanco', label: 'Multibanco' },
  ];

  if (!user) return (
    <div className={`max-w-md mx-auto text-center py-16 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <div className="text-5xl mb-4">🔐</div>
      <h2 className="text-xl font-bold mb-2">Sessão necessária</h2>
      <p className={`text-sm mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Tens de iniciar sessão para fazer um depósito ou solicitar um levantamento.</p>
      <button onClick={() => openAuthModal('login')} className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-colors">Entrar na conta</button>
    </div>
  );

  if (success) return (
    <div className="text-center py-10 max-w-md mx-auto">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-green-400 mb-2">Depósito Iniciado!</h2>
      <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>O teu saldo será atualizado assim que o pagamento for confirmado.</p>
      <div className={`rounded-xl p-4 mb-6 text-left border ${darkMode ? 'bg-yellow-900/20 border-yellow-700/40' : 'bg-yellow-50 border-yellow-300'}`}>
        <div className="flex items-center gap-2 mb-2"><span className="text-xl">🎁</span><span className={`font-bold text-sm ${darkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>Promoções Ativadas!</span></div>
        <p className={`text-xs ${darkMode ? 'text-yellow-200/80' : 'text-yellow-700'}`}>Todas as promoções elegíveis foram ativadas automaticamente com este depósito, de acordo com os Termos e Condições de cada uma. Consulta a página de Promoções para ver os bónus disponíveis.</p>
      </div>
      <button onClick={() => setSuccess(false)} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">Novo Depósito</button>
    </div>
  );

  return (
    <div className={`max-w-md mx-auto ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <div className={`grid grid-cols-2 rounded-2xl p-1 mb-4 shadow ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        {([
          { key: 'deposit', label: 'Depósito' },
          { key: 'withdraw', label: 'Levantar' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setWalletAction(tab.key)}
            className={`rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
              walletAction === tab.key
                ? 'bg-red-600 text-white shadow-md'
                : darkMode
                  ? 'text-gray-300 hover:bg-gray-700'
                  : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {walletAction === 'withdraw' ? (
        <div className={`rounded-xl shadow ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="p-5 border-b border-gray-200 dark:border-gray-700 text-center">
            <h2 className="text-xl font-bold mb-1">Levantar</h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Insere o teu IBAN, o nome do titular e solicita o levantamento com mínimo de €20.
            </p>
          </div>
          <div className="p-4">
            <WithdrawForm />
          </div>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-bold mb-4 text-center">Depositar</h2>

          <div className={`p-4 rounded-xl shadow mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Valor do Depósito (€)</label>
            <input type="number" value={amount} onChange={handleAmountChange} min="10" step="5"
              className={`w-full p-3 rounded-lg border focus:ring-2 focus:ring-red-500 outline-none text-lg font-bold ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'} ${amountError ? 'border-red-500' : ''}`}
              placeholder="25" />
            {amountError && <p className="text-red-500 text-xs mt-1">{amountError}</p>}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {QUICK_AMOUNTS.map(v => (
                <button key={v} onClick={() => handleQuickAmount(v)}
                  className={`py-1.5 rounded-lg text-sm font-semibold transition-colors ${numAmount === v ? 'bg-red-600 text-white' : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                  €{v}
                </button>
              ))}
            </div>
          </div>

          <div className={`rounded-xl shadow overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className={`grid grid-cols-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              {methodTabs.map(tab => (
                <button key={tab.key} onClick={() => setMethod(tab.key)}
                  className={`py-3 flex items-center justify-center text-xs font-semibold transition-colors ${method === tab.key ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
            <div className="p-4">
              {numAmount < minDeposit ? (
                <p className="text-center text-gray-500 text-sm py-4">Seleciona um valor mínimo de €{minDeposit.toFixed(2)}</p>
              ) : (
                <>
                  {method === 'cartao' && <StripeCardForm amount={numAmount} onSuccess={handleSuccess} forceLight={lightDepositMode} />}
                  {method === 'mbway' && <MBWayForm amount={numAmount} onSuccess={handleSuccess} forceLight={lightDepositMode} />}
                  {method === 'multibanco' && <MultibancoForm amount={numAmount} onSuccess={handleSuccess} forceLight={lightDepositMode} />}
                </>
              )}
            </div>
          </div>

          <p className={`text-center text-xs mt-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>🔒 Todos os pagamentos são processados com encriptação SSL</p>
        </>
      )}
    </div>
  );
}
