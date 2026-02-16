
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/backendClient';
import Header from '../../components/feature/Header';
import Footer from '../../components/feature/Footer';

export default function PaymentSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // PayPal Settings
  const [paypalEnabled, setPaypalEnabled] = useState(true);
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalClientSecret, setPaypalClientSecret] = useState('');
  const [paypalMode, setPaypalMode] = useState<'sandbox' | 'live'>('sandbox');

  const checkAdminAccess = useCallback(async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (user.role !== 'admin') {
      navigate('/');
      return;
    }

    setIsAdmin(true);
  }, [user, navigate]);

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/payment-settings', { method: 'GET' });
      const s = data.settings;
      if (s) {
        setPaypalEnabled(s.paypal_enabled !== false);
        setPaypalMode(s.paypal_mode || 'sandbox');
      }
    } catch (_err) {
      console.error('Erro ao carregar configurações:', _err);
    }
  }, []);

  useEffect(() => {
    checkAdminAccess();
    loadSettings();
  }, [user, navigate, checkAdminAccess, loadSettings]);

  const saveSettings = async () => {
    setLoading(true);
    setMessage(null);

    try {
      // Validações
      if (paypalEnabled && (!paypalClientId || !paypalClientSecret)) {
        setMessage({ type: 'error', text: 'Preenche as credenciais do PayPal' });
        setLoading(false);
        return;
      }

      await apiFetch('/admin/payment-settings', {
        method: 'PUT',
        body: JSON.stringify({
          paypal_enabled: paypalEnabled,
          paypal_mode: paypalMode,
        }),
      });

      setMessage({ type: 'success', text: '✅ Configurações guardadas com sucesso!' });
      
      // Limpar campos sensíveis
      setPaypalClientSecret('');

    } catch (_err: any) {
      console.error('Erro ao guardar:', _err);
      setMessage({ type: 'error', text: _err.message || 'Erro ao guardar configurações' });
    } finally {
      setLoading(false);
    }
  };

  const testPayPalConnection = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await apiFetch('/admin/paypal/test', { method: 'POST' });

      if (result.success) {
        setMessage({ type: 'success', text: '✅ Conexão PayPal OK!' });
      } else {
        setMessage({ type: 'error', text: '❌ Falha na conexão PayPal' });
      }
    } catch {
      setMessage({ type: 'error', text: '❌ Erro ao testar PayPal' });
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      
      <main className="flex-1 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
            >
              <i className="ri-arrow-left-line"></i>
              Voltar ao Admin
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Configuração de Pagamentos</h1>
            <p className="text-gray-600 mt-2">Gere a integração PayPal da plataforma</p>
          </div>

          {/* Message */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          {/* PayPal Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <i className="ri-paypal-line text-2xl text-blue-600"></i>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">PayPal</h2>
                  <p className="text-sm text-gray-600">Pagamentos e levantamentos via PayPal</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={paypalEnabled}
                  onChange={(e) => setPaypalEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {paypalEnabled && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Modo de Operação
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="sandbox"
                        checked={paypalMode === 'sandbox'}
                        onChange={(e) => setPaypalMode(e.target.value as 'sandbox' | 'live')}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm text-gray-700">Sandbox (Testes)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="live"
                        checked={paypalMode === 'live'}
                        onChange={(e) => setPaypalMode(e.target.value as 'sandbox' | 'live')}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm text-gray-700">Live (Produção)</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={paypalClientId}
                    onChange={(e) => setPaypalClientId(e.target.value)}
                    placeholder="AeA1QIZXiflr1_-r0U2UbWTziOWX1GRQer5jkUq4ZfWT5qwb6qQRHq6X-XjK"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={paypalClientSecret}
                    onChange={(e) => setPaypalClientSecret(e.target.value)}
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <button
                  onClick={testPayPalConnection}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  <i className="ri-test-tube-line mr-2"></i>
                  Testar Conexão
                </button>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                  <h4 className="font-semibold text-blue-900 mb-2">📚 Como obter as credenciais:</h4>
                  <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                    <li>Acede a <a href="https://developer.paypal.com" target="_blank" rel="noopener noreferrer" className="underline">developer.paypal.com</a></li>
                    <li>Faz login com a tua conta PayPal</li>
                    <li>Vai a "My Apps & Credentials"</li>
                    <li>Cria uma nova App ou seleciona uma existente</li>
                    <li>Copia o Client ID e Client Secret</li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          {/* Métodos Adicionais Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                <i className="ri-information-line text-2xl text-gray-600"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Outros Métodos</h2>
                <p className="text-sm text-gray-600">MB WAY e Cartão de Crédito</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm">
              Os métodos MB WAY e Cartão de Crédito estão disponíveis como opções de depósito pendente. 
              Os pagamentos são processados manualmente pela equipa de administração.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-4">
            <button
              onClick={() => navigate('/admin')}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={saveSettings}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin mr-2"></i>
                  A guardar...
                </>
              ) : (
                <>
                  <i className="ri-save-line mr-2"></i>
                  Guardar Configurações
                </>
              )}
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
