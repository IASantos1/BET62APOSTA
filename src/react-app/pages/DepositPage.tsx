import { useState, type ChangeEvent } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';

const QUICK_AMOUNTS = [10, 25, 50, 100, 200, 500];

function getStripePromise() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('bet62_stripe_pk') : null;
  const pk = stored || import.meta.env.VITE_STRIPE_PUBLIC_KEY || import.meta.env.VITE_STRIPE_PK || '';
  return pk ? loadStripe(pk) : null;
}

type Method = 'card' | 'mbway' | 'multibanco';

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
        // Credit wallet directly (webhook fallback for dev/test environments)
        try {
          await apiFetch('/api/wallet/deposit/stripe/confirm', {
            method: 'POST',
            body: JSON.stringify({ paymentIntentId: paymentIntent.id })
          });
        } catch { /* webhook may have already credited; ignore */ }
        addNotification({ type: 'success', message: '✅ Saldo creditado com sucesso! Boas apostas.' });
        onSuccess();
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/401|Unauthorized/i.test(msg)) {
        setError('Sessão expirada. Faz login novamente.');
      } else {
        setError(msg || 'Erro inesperado');
      }
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
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
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
      const msg = String(err?.message || '');
      setError(/401|Unauthorized/i.test(msg) ? 'Sessão expirada. Faz login novamente.' : msg || 'Erro ao processar MBway');
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
            className={`flex-1 p-3 rounded-r-lg border outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
          />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
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
      const msg = String(err?.message || '');
      setError(/401|Unauthorized/i.test(msg) ? 'Sessão expirada. Faz login novamente.' : msg || 'Erro ao gerar referência Multibanco');
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
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
      >
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> A gerar...</> : `🏦 Gerar Referência €${amount.toFixed(2)}`}
      </button>
    </form>
  );
};

// ── Stripe Key Manager (admin/operator) ────────────────────────────────────────
export function StripeKeyManager({ darkMode }: { darkMode: boolean }) {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [show, setShow] = useState(false);

  const currentKey = typeof localStorage !== 'undefined' ? (localStorage.getItem('bet62_stripe_pk') || '') : '';
  const masked = currentKey ? `${currentKey.slice(0, 8)}...${currentKey.slice(-4)}` : 'Não configurado';

  const handleSave = () => {
    if (!key.startsWith('pk_')) {
      alert('A chave deve começar com pk_live_ ou pk_test_');
      return;
    }
    localStorage.setItem('bet62_stripe_pk', key.trim());
    setSaved(true);
    setKey('');
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className={`p-4 rounded-xl border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔑</span>
        <h3 className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Chave Stripe</h3>
      </div>
      <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Chave atual: <code className="font-mono">{masked}</code>
      </p>
      {show ? (
        <div className="space-y-2">
          <input
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="pk_live_..."
            className={`w-full p-2 rounded-lg border text-sm font-mono ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-sm"
            >
              {saved ? '✅ Salvo!' : 'Salvar'}
            </button>
            <button
              onClick={() => setShow(false)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShow(true)}
          className="text-sm text-blue-500 hover:underline"
        >
          Alterar chave Stripe Live →
        </button>
      )}
    </div>
  );
}

export default function DepositPage() {
  const { darkMode, user, openAuthModal } = useApp();
  const [amount, setAmount] = useState("25");
  const [amountError, setAmountError] = useState("");
  const [method, setMethod] = useState<Method>('card');
  const [success, setSuccess] = useState(false);

  const numAmount = parseFloat(amount) || 0;
  const stripePromise = getStripePromise();

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

  const PaymentLogo = ({ method: m }: { method: Method }) => {
    if (m === 'card') return (
      <span className="flex items-center gap-1">
        <svg viewBox="0 0 48 30" width="30" height="19" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="30" rx="4" fill="#1a1f71"/>
          <rect y="7" width="48" height="8" fill="#f7b600"/>
          <text x="6" y="24" fontSize="9" fill="#fff" fontFamily="Arial" fontWeight="bold">VISA</text>
        </svg>
        <svg viewBox="0 0 48 30" width="30" height="19" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="30" rx="4" fill="#fff" stroke="#ddd"/>
          <circle cx="18" cy="15" r="9" fill="#eb001b"/>
          <circle cx="30" cy="15" r="9" fill="#f79e1b"/>
          <path d="M24 8.3a9 9 0 0 1 0 13.4A9 9 0 0 1 24 8.3z" fill="#ff5f00"/>
        </svg>
      </span>
    );
    if (m === 'mbway') return (
      <svg viewBox="0 0 48 20" width="40" height="17" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="20" rx="4" fill="#e2001a"/>
        <text x="5" y="14" fontSize="10" fill="#fff" fontFamily="Arial" fontWeight="bold">MB WAY</text>
      </svg>
    );
    if (m === 'multibanco') return (
      <svg viewBox="0 0 48 20" width="40" height="17" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="20" rx="4" fill="#003b95"/>
        <text x="4" y="14" fontSize="9" fill="#fff" fontFamily="Arial" fontWeight="bold">Multibanco</text>
      </svg>
    );
    return null;
  };

  const methodTabs: { key: Method; label: string }[] = [
    { key: 'card', label: 'Cartão' },
    { key: 'mbway', label: 'MBway' },
    { key: 'multibanco', label: 'Multibanco' },
  ];

  if (!user) {
    return (
      <div className={`max-w-md mx-auto text-center py-16 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        <div className="text-5xl mb-4">🔐</div>
        <h2 className="text-xl font-bold mb-2">Sessão necessária</h2>
        <p className={`text-sm mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Tens de iniciar sessão para fazer um depósito.</p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-colors"
        >
          Entrar na conta
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center py-10 max-w-md mx-auto">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-green-400 mb-2">Depósito Iniciado!</h2>
        <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>O teu saldo será atualizado assim que o pagamento for confirmado.</p>
        <div className={`rounded-xl p-4 mb-6 text-left border ${darkMode ? 'bg-yellow-900/20 border-yellow-700/40' : 'bg-yellow-50 border-yellow-300'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🎁</span>
            <span className={`font-bold text-sm ${darkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>Promoções Ativadas!</span>
          </div>
          <p className={`text-xs ${darkMode ? 'text-yellow-200/80' : 'text-yellow-700'}`}>
            Todas as promoções elegíveis foram ativadas automaticamente com este depósito, de acordo com os Termos e Condições de cada uma. Consulta a página de Promoções para ver os bónus disponíveis.
          </p>
        </div>
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
        <div className="grid grid-cols-3 border-b border-gray-700">
          {methodTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMethod(tab.key)}
              className={`py-2.5 flex flex-col items-center gap-1 text-xs font-semibold transition-colors ${method === tab.key ? 'text-red-500 border-b-2 border-red-500 bg-red-500/10' : darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <PaymentLogo method={tab.key} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="p-4">
          {numAmount < 10 ? (
            <p className="text-center text-gray-500 text-sm py-4">Seleciona um valor mínimo de €10</p>
          ) : (
            <>
              {method === 'card' && (
                stripePromise ? (
                  <Elements stripe={stripePromise}>
                    <div>
                      <p className="text-xs text-center text-gray-400 mb-3 uppercase tracking-wide">Pagamento Seguro via Stripe</p>
                      <StripeCardForm amount={numAmount} onSuccess={handleSuccess} />
                    </div>
                  </Elements>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-yellow-500 text-sm mb-3">Stripe não configurado.</p>
                    <StripeKeyManager darkMode={darkMode} />
                  </div>
                )
              )}

              {method === 'mbway' && (
                <MBWayForm amount={numAmount} onSuccess={handleSuccess} />
              )}

              {method === 'multibanco' && (
                <MultibancoForm amount={numAmount} onSuccess={handleSuccess} />
              )}
            </>
          )}
        </div>
      </div>

      <p className={`text-center text-xs mt-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>🔒 Todos os pagamentos são processados com encriptação SSL</p>
    </div>
  );
}
