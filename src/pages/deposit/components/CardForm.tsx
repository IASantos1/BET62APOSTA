
import PropTypes from 'prop-types';
import { useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/backendClient';

const PAYPAL_CLIENT_ID =
  'AZDxjDScFpQtjWTOUtWKbyN_bDt4OgqaF4eYXlewfBP4-8aqX3PiV8e1GWU6liB2CUXlkA59kJXE7M6R';

export default function CardForm({
  amount,
  onSubmit,
  loading: externalLoading,
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  /** --------------------------------------------------------------
   *  Cria a ordem no backend (Supabase Function)
   * -------------------------------------------------------------- */
  const createOrder = async () => {
    if (!user) {
      setError('Sessão expirada. Faça login novamente.');
      throw new Error('User not authenticated');
    }

    setLoading(true);
    setError('');

    try {
      const data = await apiFetch('/payments/paypal/create-order', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });

      // PayPal expects the order ID to be returned
      return data.order_id;
    } catch (err) {
      const message = err?.message ?? 'Erro ao iniciar pagamento';
      setError(message);
      setLoading(false);
      throw err;
    }
  };

  /** --------------------------------------------------------------
   *  Captura o pagamento após aprovação do cliente
   * -------------------------------------------------------------- */
  const onApprove = async (data) => {
    if (!user) return;

    try {
      await apiFetch('/payments/paypal/capture-order', {
        method: 'POST',
        body: JSON.stringify({ order_id: data.orderID }),
      });

      await apiFetch('/wallet/deposit', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          payment_method: 'paypal',
          description: 'Depósito via PayPal',
          external_id: data.orderID,
        }),
      });

      setSuccess(true);
      setLoading(false);
      onSubmit();
    } catch (err) {
      const message = err?.message ?? 'Erro ao processar pagamento';
      setError(message);
      setLoading(false);
    }
  };

  /** --------------------------------------------------------------
   *  Tratamento de erros genéricos da UI PayPal
   * -------------------------------------------------------------- */
  const onError = (err) => {
    console.error('PayPal Error:', err);
    setError('Erro no pagamento PayPal. Tente novamente.');
    setLoading(false);
  };

  /** --------------------------------------------------------------
   *  Usuário cancelou o fluxo de pagamento
   * -------------------------------------------------------------- */
  const onCancel = () => {
    setError('Pagamento cancelado.');
    setLoading(false);
  };

  /* --------------------------------------------------------------
   *  UI de sucesso
   * -------------------------------------------------------------- */
  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
          <i className="ri-checkbox-circle-fill text-3xl text-green-600"></i>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">
          Pagamento Confirmado!
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          O teu depósito de €{amount.toFixed(2)} foi processado com sucesso.
        </p>
        <p className="text-xs text-gray-500">O saldo será atualizado em instantes.</p>
      </div>
    );
  }

  /* --------------------------------------------------------------
   *  UI principal
   * -------------------------------------------------------------- */
  return (
    <div className="space-y-5">
      {/* Info PayPal */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-100 shrink-0">
            <i className="ri-paypal-fill text-blue-600 text-lg"></i>
          </div>
          <div>
            <p className="font-semibold text-blue-900 text-sm mb-1">
              Pagamento Seguro via PayPal
            </p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Paga com cartão de crédito/débito ou saldo PayPal. Transação 100% segura e
              encriptada.
            </p>
          </div>
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-800">
            <i className="ri-error-warning-line text-lg"></i>
            <span className="text-sm font-medium">{error}</span>
            <button
              onClick={() => setError('')}
              className="ml-auto w-6 h-6 flex items-center justify-center cursor-pointer"
            >
              <i className="ri-close-line text-red-400"></i>
            </button>
          </div>
        </div>
      )}

      {/* Resumo */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-600">Valor a depositar</span>
          <span className="text-lg font-bold text-gray-900">
            €{amount.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Taxa de processamento</span>
          <span className="text-green-600 font-medium">€0.00</span>
        </div>
      </div>

      {/* PayPal Buttons */}
      <div className="relative">
        {(loading || externalLoading) && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-600">A processar...</span>
            </div>
          </div>
        )}

        <PayPalScriptProvider
          options={{
            clientId: PAYPAL_CLIENT_ID,
            currency: 'EUR',
            intent: 'capture',
          }}
        >
          <PayPalButtons
            style={{
              layout: 'vertical',
              color: 'blue',
              shape: 'rect',
              label: 'pay',
              height: 50,
            }}
            disabled={loading || externalLoading || !user}
            createOrder={createOrder}
            onApprove={onApprove}
            onError={onError}
            onCancel={onCancel}
          />
        </PayPalScriptProvider>
      </div>

      {/* Métodos aceites */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Métodos aceites:</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <i className="ri-visa-line text-xl text-blue-600"></i>
            <span className="text-xs font-medium text-gray-700">Visa</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <i className="ri-mastercard-line text-xl text-orange-600"></i>
            <span className="text-xs font-medium text-gray-700">Mastercard</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <i className="ri-paypal-fill text-xl text-blue-500"></i>
            <span className="text-xs font-medium text-gray-700">PayPal</span>
          </div>
        </div>
      </div>

      {/* Segurança */}
      <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
        <i className="ri-shield-check-line"></i>
        <span>Protegido por encriptação SSL de 256 bits</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------
 * PropTypes (para garantir que o componente receba os dados corretos
 * quando usado em projetos JavaScript puros)
 * -------------------------------------------------------------- */
CardForm.propTypes = {
  amount: PropTypes.number.isRequired,
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

CardForm.defaultProps = {
  loading: false,
};
