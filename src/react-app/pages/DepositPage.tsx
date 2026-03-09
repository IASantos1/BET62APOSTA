import { useState, type ChangeEvent } from "react";
import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';

// Componente Wrapper para os botões com fluxo Server-Side
const PayPalPayment = ({ amount }: { amount: string }) => {
    const [{ isPending, isRejected }] = usePayPalScriptReducer();
    const { addNotification } = useApp();

    if (isRejected) {
        return <div className="text-red-500 text-center p-4">Erro ao carregar o PayPal. Por favor, recarregue a página.</div>;
    }

    return (
        <>
            {isPending && <div className="spinner" />}
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
                        // Notifica o erro específico do backend e lança para o PayPal não quebrar com "Expected an order id"
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
                            addNotification({ type: 'success', message: 'Depósito realizado com sucesso!' });
                        } else {
                            addNotification({ type: 'error', message: 'Pagamento não concluído: ' + res.status });
                        }
                    } catch (err: any) {
                        addNotification({ type: 'error', message: 'Erro ao validar pagamento: ' + err.message });
                    }
                }}
                onError={(err: any) => {
                    console.error("PayPal Button Error:", err);
                    addNotification({ type: 'error', message: 'Erro no botão PayPal. Tente novamente.' });
                }}
            />
        </>
    );
};

export default function DepositPage() {
  const { darkMode } = useApp();
  const [amount, setAmount] = useState("10"); // Valor padrão
  const [error, setError] = useState("");

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setAmount(val);
      if (parseFloat(val) < 10) {
          setError("O valor mínimo para depósito é de €10.");
      } else {
          setError("");
      }
  };

  return (
    <div className={`max-w-md mx-auto p-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <h2 className="text-2xl font-bold mb-8 text-center">
        Depositar
      </h2>

      <div className="flex flex-col space-y-6">
          
          {/* Campo de Valor Controlado por Nós */}
          <div className={`p-6 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Valor do Depósito (€)
              </label>
              <input
                  type="number"
                  value={amount}
                  onChange={handleAmountChange}
                  min="10"
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

          {/* Área do PayPal */}
          <div className={`p-6 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <h3 className={`text-lg font-bold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Pagamento</h3>
              <PayPalScriptProvider options={{ 
                  clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || "AVH5-CoY-PDfHQV46wcKn4ZlcItmmjfjINXKs3Gonfn6pDvr5_DqsB6TkMHiFSe-uEMkfAgoJ2BNAd3V", 
                  currency: "EUR",
                  intent: "capture",
                  "disable-funding": "venmo,applepay"
              }}>
                  <div className="mt-4">
                     <p className="text-xs text-center text-gray-400 mb-2 uppercase tracking-wide">Pagamento Seguro via PayPal</p>
                     <PayPalPayment amount={amount} />
                  </div>
              </PayPalScriptProvider>
          </div>
      </div>
    </div>
  );
}
