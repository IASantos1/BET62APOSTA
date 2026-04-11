import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { loadStripe, type Appearance } from '@stripe/stripe-js';
import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js';

const stripeKey = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

function CheckoutForm({
  darkMode,
  method,
  clientSecret,
  amount,
  userEmail,
  onBack,
}: {
  darkMode: boolean
  method: 'mb_way' | 'multibanco' | 'card'
  clientSecret: string
  amount: number
  userEmail: string
  onBack: () => void
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { addNotification } = useApp();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [mbDetails, setMbDetails] = useState<{ entity: string; reference: string; amount: number; expires_at?: number } | null>(null);
  const [phone, setPhone] = useState('');
  const [cardReady, setCardReady] = useState(false);
  const [mbEmail, setMbEmail] = useState<string>(() => String(userEmail || '').trim());

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    setMbDetails(null);
    if (!stripe || !elements) return;
    setSubmitting(true);
    try {
      const retUrl = `${window.location.origin}/deposit-success`;
      const tryConfirmDeposit = async (piId: string) => {
        const id = String(piId || '').trim();
        if (!id) return;
        try {
          sessionStorage.setItem('deposit:last_pi', id);
        } catch { void 0; }
        try {
          await apiFetch('/api/wallet/confirm-deposit', {
            method: 'POST',
            body: JSON.stringify({ paymentIntentId: id }),
            cache: 'no-store',
          });
          try { window.dispatchEvent(new Event('wallet:refresh')); } catch { void 0; }
        } catch { void 0; }
      };
      if (method === 'card') {
        const card = elements.getElement(CardElement);
        if (!card) {
          setMessage('A carregar cartão...');
          return;
        }
        const result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card },
        });
        if (result.error) {
          setMessage(result.error.message || 'Pagamento falhou');
          addNotification({ type: 'error', message: result.error.message || 'Pagamento falhou' });
          return;
        }
        const pi: any = result.paymentIntent;
        if (pi?.status === 'succeeded' || pi?.status === 'processing') {
          await tryConfirmDeposit(String(pi?.id || ''));
          window.location.href = retUrl;
          return;
        }
        addNotification({ type: 'success', message: 'Pagamento iniciado.' });
        return;
      }

      if (method === 'mb_way') {
        const cleanPhone = phone.replace(/[^\d+]/g, '').trim();
        if (!cleanPhone) {
          setMessage('Insira o número de telemóvel.');
          return;
        }
        const anyStripe: any = stripe as any;
        if (typeof anyStripe.confirmMbWayPayment !== 'function') {
          setMessage('MB WAY indisponível neste navegador.');
          return;
        }
        const result = await anyStripe.confirmMbWayPayment(
          clientSecret,
          { payment_method: { billing_details: { phone: cleanPhone } } },
          { return_url: retUrl, redirect: 'if_required' },
        );
        if (result?.error) {
          setMessage(result.error.message || 'Pagamento falhou');
          addNotification({ type: 'error', message: result.error.message || 'Pagamento falhou' });
          return;
        }
        const pi: any = result?.paymentIntent;
        if (pi?.status === 'succeeded' || pi?.status === 'processing') {
          await tryConfirmDeposit(String(pi?.id || ''));
          window.location.href = retUrl;
          return;
        }
        addNotification({ type: 'success', message: 'Pagamento iniciado.' });
        return;
      }

      if (method === 'multibanco') {
        const anyStripe: any = stripe as any;
        if (typeof anyStripe.confirmMultibancoPayment !== 'function') {
          setMessage('Multibanco indisponível neste navegador.');
          return;
        }
        const email = String(mbEmail || '').trim();
        if (!email) {
          setMessage('Insira o email para gerar Entidade e Referência.');
          return;
        }
        const result = await anyStripe.confirmMultibancoPayment(
          clientSecret,
          { payment_method: { billing_details: { email } } },
          { return_url: retUrl, redirect: 'if_required' },
        );
        if (result?.error) {
          setMessage(result.error.message || 'Pagamento falhou');
          addNotification({ type: 'error', message: result.error.message || 'Pagamento falhou' });
          return;
        }
        const pi: any = result?.paymentIntent;
        const details = pi?.next_action?.multibanco_display_details || pi?.next_action?.display_multibanco_details;
        if (details?.entity && details?.reference) {
          setMbDetails({
            entity: String(details.entity),
            reference: String(details.reference),
            amount: Number(details.amount) || 0,
            expires_at: typeof details.expires_at === 'number' ? details.expires_at : undefined,
          });
          addNotification({ type: 'success', message: 'Referência Multibanco gerada.' });
          return;
        }
        if (pi?.status === 'succeeded' || pi?.status === 'processing') {
          await tryConfirmDeposit(String(pi?.id || ''));
          window.location.href = retUrl;
          return;
        }
        addNotification({ type: 'success', message: 'Pagamento iniciado.' });
        return;
      }
    } catch (err: any) {
      setMessage(err?.message || 'Erro no pagamento');
      addNotification({ type: 'error', message: err?.message || 'Erro no pagamento' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className={`p-4 rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-extrabold">Pagamento</div>
          <button
            type="button"
            onClick={onBack}
            className={`text-xs font-bold px-3 py-1 rounded-lg border ${darkMode ? 'border-gray-700 bg-gray-900/40 text-gray-200' : 'border-gray-200 bg-white text-gray-900'}`}
          >
            Voltar
          </button>
        </div>
        <div className={`mt-2 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Valor: <span className="font-extrabold">{amount.toFixed(2)} €</span>
        </div>

        {method === 'mb_way' && (
          <div className="mt-4 space-y-2">
            <div className={`text-xs font-bold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Número de telemóvel</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+351 9xx xxx xxx"
              className={`w-full px-3 py-2 rounded-lg border outline-none ${darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'}`}
            />
            <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Use o formato com indicativo (ex.: +351...).</div>
          </div>
        )}

        {method === 'multibanco' && (
          <div className="mt-4 space-y-2">
            <div className={`text-xs font-bold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Email</div>
            <input
              value={mbEmail}
              onChange={(e) => setMbEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className={`w-full px-3 py-2 rounded-lg border outline-none ${darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'}`}
            />
            <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Email usado para gerar a referência Multibanco.</div>
          </div>
        )}

        {method === 'card' && (
          <div className="mt-4 space-y-2">
            <div className={`text-xs font-bold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Cartão</div>
            <div className={`p-3 rounded-lg border ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
              <CardElement
                onReady={() => setCardReady(true)}
                options={{
                  style: {
                    base: { fontSize: '16px', color: darkMode ? '#fff' : '#111827' },
                  },
                }}
              />
            </div>
          </div>
        )}
      </div>

      {mbDetails && (
        <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="text-sm font-bold mb-2">Multibanco</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className={`${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Entidade</div>
            <div className="font-bold text-right">{mbDetails.entity}</div>
            <div className={`${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Referência</div>
            <div className="font-bold text-right">{mbDetails.reference}</div>
            <div className={`${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Valor</div>
            <div className="font-bold text-right">{(mbDetails.amount / 100).toFixed(2)} €</div>
          </div>
        </div>
      )}

      {message && <div className="text-sm text-red-500">{message}</div>}

      <button
        type="submit"
        disabled={!stripe || submitting || (method === 'card' ? !cardReady : false)}
        className={`w-full py-3 rounded-lg font-bold transition-colors ${
          !stripe || submitting || (method === 'card' ? !cardReady : false)
            ? (darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500')
            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        }`}
      >
        {submitting ? 'A processar...' : 'Confirmar pagamento'}
      </button>
    </form>
  );
}

export default function DepositPage() {
  const { darkMode, addNotification, user, openAuthModal } = useApp();
  const [step, setStep] = useState<'method' | 'amount' | 'pay'>('method');
  const [method, setMethod] = useState<'mb_way' | 'multibanco' | 'card' | null>(null);
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState("");
  const [clientSecret, setClientSecret] = useState<string>('');
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(() => (stripeKey ? loadStripe(stripeKey) : null));
  const [stripeConfigError, setStripeConfigError] = useState<string>('');
  const minAmount = user?.is_operator ? 1 : 10;
  const userEmail = String((user as any)?.email || (user as any)?.username || '').trim();

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmount(val);
    if (parseFloat(val) < minAmount) setError(`O valor mínimo para depósito é de €${minAmount}.`);
    else setError("");
  };

  useEffect(() => {
    let alive = true;
    apiFetch<any>('/api/stripe/config', { cache: 'no-store' })
      .then((cfg) => {
        const pk = String(cfg?.publishableKey || '').trim();
        if (!alive) return;
        if (!pk) return;
        setStripePromise(loadStripe(pk));
      })
      .catch((e: any) => {
        if (!alive) return;
        setStripeConfigError(String(e?.message || ''));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const v = parseFloat(amount);
    if (step !== 'pay' || !method) {
      setClientSecret('');
      setLoadingSecret(false);
      return;
    }
    if (!user) {
      setClientSecret('');
      setLoadingSecret(false);
      setStep('method');
      setMethod(null);
      openAuthModal('login');
      return;
    }
    if (!(v >= minAmount)) {
      setClientSecret('');
      return;
    }
    let cancelled = false;
    setLoadingSecret(true);
    const t = setTimeout(async () => {
      try {
        await apiFetch<any>('/api/auth/me', { cache: 'no-store' });
        const res = await apiFetch<{ clientSecret: string }>('/api/wallet/payment-intent', {
          method: 'POST',
          body: JSON.stringify({ amount: v, method }),
          cache: 'no-store',
        });
        if (!cancelled) setClientSecret(String(res?.clientSecret || ''));
      } catch (err: any) {
        const msg = String(err?.message || 'Erro ao iniciar pagamento');
        if (/401|unauthorized/i.test(msg)) {
          if (!cancelled) setClientSecret('');
          if (!cancelled) setLoadingSecret(false);
          if (!cancelled) {
            setStep('method');
            setMethod(null);
          }
          openAuthModal('login');
          return;
        }
        if (!cancelled) setClientSecret('');
        addNotification({ type: 'error', message: msg });
      } finally {
        if (!cancelled) setLoadingSecret(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, method, step, user, openAuthModal]);

  const appearance = useMemo(() => {
    const a = {
      theme: darkMode ? 'night' : 'stripe',
      variables: {
        colorPrimary: '#4f46e5',
      },
    } satisfies Appearance;
    return a;
  }, [darkMode]);

  return (
    <div className={`max-w-md mx-auto p-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <h2 className="text-2xl font-bold mb-8 text-center">
        Depositar
      </h2>

      <div className="flex flex-col space-y-6">
          <div className={`p-6 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Pagamento</h3>
            <p className={`text-xs mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {step === 'method' ? 'Escolha o método de pagamento.' : step === 'amount' ? 'Defina o valor do depósito.' : 'Confirme o pagamento.'}
            </p>
            {step === 'method' && (
              <div className="grid grid-cols-1 gap-2">
                {!user && (
                  <div className={`p-4 rounded-xl border ${darkMode ? 'bg-gray-900/40 border-gray-700 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                    <div className="font-bold">Faça login para depositar</div>
                    <div className="text-xs opacity-80 mt-1">Para creditar o saldo e gerar MB WAY/Multibanco corretamente.</div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => openAuthModal('login')}
                        className="flex-1 py-2 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        Entrar
                      </button>
                      <button
                        onClick={() => openAuthModal('register')}
                        className={`flex-1 py-2 rounded-lg font-bold ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                      >
                        Registar
                      </button>
                    </div>
                  </div>
                )}
                {[
                  { key: 'mb_way' as const, title: 'MB WAY', desc: 'Pagar com número de telefone', icon: '/icons/mbway_official.svg' },
                  { key: 'multibanco' as const, title: 'Multibanco', desc: 'Gerar entidade e referência', icon: '/icons/multibanco_official.svg' },
                  { key: 'card' as const, title: 'Cartão', desc: 'Inserir dados do cartão', icon: '/icons/card.svg' },
                ].map((m) => (
                  <button
                    key={m.key}
                    onClick={() => {
                      if (!user) { openAuthModal('login'); return; }
                      setMethod(m.key);
                      setStep('amount');
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      darkMode ? 'bg-gray-900/40 border-gray-700 hover:bg-gray-900/60' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-10 rounded-lg flex items-center justify-center border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                        <img src={m.icon} alt={m.title} className="max-h-7 max-w-[42px] object-contain" />
                      </div>
                      <div className="min-w-0">
                        <div className={`font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>{m.title}</div>
                        <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{m.desc}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {step === 'amount' && (
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Valor do Depósito (€)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={handleAmountChange}
                    min={String(minAmount)}
                    step="1"
                    className={`w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-colors
                      ${darkMode 
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                        : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500'
                      }
                      ${error ? 'border-red-500 focus:ring-red-500' : ''}
                    `}
                    placeholder="0.00"
                  />
                  {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep('method')}
                    className={`flex-1 py-3 rounded-lg font-bold transition-colors ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                  >
                    Voltar
                  </button>
                  <button
                    onClick={() => {
                      if (!user) { openAuthModal('login'); return; }
                      const v = parseFloat(amount);
                      if (!(v >= minAmount)) { setError(`O valor mínimo para depósito é de €${minAmount}.`); return; }
                      setStep('pay');
                    }}
                    disabled={!!error}
                    className={`flex-1 py-3 rounded-lg font-bold transition-colors ${error ? (darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500') : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {step === 'pay' && (
              <>
                {!stripePromise ? (
                  <div className="text-sm text-red-500">Stripe não configurado{stripeConfigError ? ` (${stripeConfigError})` : ''}.</div>
                ) : !clientSecret ? (
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    {loadingSecret ? 'A preparar pagamento...' : 'A preparar pagamento...'}
                  </div>
                ) : (
                  <Elements
                    stripe={stripePromise}
                    options={{ clientSecret, appearance }}
                    key={clientSecret}
                  >
                    <CheckoutForm
                      darkMode={darkMode}
                      method={method as any}
                      clientSecret={clientSecret}
                      amount={parseFloat(amount) || 0}
                      userEmail={userEmail}
                      onBack={() => { setStep('amount'); setClientSecret(''); }}
                    />
                  </Elements>
                )}
                <button
                  onClick={() => { setStep('amount'); setClientSecret(''); }}
                  className={`w-full mt-3 py-3 rounded-lg font-bold transition-colors ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                >
                  Alterar valor
                </button>
              </>
            )}
          </div>
      </div>
    </div>
  );
}
