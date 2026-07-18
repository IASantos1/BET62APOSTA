import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { getSportFromLeague, getSportIcon, translateSelection } from '@/shared/helpers';

type LiveData = {
  isLive: boolean;
  status: string | null;
  elapsed: number | null;
  home_score: number | null;
  away_score: number | null;
  home_logo: string | null;
  away_logo: string | null;
  event_date: string | null;
};

type Selection = {
  event_id: string | number;
  team_match: string;
  league: string;
  selection: string;
  odd: number;
  status: string;
  home_team?: string;
  away_team?: string;
  live?: LiveData;
};

type MyBet = {
  id: string | number;
  event_id: string | number | null;
  team_match: string;
  team_home?: string;
  team_away?: string;
  league: string;
  selection: string;
  odd: number;
  stake: number;
  potential_win: number;
  status: string;
  created_at?: string;
  winnings?: number;
  cashoutAvailable?: boolean;
  cashoutValue?: number;
  cashoutBlocked?: boolean;
  cashoutBlockedReason?: string;
  currentOdd?: number;
  type?: string;
  is_freebet?: number;
  selections?: Selection[];
  live?: LiveData;
};

type BetsPayload = {
  bets?: MyBet[];
};

const BLOCK_REASONS: Record<string, string> = {
  market_suspended: 'Mercado suspenso',
  odds_frozen: 'Odds congeladas',
  critical_phase: 'Lance crítico — fim de jogo',
  incident_cooldown: 'Lance crítico — golo/penálti',
  odds_too_low: 'Aposta quase ganha',
  event_finished: 'Evento terminado',
  no_live_odds: 'Sem odds ao vivo',
};

function formatMatchDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return `${dows[d.getDay()]}. ${day}/${month}`;
  } catch { return ''; }
}

function formatMatchTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

function periodLabel(elapsed: number | null, status: string | null): string {
  if (status) {
    const upper = status.toUpperCase();
    if (upper === 'HT') return 'Intervalo';
    if (upper === 'ET' || upper === 'AET') return 'Prol.';
    if (upper === 'PEN') return 'Penáltis';
    if (upper === 'FT' || upper === 'FINISHED') return 'Final';
  }
  if (typeof elapsed === 'number') {
    return elapsed > 45 ? '2ª parte' : '1ª parte';
  }
  return '';
}

function normalizeStatus(status: string): 'pending' | 'won' | 'lost' | 'cashed_out' {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'won' || key === 'ganha') return 'won';
  if (key === 'lost' || key === 'perdida') return 'lost';
  if (key === 'cashed_out') return 'cashed_out';
  return 'pending';
}

function statusPill(status: string): { label: string; classes: string; accent: string } {
  switch (normalizeStatus(status)) {
    case 'won':
      return {
        label: 'Ganha',
        classes: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
        accent: 'border-emerald-500/35',
      };
    case 'lost':
      return {
        label: 'Perdida',
        classes: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
        accent: 'border-red-500/35',
      };
    case 'cashed_out':
      return {
        label: 'Cash Out',
        classes: 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30',
        accent: 'border-amber-400/35',
      };
    case 'pending':
    default:
      return {
        label: 'Ativa',
        classes: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
        accent: 'border-blue-500/35',
      };
  }
}

function selectionStatusLabel(status?: string): string {
  switch (normalizeStatus(String(status || 'pending'))) {
    case 'won':
      return 'Ganha';
    case 'lost':
      return 'Perdida';
    case 'cashed_out':
      return 'Cash Out';
    default:
      return 'Em aberto';
  }
}

function normalizeBetsPayload(data: MyBet[] | BetsPayload | null | undefined): MyBet[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.bets)) return data.bets;
  return [];
}

function buildSingleSelection(bet: MyBet): Selection {
  return {
    event_id: bet.event_id ?? '',
    team_match: bet.team_match,
    league: bet.league,
    selection: bet.selection,
    odd: bet.currentOdd && Math.abs(bet.currentOdd - bet.odd) > 0.01 ? Number(bet.currentOdd) : Number(bet.odd),
    status: bet.status,
    home_team: bet.team_home,
    away_team: bet.team_away,
    live: bet.live,
  };
}

function formatTicketDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function MatchBlock({ live, homeTeam, awayTeam, selectionStatus }:
  { live?: LiveData | null; homeTeam: string; awayTeam: string; selectionStatus?: string }) {
  const { darkMode } = useApp();
  const isLive = !!live?.isLive;
  const isFinished = selectionStatus === 'won' || selectionStatus === 'lost' ||
    (live?.status && ['FT', 'AET', 'PEN', 'FINISHED', 'ENDED'].includes(String(live.status).toUpperCase()));
  const showScore = isLive || isFinished || (live && (live.home_score != null || live.away_score != null));
  const dateLabel = formatMatchDate(live?.event_date);
  const timeLabel = formatMatchTime(live?.event_date);
  const statusKey = String(live?.status || '').toUpperCase();
  const liveLabel = statusKey === 'HT'
    ? 'Intervalo'
    : statusKey === 'BT'
      ? 'Pausa Técnica'
      : isLive
        ? 'Ao Vivo'
        : isFinished
          ? 'Finalizado'
          : 'Agendado';

  return (
    <div className={`mt-3 rounded-2xl border px-4 py-4 ${darkMode ? 'border-gray-700 bg-gray-900/70' : 'border-gray-200 bg-gray-50'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${
          isLive
            ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
            : isFinished
              ? (darkMode ? 'bg-gray-800 text-gray-300 ring-1 ring-gray-700' : 'bg-gray-200 text-gray-700 ring-1 ring-gray-300')
              : (darkMode ? 'bg-gray-800 text-gray-300 ring-1 ring-gray-700' : 'bg-white text-gray-600 ring-1 ring-gray-200')
        }`}>
          {isLive && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
          <span>{liveLabel}</span>
          {isLive && live?.elapsed != null && <span>{live.elapsed}'</span>}
        </div>
        <div className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {dateLabel}{timeLabel ? ` • ${timeLabel}` : ''}
        </div>
      </div>

      {showScore ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className={`text-right text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {homeTeam}
          </span>
          <span className={`rounded-xl px-4 py-2 text-center text-base font-black tabular-nums ${
            isLive
              ? 'bg-red-600 text-white shadow-lg shadow-red-950/30'
              : darkMode
                ? 'bg-gray-800 text-white'
                : 'bg-gray-200 text-gray-900'
          }`}>
            {live?.home_score ?? 0} - {live?.away_score ?? 0}
          </span>
          <span className={`text-left text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {awayTeam}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className={`text-right text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {homeTeam}
          </span>
          <span className={`rounded-xl px-3 py-2 text-sm font-black tabular-nums ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
            {timeLabel || 'vs'}
          </span>
          <span className={`text-left text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {awayTeam}
          </span>
        </div>
      )}

      {(isLive || statusKey) && (
        <div className={`mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] ${
          isLive ? 'text-red-400' : darkMode ? 'text-gray-500' : 'text-gray-500'
        }`}>
          {isLive ? periodLabel(live?.elapsed ?? null, live?.status ?? null) || 'Jogo em curso' : statusKey}
        </div>
      )}
    </div>
  );
}

function BetLeg({ bet, sel, isLast }: { bet: MyBet; sel: Selection; isLast: boolean }) {
  const { darkMode } = useApp();
  const sport = getSportFromLeague(sel.league || '');
  const sportIcon = getSportIcon(sport);
  const homeTeam = sel.home_team || sel.team_match.split(' vs ')[0] || '';
  const awayTeam = sel.away_team || sel.team_match.split(' vs ')[1] || '';
  const status = normalizeStatus(sel.status || bet.status);
  const accentText = status === 'lost'
    ? 'text-red-400'
    : status === 'won'
      ? 'text-emerald-400'
      : darkMode ? 'text-white' : 'text-gray-900';

  return (
    <div className={`px-4 py-4 ${!isLast ? (darkMode ? 'border-b border-gray-700/60' : 'border-b border-gray-200') : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3 flex-1">
          <img src={sportIcon} alt={sport} className="mt-0.5 h-5 w-5 shrink-0 opacity-80" />
          <div className="min-w-0">
            <div className={`text-sm font-black leading-tight ${accentText}`}>
              {translateSelection(sel.selection)}
            </div>
            <div className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {sel.league || 'Mercado'}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`block text-base font-black tabular-nums ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {Number(sel.odd).toFixed(2)}
          </span>
          <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
            status === 'won'
              ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
              : status === 'lost'
                ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                : 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
          }`}>
            {selectionStatusLabel(sel.status || bet.status)}
          </span>
        </div>
      </div>

      <MatchBlock
        live={sel.live}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        selectionStatus={sel.status}
      />
    </div>
  );
}

function SingleBetLeg({ bet }: { bet: MyBet }) {
  return <BetLeg bet={bet} sel={buildSingleSelection(bet)} isLast />;
}

function CashoutPanel({ bet, onCashout, processing }:
  { bet: MyBet; onCashout: (bet: MyBet) => void; processing: boolean }) {
  const { darkMode } = useApp();
  if (normalizeStatus(bet.status) !== 'pending' || bet.type === 'multi') return null;
  if (!bet.cashoutAvailable && !bet.cashoutBlocked) return null;

  const value = bet.cashoutValue ?? 0;
  const blocked = !!bet.cashoutBlocked;
  const reason = bet.cashoutBlockedReason ? BLOCK_REASONS[bet.cashoutBlockedReason] || 'Indisponível' : '';

  if (blocked) {
    return (
      <div className={`mx-4 mb-4 mt-2 p-3 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs">⏸</span>
            <div>
              <div className={`text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Cash Out indisponível
              </div>
              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {reason}
              </div>
            </div>
          </div>
          <div className={`px-3 py-1 rounded text-sm font-mono opacity-50 ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
            €{value.toFixed(2)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-4 mt-2">
      <button
        onClick={() => onCashout(bet)}
        disabled={processing}
        className={`w-full py-2.5 px-4 rounded-lg flex items-center justify-center gap-3 transition-all ${
          processing
            ? 'bg-gray-600 cursor-not-allowed opacity-70'
            : 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white shadow-md hover:shadow-lg'
        }`}
      >
        {processing ? (
          <span className="text-sm font-semibold">A processar...</span>
        ) : (
          <>
            <span className="text-sm font-bold">Cash Out</span>
            <span className="bg-black/25 px-2 py-0.5 rounded text-xs font-mono">€{value.toFixed(2)}</span>
          </>
        )}
      </button>
    </div>
  );
}

export default function MyBetsPage() {
  const { darkMode, user, addNotification, notifications } = useApp();
  const [bets, setBets] = useState<MyBet[]>([]);
  const [processingId, setProcessingId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'ativas' | 'perdidas' | 'ganhas'>('ativas');

  const loadBets = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    apiFetch<MyBet[] | BetsPayload>('/api/bets', { signal, cache: 'no-store' })
      .then((data) => setBets(normalizeBetsPayload(data)))
      .catch((err: any) => {
        const msg = String(err?.message || 'Erro ao carregar apostas');
        const aborted = err && (err.name === 'AbortError' || msg.includes('ERR_ABORTED'));
        if (!aborted && !msg.includes('401') && !notifications.some(n => n.message === msg)) {
          addNotification({ type: 'error', message: msg });
        }
      })
      .finally(() => setLoading(false));
  }, [addNotification, notifications]);

  const handleCashout = async (bet: MyBet) => {
    if (processingId || !bet.cashoutValue) return;
    if (!window.confirm(`Confirmar Cash Out de €${bet.cashoutValue.toFixed(2)}?`)) return;
    setProcessingId(bet.id);
    try {
      const res: any = await apiFetch(`/api/bets/${bet.id}/cashout`, { method: 'POST' });
      addNotification({ type: 'success', message: `Cash Out de €${(res?.amount ?? bet.cashoutValue).toFixed(2)} efectuado!` });
      window.dispatchEvent(new CustomEvent('wallet:refresh'));
      loadBets();
    } catch (e: any) {
      addNotification({ type: 'error', message: e.message || 'Erro no cashout' });
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
    const iv = setInterval(() => loadBets(), 15000); // 15s for live cashout updates
    return () => {
      ac.abort();
      window.removeEventListener('bets:refresh', onRefresh as EventListener);
      clearInterval(iv);
    };
  }, [user, loadBets, onRefresh]);

  const filteredBets = useMemo(() => {
    if (tab === 'ativas') return bets.filter((b) => normalizeStatus(b.status) === 'pending');
    if (tab === 'ganhas') return bets.filter((b) => ['won', 'cashed_out'].includes(normalizeStatus(b.status)));
    return bets.filter((b) => normalizeStatus(b.status) === 'lost');
  }, [bets, tab]);

  const counts = useMemo(() => ({
    ativas: bets.filter((b) => normalizeStatus(b.status) === 'pending').length,
    perdidas: bets.filter((b) => normalizeStatus(b.status) === 'lost').length,
    ganhas: bets.filter((b) => ['won', 'cashed_out'].includes(normalizeStatus(b.status))).length,
  }), [bets]);

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-100'} pb-20`}>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className={`text-2xl font-bold mb-5 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          As Minhas Apostas
        </h1>

        <div className={`flex items-center gap-6 mb-5 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          {([
            ['ativas', 'Ativas', counts.ativas],
            ['ganhas', 'Ganhas', counts.ganhas],
            ['perdidas', 'Perdidas', counts.perdidas],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-semibold transition-colors relative ${
                tab === key
                  ? (darkMode ? 'text-white' : 'text-gray-900')
                  : (darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')
              }`}
            >
              {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              {tab === key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />}
            </button>
          ))}
        </div>

        {!user ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Faça login para ver as suas apostas
          </div>
        ) : loading && bets.length === 0 ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>A carregar…</div>
        ) : filteredBets.length === 0 ? (
          <div className={`text-center py-10 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {tab === 'ativas' ? 'Sem apostas em aberto'
              : tab === 'ganhas' ? 'Ainda sem apostas ganhas'
              : 'Sem apostas perdidas'}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBets.map((bet) => {
              const pill = statusPill(bet.status);
              const isMulti = bet.type === 'multi';
              const totalOdd = Number(bet.odd || 0);
              const settledStatus = normalizeStatus(bet.status);
              const selections = isMulti && Array.isArray(bet.selections) && bet.selections.length > 0
                ? bet.selections
                : [buildSingleSelection(bet)];
              const displayReturn =
                settledStatus === 'cashed_out'
                  ? Number(bet.cashoutValue || 0)
                  : settledStatus === 'won'
                    ? Number(bet.winnings || bet.potential_win || 0)
                  : settledStatus === 'lost'
                    ? 0
                    : Number(bet.potential_win || 0);

              return (
                <div
                  key={bet.id}
                  className={`overflow-hidden rounded-3xl border shadow-sm ${pill.accent} ${darkMode ? 'bg-gray-800/95' : 'bg-white border-gray-200'}`}
                >
                  <div className={`px-5 py-4 ${darkMode ? 'border-b border-gray-700' : 'border-b border-gray-200 bg-gray-50/70'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={`text-[11px] font-black uppercase tracking-[0.18em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          Bilhete #{bet.id}
                        </div>
                        <div className={`mt-1 text-lg font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {isMulti ? `Múltipla • ${selections.length} seleções` : 'Aposta Simples'}
                        </div>
                        <div className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {formatTicketDate(bet.created_at)}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] ${pill.classes}`}>
                        {pill.label}
                      </span>
                    </div>
                  </div>

                  {isMulti
                    ? selections.map((sel, idx) => (
                        <BetLeg
                          key={`${bet.id}-${idx}-${sel.event_id}-${sel.selection}`}
                          bet={bet}
                          sel={sel}
                          isLast={idx === selections.length - 1}
                        />
                      ))
                    : <SingleBetLeg bet={bet} />}

                  <CashoutPanel bet={bet} onCashout={handleCashout} processing={processingId === bet.id} />

                  <div className={`grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3 ${darkMode ? 'border-t border-gray-700 bg-gray-900/50' : 'border-t border-gray-200 bg-gray-50'}`}>
                    <div className={`rounded-2xl px-3 py-3 ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700 ring-1 ring-gray-200'}`}>
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] opacity-70">Cota Total</div>
                      <div className={`mt-1 text-lg font-black tabular-nums ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {totalOdd.toFixed(2)}
                      </div>
                    </div>
                    <div className={`rounded-2xl px-3 py-3 ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700 ring-1 ring-gray-200'}`}>
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] opacity-70">Apostado</div>
                      <div className={`mt-1 text-lg font-black tabular-nums ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        €{Number(bet.stake || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className={`rounded-2xl px-3 py-3 ${
                      settledStatus === 'lost'
                        ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                        : settledStatus === 'won'
                          ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                          : darkMode
                            ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                            : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    }`}>
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] opacity-80">
                        {settledStatus === 'won' ? 'Ganho'
                          : settledStatus === 'cashed_out' ? 'Cash Out'
                          : settledStatus === 'lost' ? 'Perda'
                          : 'Retorno'}
                      </div>
                      <div className="mt-1 text-lg font-black tabular-nums">
                        €{displayReturn.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
