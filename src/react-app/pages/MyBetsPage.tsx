import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { formatLeagueHeader, abbreviateTeamName, getSportFromLeague, getSportIcon, translateSelection } from '@/shared/helpers';
import { BET_STATUS } from '@/shared/constants';

interface MyBet {
  id: number;
  event_id: number;
  team_match: string;
  league: string;
  selection: string;
  odd: number;
  stake: number;
  potential_win: number;
  status: string;
  created_at?: string;
  cashoutAvailable?: boolean;
  cashoutValue?: number;
  type?: string;
  selections?: Array<{
    event_id: string | number;
    team_match: string;
    league: string;
    selection: string;
    odd: number;
    status: string;
  }>;
}

export default function MyBetsPage() {
  const { darkMode, user, addNotification, notifications } = useApp();
  const [bets, setBets] = useState<MyBet[]>([]);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open');

  const loadBets = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    apiFetch<MyBet[]>('/api/bets', { signal, cache: 'no-store' })
      .then((data: MyBet[]) => {
        if (Array.isArray(data)) {
          setBets(data);
        } else {
          setBets([]);
        }
      })
      .catch((err: any) => {
        const msg = String(err?.message || 'Erro ao carregar apostas');
        const aborted = err && (err.name === 'AbortError' || msg.includes('ERR_ABORTED'));
        if (!aborted && !msg.includes('401') && !notifications.some(n => n.message === msg)) {
           addNotification({ type: 'error', message: msg });
        }
      })
      .finally(() => setLoading(false));
  }, [addNotification, notifications]);

  const handleCashout = async (betId: number, value: number) => {
    if (processingId) return;
    if (!window.confirm(`Confirmar Cashout de €${value.toFixed(2)}?`)) return;

    setProcessingId(betId);
    try {
        await apiFetch(`/api/bets/${betId}/cashout`, { method: 'POST' });
        addNotification({ type: 'success', message: `Cashout de €${value.toFixed(2)} realizado com sucesso!` });
        loadBets();
    } catch (e: any) {
        addNotification({ type: 'error', message: e.message || 'Erro ao realizar cashout' });
    } finally {
        setProcessingId(null);
    }
  };

  const onRefresh = useCallback(() => loadBets(), [loadBets]);

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    loadBets(ac.signal);
    
    window.addEventListener('bets:refresh', onRefresh as EventListener);
    const iv = setInterval(() => { loadBets(); }, 30000);

    return () => {
      ac.abort();
      window.removeEventListener('bets:refresh', onRefresh as EventListener);
      clearInterval(iv);
    };
  }, [user, loadBets, onRefresh]);

  const filteredBets = bets.filter(b => 
    statusFilter === 'open' 
      ? b.status === 'pending' 
      : (b.status === 'won' || b.status === 'lost' || b.status === 'cashed_out')
  );

  const totalWinnings = bets
    .filter(b => b.status === 'won')
    .reduce((acc, b) => acc + (b.potential_win || 0), 0);

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-100'} pb-20`}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className={`text-2xl font-bold mb-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>As Minhas Apostas</h1>
        
        <div className="flex items-center gap-4 mb-6 border-b border-gray-700 pb-2">
            <button
              onClick={() => setStatusFilter('open')}
              className={`pb-2 text-sm font-semibold transition-colors relative ${
                statusFilter === 'open' 
                  ? 'text-red-500' 
                  : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Em Aberto
              {statusFilter === 'open' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-red-500" />}
            </button>
            <button
              onClick={() => setStatusFilter('resolved')}
              className={`pb-2 text-sm font-semibold transition-colors relative ${
                statusFilter === 'resolved' 
                  ? 'text-red-500' 
                  : darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Resolvido
              {statusFilter === 'resolved' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-red-500" />}
            </button>
        </div>

        {statusFilter === 'resolved' && (
           <div className={`mb-6 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="text-sm text-gray-500">Ganhos Totais</div>
              <div className={`text-2xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                €{totalWinnings.toFixed(2)}
              </div>
           </div>
        )}

        {!user ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Faça login para ver as suas apostas</div>
        ) : loading && bets.length === 0 ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>A carregar...</div>
        ) : filteredBets.length === 0 ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {statusFilter === 'open' ? 'Sem apostas em aberto' : 'Sem apostas resolvidas ainda'}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBets.map((bet) => (
              <div
                key={bet.id}
                className={`p-4 rounded-xl border ${
                  darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                } shadow-sm`}
              >
                <div className="flex justify-between items-start mb-3">
                   <div>
                      <div className="flex items-center gap-2 mb-1">
                        {bet.type === 'multi' ? (
                            <>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${darkMode ? 'bg-purple-900 text-purple-200' : 'bg-purple-100 text-purple-800'}`}>Múltipla</span>
                                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{bet.selections?.length || 0} Seleções</span>
                            </>
                        ) : (
                            (() => {
                                const { flagUrl, country } = formatLeagueHeader(bet.league || '');
                                const sport = getSportFromLeague(bet.league || '');
                                const sportIcon = getSportIcon(sport);
                                return (
                                    <>
                                      <img src={sportIcon} alt={sport} className="w-4 h-4 opacity-80" />
                                      {flagUrl && <img src={flagUrl} alt={country} className="w-4 h-4 rounded-full object-cover" />}
                                      <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{bet.league}</span>
                                    </>
                                );
                            })()
                        )}
                      </div>
                      <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {bet.team_match.split(' vs ').map(n => abbreviateTeamName(n)).join(' vs ')}
                      </h3>
                   </div>
                   <div className={`px-2 py-1 rounded text-xs font-bold ${
                      bet.status === 'won' ? 'bg-green-100 text-green-700' :
                      bet.status === 'lost' ? 'bg-red-100 text-red-700' :
                      bet.status === 'cashed_out' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                   }`}>
                      {bet.status === 'pending' ? 'Pendente' : 
                       bet.status === 'won' ? 'Ganha' : 
                       bet.status === 'lost' ? 'Perdida' : 
                       bet.status === 'cashed_out' ? 'Cashout' : bet.status}
                   </div>
                </div>

                {bet.type === 'multi' && bet.selections && (
                    <div className={`mb-3 pb-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                        <div className="space-y-3">
                            {bet.selections.map((sel, idx) => (
                                <div key={idx} className={`text-sm p-2 rounded ${darkMode ? 'bg-gray-750' : 'bg-gray-50'}`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {sel.team_match}
                                        </div>
                                        <div className={`text-xs px-1.5 rounded ${
                                            sel.status === 'won' ? 'bg-green-900 text-green-200' :
                                            sel.status === 'lost' ? 'bg-red-900 text-red-200' :
                                            darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
                                        }`}>
                                            {sel.status === 'pending' ? '...' : sel.status === 'won' ? '✓' : '✗'}
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            {translateSelection(sel.selection)}
                                        </span>
                                        <span className={`font-bold ${darkMode ? 'text-yellow-400' : 'text-blue-600'}`}>
                                            @{Number(sel.odd).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {bet.type !== 'multi' && (
                    <div className={`mb-3 pb-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                        <div className="flex justify-between items-center">
                            <span className={`font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                               {translateSelection(bet.selection)}
                            </span>
                            <span className={`font-bold ${darkMode ? 'text-yellow-400' : 'text-red-600'}`}>
                               @{bet.odd.toFixed(2)}
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex justify-between items-center">
                    <div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Aposta</div>
                        <div className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>€{Number(bet.stake).toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Retorno Potencial</div>
                        <div className={`font-semibold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                           €{bet.status === BET_STATUS.CASHOUT ? (bet.cashoutValue || 0).toFixed(2) : bet.potential_win.toFixed(2)}
                        </div>
                    </div>
                </div>

                {bet.status === BET_STATUS.PENDING && bet.cashoutAvailable && bet.cashoutValue && bet.cashoutValue > 0 && (
                   <div className="mt-4 pt-3 border-t border-gray-700/50">
                      <button 
                          onClick={() => handleCashout(bet.id, bet.cashoutValue!)}
                          disabled={!!processingId}
                          className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-3 transition-all ${
                              processingId === bet.id 
                                  ? 'bg-gray-600 cursor-not-allowed opacity-70' 
                                  : 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white shadow-md hover:shadow-lg'
                          }`}
                      >
                          {processingId === bet.id ? (
                             <span className="text-sm font-semibold">Processando...</span>
                          ) : (
                             <>
                                 <span className="text-sm font-bold">Encerrar Aposta</span>
                                 <span className="bg-black/20 px-2 py-0.5 rounded text-xs font-mono">€{bet.cashoutValue.toFixed(2)}</span>
                             </>
                          )}
                      </button>
                   </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
