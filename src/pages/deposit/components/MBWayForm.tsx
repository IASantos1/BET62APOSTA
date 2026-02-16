
import { useState, useEffect } from 'react';
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

export default function MBWayForm({
  amount: propAmount,
  onSubmit,
  onSuccess,
  loading: _externalLoading,
}: MBWayFormProps) {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('idle'); // 'idle' | 'pending' | 'checking'
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ----------------------------------------------------------------------
   *  Helpers
   * ---------------------------------------------------------------------- */
  const formatPhone = (value) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `${numbers.slice(0, 3)} ${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)} ${numbers.slice(3, 6)} ${numbers.slice(6, 9)}`;
  };

  const handlePhoneChange = (e) => {
    setPhone(formatPhone(e.target.value));
  };

  /** ----------------------------------------------------------------------
   *  Form submission
   * ---------------------------------------------------------------------- */
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Reset UI state
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!user) {
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }

      // ---- Input validation -------------------------------------------------
      const cleanPhone = phone.replace(/\s+/g, '');
      const depositAmount = propAmount ?? parseFloat(amount);

      if (!/^[0-9]{9}$/.test(cleanPhone)) {
        throw new Error('Número de telefone inválido. Use 9 dígitos.');
      }
      if (isNaN(depositAmount) || depositAmount < 10) {
        throw new Error('Valor mínimo de depósito é €10');
      }
      if (depositAmount > 10000) {
        throw new Error('Valor máximo de depósito é €10.000');
      }

      // Optional external submit callback
      if (typeof onSubmit === 'function') {
        onSubmit(cleanPhone);
      }

      // ---- Create pending transaction ----------------------------------------
      await apiFetch('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'deposit',
          amount: depositAmount,
          status: 'pending',
          payment_method: 'mbway',
          description: `Depósito MB WAY - +351${cleanPhone}`,
        }),
      });

      setSuccess('📱 Notificação MB WAY enviada! Confirme no seu telemóvel.');
      setPaymentStatus('pending');

      // ---- Simulated confirmation (replace with webhook in prod) ------------
      setTimeout(async () => {
        try {
          await apiFetch('/wallet/deposit', {
            method: 'POST',
            body: JSON.stringify({
              amount: depositAmount,
              payment_method: 'mbway',
              description: `Depósito MB WAY - +351${cleanPhone}`,
            }),
          });

          // UI feedback
          setSuccess(
            `✅ Pagamento confirmado! €${depositAmount.toFixed(2)} adicionados à sua conta.`
          );
          setPaymentStatus('idle');
          setPhone('');
          setAmount('');

          // Notify parent or reload
          setTimeout(() => {
            if (typeof onSuccess === 'function') {
              onSuccess();
            } else {
              window.location.reload();
            }
          }, 2000);
        } catch (innerErr) {
          console.error('Erro ao confirmar pagamento:', innerErr);
          setError('Erro ao confirmar pagamento. Por favor, contacte suporte.');
        }
      }, 5000);
    } catch (err) {
      const msg = err?.message || 'Erro ao processar pagamento';
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Phone input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Número de Telemóvel
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
            +351
          </span>
          <input
            type="tel"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="912 345 678"
            maxLength={11}
            required
            disabled={loading || paymentStatus !== 'idle'}
            className="w-full pl-16 pr-4 py-3.5 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          />
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Introduza o número associado à sua conta MB WAY
        </p>
      </div>

      {/* Amount input – only when amount not forced via prop */}
      {!propAmount && (
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
      )}

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
        disabled={loading || paymentStatus !== 'idle'}
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

      {/* Information box */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <h4 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <i className="ri-information-line text-teal-500"></i>
          Como funciona o MB WAY
        </h4>
        <ul className="text-xs text-gray-500 space-y-1 ml-6">
          <li>• Receberá uma notificação no seu telemóvel</li>
          <li>• Abra a app MB WAY e confirme o pagamento</li>
          <li>• O saldo será creditado automaticamente na carteira</li>
          <li>• Processo seguro e instantâneo</li>
        </ul>
      </div>
    </form>
  );
}
