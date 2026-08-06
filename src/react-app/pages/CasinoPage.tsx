import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/react-app/utils/api';
import { useApp } from '@/react-app/contexts/AppContext';

type CasinoGame = {
  uid: string;
  name: string;
  provider?: string;
  image?: string;
};

type CasinoConfig = {
  enabled: boolean;
  provider?: string;
  defaultGameUid?: string;
  games?: CasinoGame[];
  callbackUrl?: string;
  homeUrl?: string;
};

export default function CasinoPage() {
  const navigate = useNavigate();
  const { darkMode, user, addNotification } = useApp();
  const [config, setConfig] = useState<CasinoConfig | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedGameUid, setSelectedGameUid] = useState('');
  const [customGameUid, setCustomGameUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        const [casinoConfig, wallet] = await Promise.all([
          apiFetch<CasinoConfig>('/api/casino/config', { cache: 'no-store' }),
          user ? apiFetch<{ balance: number }>('/api/wallet', { cache: 'no-store' }).catch(() => null) : Promise.resolve(null),
        ]);

        if (!alive) return;
        setConfig(casinoConfig);
        setBalance(typeof wallet?.balance === 'number' ? wallet.balance : null);

        const firstGameUid = String(casinoConfig?.games?.[0]?.uid || casinoConfig?.defaultGameUid || '').trim();
        setSelectedGameUid(firstGameUid);
        setCustomGameUid(firstGameUid);
      } catch (error: any) {
        if (!alive) return;
        addNotification({
          type: 'error',
          message: error?.message || 'Falha ao carregar a configuração do casino',
        });
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [addNotification, user]);

  const games = config?.games || [];
  const effectiveGameUid = useMemo(() => {
    const chosen = String(selectedGameUid || customGameUid || config?.defaultGameUid || '').trim();
    return chosen;
  }, [config?.defaultGameUid, customGameUid, selectedGameUid]);

  const handleLaunch = async () => {
    if (!user) {
      addNotification({ type: 'warning', message: 'Faça login para abrir o casino' });
      navigate('/login');
      return;
    }

    if (!config?.enabled) {
      addNotification({ type: 'warning', message: 'A integração do casino ainda não está configurada' });
      return;
    }

    if (!effectiveGameUid) {
      addNotification({ type: 'warning', message: 'Escolha um game UID válido' });
      return;
    }

    setLaunching(true);
    try {
      const response = await apiFetch<{ payload?: { game_launch_url?: string } }>('/api/casino/launch', {
        method: 'POST',
        body: JSON.stringify({
          game_uid: effectiveGameUid,
          home_url: '/casino',
        }),
      });

      const launchUrl = String(response?.payload?.game_launch_url || '').trim();
      if (!launchUrl) {
        throw new Error('A SilentAPI não devolveu o URL do jogo');
      }

      window.location.assign(launchUrl);
    } catch (error: any) {
      addNotification({
        type: 'error',
        message: error?.message || 'Não foi possível lançar o jogo',
      });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="container mx-auto max-w-5xl p-4">
        <div className={`rounded-2xl border p-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Casino</h1>
              <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mt-2`}>
                Lança jogos da SilentAPI usando a carteira principal da plataforma.
              </p>
            </div>
            <div className={`rounded-xl border px-4 py-3 ${darkMode ? 'border-gray-700 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-900'}`}>
              <div className="text-xs uppercase tracking-wide opacity-70">Saldo atual</div>
              <div className="text-2xl font-bold">€{balance !== null ? balance.toFixed(2) : '0.00'}</div>
            </div>
          </div>
        </div>

        <div className={`mt-6 rounded-2xl border p-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          {loading ? (
            <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>A carregar configuração do casino...</p>
          ) : (
            <div className="space-y-6">
              {!config?.enabled && (
                <div className={`rounded-xl border p-4 text-sm ${darkMode ? 'border-yellow-700 bg-yellow-900/20 text-yellow-100' : 'border-yellow-300 bg-yellow-50 text-yellow-800'}`}>
                  <div>A integração ainda não está ativa. Falta configurar `SILENTAPI_TOKEN` e `SILENTAPI_SECRET`.</div>
                  <div className="mt-1">Callback esperado: <span className="font-mono">{config?.callbackUrl || '/api/casino/webhook'}</span></div>
                </div>
              )}

              <div>
                <h2 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Escolher jogo</h2>
                <p className={`mt-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Pode usar um jogo pré-configurado ou escrever manualmente o `game_uid`.
                </p>
              </div>

              {games.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {games.map((game) => {
                    const active = effectiveGameUid === game.uid;
                    return (
                      <button
                        key={game.uid}
                        type="button"
                        onClick={() => {
                          setSelectedGameUid(game.uid);
                          setCustomGameUid(game.uid);
                        }}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          active
                            ? 'border-red-500 bg-red-600/10'
                            : darkMode
                              ? 'border-gray-700 bg-gray-900 hover:border-gray-600'
                              : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {game.image ? (
                            <img
                              src={game.image}
                              alt={game.name}
                              className="h-12 w-12 rounded-lg object-contain bg-white p-1"
                              loading="lazy"
                            />
                          ) : null}
                          <div>
                            <div className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{game.name}</div>
                            <div className={`mt-1 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{game.provider || 'SilentAPI'}</div>
                          </div>
                        </div>
                        <div className={`mt-3 font-mono text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{game.uid}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <label className={`mb-2 block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  `game_uid`
                </label>
                <input
                  value={customGameUid}
                  onChange={(event) => {
                    setCustomGameUid(event.target.value);
                    setSelectedGameUid(event.target.value);
                  }}
                  placeholder={config?.defaultGameUid || 'JILI_SLOT_001'}
                  className={`w-full rounded-lg border px-3 py-2 ${
                    darkMode ? 'border-gray-600 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-900'
                  }`}
                />
              </div>

              <div className={`rounded-xl border p-4 text-sm ${darkMode ? 'border-gray-700 bg-gray-900 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                <div>Callback para configurar no painel: <span className="font-mono">{config?.callbackUrl || '/api/casino/webhook'}</span></div>
                <div className="mt-1">URL de saída do jogo: <span className="font-mono">{config?.homeUrl || '/casino'}</span></div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={launching || !config?.enabled}
                  className="rounded-lg bg-red-600 px-5 py-3 font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {launching ? 'A abrir jogo...' : config?.enabled ? 'Entrar no Casino' : 'Configuração pendente'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/wallet')}
                  className={`rounded-lg px-5 py-3 font-semibold ${
                    darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                  }`}
                >
                  Ver carteira
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
