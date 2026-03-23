import { useState, type ChangeEvent } from "react";
import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || "";
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLIC_KEY || import.meta.env.VITE_STRIPE_PK || "";
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

type Method = 'paypal' | 'mbway' | 'multibanco' | 'card';

const QUICK_AMOUNTS = [10, 25, 50, 100, 200, 500];

const PayPalPayment = ({ amount }: { amount: string }) => {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  const { addNotification } = useApp();

  if (isRejected) {
    return <div className="text-red-500 text-center p-4 text-sm">Erro ao carregar PayPal. Por favor, recarregue a página.</div>;
  }

  return (
    <>
      {isPending && <div className="flex justify-center py-4"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
      <PayPalButtons
        style={{ layout: "vertical", color: "gold", shape: "rect", label: "pay" }}
        disabled={parseFloat(amount) < 10}
        forceReRender={[amount]}
        createOrder={async (_data, _actions) => {
          try {
            const res = await apiFetch<{ orderId: string }>('/api/deposits/paypal/create-order', {
              method: 'POST',
              body: JSON.stringify({ amount: parseFloat(amount) })
            });
            return res.orderId;
          } catch (err: any) {
            addNotification({ type: 'error', message: 'Erro ao criar ordem: ' + err.message });
            throw err;
          }
        }}
        onApprove={async (data, _actions) => {
          try {
            const res = await apiFetch<{ status: string }>('/api/deposits/paypal/capture-order', {
              method: 'POST',
              body: JSON.stringify({ orderId: data.orderID })
            });
            if (res.status === 'COMPLETED') {
              addNotification({ type: 'success', message: '✅ Depósito realizado com sucesso!' });
            } else {
              addNotification({ type: 'error', message: 'Pagamento não concluído: ' + res.status });
            }
          } catch (err: any) {
            addNotification({ type: 'error', message: 'Erro ao validar pagamento: ' + err.message });
          }
        }}
        onError={(err: any) => {
          console.error("PayPal Button Error:", err);
          addNotification({ type: 'error', message: 'Erro no PayPal. Tente novamente.' });
        }}
      />
    </>
  );
};

const StripeCardForm = ({ amount, onSuccess }: { amount: number; onSuccess: () => void }) => {
  const stripe = useStripe();
  const elements = useElements();
  const { addNotification, darkMode } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');
    try {
      const { clientSecret } = await apiFetch<{ clientSecret: string }>('/api/wallet/deposit/stripe/card', {
        method: 'POST',
        body: JSON.stringify({ amount })
      });

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Elemento de cartão não encontrado');

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement }
      });

      if (stripeError) {
        setError(stripeError.message || 'Erro no pagamento');
      } else if (paymentIntent?.status === 'succeeded') {
        addNotification({ type: 'success', message: '✅ Pagamento com cartão efetuado!' });
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={`p-3 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'}`}>
        <CardElement options={{ hidePostalCode: true, style: { base: { color: darkMode ? '#fff' : '#111', fontSize: '16px' } } }} />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A processar...</> : `💳 Pagar €${amount.toFixed(2)}`}
      </button>
    </form>
  );
};

const MBWayForm = ({ amount, onSuccess }: { amount: number; onSuccess: () => void }) => {
  const { addNotification, darkMode } = useApp();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 9) {
      setError('Insere um número de telemóvel válido (9 dígitos)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const formattedPhone = phone.startsWith('+351') ? phone : `+351${phone.replace(/\s/g, '')}`;
      await apiFetch('/api/wallet/deposit/stripe/mbway', {
        method: 'POST',
        body: JSON.stringify({ amount, phone: formattedPhone })
      });
      setSent(true);
      addNotification({ type: 'success', message: '📱 Pedido MBway enviado! Confirma na tua app.' });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao processar MBway');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-3">📱</div>
        <p className="font-bold text-green-400 text-lg">Pedido enviado!</p>
        <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Abre a tua app MBway e confirma o pagamento de €{amount.toFixed(2)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Número de Telemóvel</label>
        <div className="flex gap-2">
          <span className={`flex items-center px-3 rounded-l-lg border border-r-0 text-sm font-medium ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-700'}`}>🇵🇹 +351</span>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            maxLength={9}
            placeholder="912 345 678"
            className={`flex-1 p-3 rounded-r-lg border outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
          />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
      >
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A enviar...</> : `📱 Pagar €${amount.toFixed(2)} via MBway`}
      </button>
      <p className={`text-xs text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Receberás uma notificação na tua app MBway para confirmar</p>
    </form>
  );
};

const MultibancoForm = ({ amount, onSuccess }: { amount: number; onSuccess: () => void }) => {
  const { addNotification, darkMode } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { url } = await apiFetch<{ url: string }>('/api/wallet/deposit/stripe/multibanco', {
        method: 'POST',
        body: JSON.stringify({ amount })
      });
      if (url) {
        addNotification({ type: 'success', message: '🏦 A redirecionar para Multibanco...' });
        window.location.href = url;
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar referência Multibanco');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={`p-4 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-blue-50 border-blue-200'}`}>
        <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Vais receber uma <strong>referência Multibanco</strong> para pagar em qualquer caixa ATM ou homebanking.</p>
        <ul className={`mt-2 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <li>• Pagamento válido por 3 dias</li>
          <li>• Crédito automático após confirmação</li>
          <li>• Sem taxas adicionais</li>
        </ul>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
      >
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A gerar...</> : `🏦 Gerar Referência €${amount.toFixed(2)}`}
      </button>
    </form>
  );
};

