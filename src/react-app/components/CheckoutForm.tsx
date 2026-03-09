import { useEffect, useState } from "react";
import {
  PaymentElement,
  CardElement,
  IbanElement,
  useStripe,
  useElements
} from "@stripe/react-stripe-js";
import { useApp } from '@/react-app/contexts/AppContext';

export default function CheckoutForm({ method, clientSecret }: { method?: 'card'|'sepa_debit'|'mb_way'|'customer_balance'; clientSecret?: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const { darkMode } = useApp();

  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sepaName, setSepaName] = useState('');
  const [sepaEmail, setSepaEmail] = useState('');

  useEffect(() => {
    if (!stripe) {
      return;
    }

    const clientSecret = new URLSearchParams(window.location.search).get(
      "payment_intent_client_secret"
    );

    if (!clientSecret) {
      return;
    }

    stripe.retrievePaymentIntent(clientSecret).then(({ paymentIntent }) => {
      switch (paymentIntent?.status) {
        case "succeeded":
          setMessage("Pagamento efetuado com sucesso!");
          break;
        case "processing":
          setMessage("O seu pagamento está a ser processado.");
          break;
        case "requires_payment_method":
          setMessage("O seu pagamento não foi bem-sucedido, por favor tente novamente.");
          break;
        default:
          setMessage("Algo correu mal.");
          break;
      }
    });
  }, [stripe]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsLoading(true);
    let error: any = null;
    if (method === 'card' && clientSecret) {
      const card = elements.getElement(CardElement);
      if (card) {
        const r = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card },
          return_url: `${window.location.origin}/deposit-success`,
        });
        error = r.error || null;
      }
    } else if (method === 'sepa_debit' && clientSecret) {
      const iban = elements.getElement(IbanElement);
      if (iban) {
        const r = await stripe.confirmSepaDebitPayment(clientSecret, {
          payment_method: {
            sepa_debit: iban,
            billing_details: { name: sepaName, email: sepaEmail }
          },
          return_url: `${window.location.origin}/deposit-success`,
        });
        error = r.error || null;
      }
    } else {
      const r = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/deposit-success` },
      });
      error = r.error || null;
    }

    if (error) {
      if (error.type === 'card_error' || error.type === 'validation_error') {
        setMessage(error.message || 'Ocorreu um erro.');
      } else {
        setMessage('Ocorreu um erro inesperado.');
      }
    }

    setIsLoading(false);
  };

  return (
    <form id="payment-form" onSubmit={handleSubmit}>
      {method === 'card' ? (
        <div className={`p-3 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
          <CardElement options={{ hidePostalCode: true }} />
        </div>
      ) : method === 'sepa_debit' ? (
        <div className="space-y-3">
          <div>
            <label className={`block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Nome do titular</label>
            <input value={sepaName} onChange={(e) => setSepaName(e.target.value)} className={`mt-1 w-full px-3 py-2 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
          </div>
          <div>
            <label className={`block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Email</label>
            <input value={sepaEmail} onChange={(e) => setSepaEmail(e.target.value)} className={`mt-1 w-full px-3 py-2 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`} />
          </div>
          <div className={`p-3 rounded border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
            <IbanElement options={{ supportedCountries: ['SEPA'] }} />
          </div>
        </div>
      ) : (
        <PaymentElement id="payment-element" />
      )}
      <button disabled={isLoading || !stripe || !elements} id="submit" className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mt-4 w-full">
        <span id="button-text">
          {isLoading ? <div className="spinner" id="spinner"></div> : "Pagar Agora"}
        </span>
      </button>
      {message && <div id="payment-message" className="text-red-500 mt-2">{message}</div>}
    </form>
  );
}