export default function DepositPage() {
  const { darkMode } = useApp();
  const [amount, setAmount] = useState("25");
  const [amountError, setAmountError] = useState("");
  const [method, setMethod] = useState<Method>('paypal');
  const [success, setSuccess] = useState(false);

  const numAmount = parseFloat(amount) || 0;

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmount(val);
    setAmountError(parseFloat(val) < 10 ? "Valor mínimo: €10" : "");
  };

  const handleQuickAmount = (val: number) => {
    setAmount(String(val));
    setAmountError('');
  };

  const handleSuccess = () => setSuccess(true);

  const methodTabs: { key: Method; label: string; icon: string }[] = [
    { key: 'paypal', label: 'PayPal / Cartão', icon: '🅿️' },
    { key: 'mbway', label: 'MBway', icon: '📱' },
    { key: 'multibanco', label: 'Multibanco', icon: '🏦' },
    { key: 'card', label: 'Cartão Stripe', icon: '💳' },
  ];

  if (success) {
    return (
      <div className="text-center py-10">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-green-400 mb-2">Depósito Iniciado!</h2>
        <p className={`text-sm mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>O teu saldo será atualizado assim que o pagamento for confirmado.</p>
        <button onClick={() => setSuccess(false)} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">Novo Depósito</button>
      </div>
    );
  }

  return (
    <div className={`max-w-md mx-auto ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <h2 className="text-xl font-bold mb-4 text-center">💰 Depositar</h2>

      {/* Valor */}
      <div className={`p-4 rounded-xl shadow mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Valor do Depósito (€)</label>
        <input
          type="number"
          value={amount}
          onChange={handleAmountChange}
          min="10"
          step="5"
          className={`w-full p-3 rounded-lg border focus:ring-2 focus:ring-red-500 outline-none text-lg font-bold ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'} ${amountError ? 'border-red-500' : ''}`}
          placeholder="25"
        />
        {amountError && <p className="text-red-500 text-xs mt-1">{amountError}</p>}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {QUICK_AMOUNTS.map(v => (
            <button
              key={v}
              onClick={() => handleQuickAmount(v)}
              className={`py-1.5 rounded-lg text-sm font-semibold transition-colors ${numAmount === v ? 'bg-red-600 text-white' : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            >
              €{v}
            </button>
          ))}
        </div>
      </div>

      {/* Método de pagamento */}
      <div className={`rounded-xl shadow overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <div className="grid grid-cols-2 border-b border-gray-700">
          {methodTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMethod(tab.key)}
              className={`py-3 text-xs font-semibold transition-colors ${method === tab.key ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {numAmount < 10 ? (
            <p className="text-center text-gray-500 text-sm py-4">Seleciona um valor mínimo de €10</p>
          ) : (
            <>
              {method === 'paypal' && (
                <PayPalScriptProvider options={{ clientId: PAYPAL_CLIENT_ID, currency: "EUR", intent: "capture", "disable-funding": "venmo,applepay" }}>
                  <div>
                    <p className="text-xs text-center text-gray-400 mb-3 uppercase tracking-wide">Pagamento Seguro via PayPal</p>
                    <PayPalPayment amount={amount} />
                  </div>
                </PayPalScriptProvider>
              )}

              {method === 'mbway' && (
                <MBWayForm amount={numAmount} onSuccess={handleSuccess} />
              )}

              {method === 'multibanco' && (
                <MultibancoForm amount={numAmount} onSuccess={handleSuccess} />
              )}

              {method === 'card' && (
                stripePromise ? (
                  <Elements stripe={stripePromise}>
                    <StripeCardForm amount={numAmount} onSuccess={handleSuccess} />
                  </Elements>
                ) : (
                  <p className="text-center text-yellow-500 text-sm py-4">Stripe não configurado. Contacta o suporte.</p>
                )
              )}
            </>
          )}
        </div>
      </div>

      <p className={`text-center text-xs mt-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>🔒 Todos os pagamentos são processados com encriptação SSL</p>
    </div>
  );
}
