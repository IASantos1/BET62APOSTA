import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/react-app/contexts/AppContext';
import { apiFetch } from '@/react-app/utils/api';
import { getSportFromLeague, getSportIcon, translateSelection } from '@/shared/helpers';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

type BetsPayload = { bets?: MyBet[] };

const BLOCK_REASONS: Record<string, string> = {
  market_suspended: 'Mercado suspenso',
  odds_frozen: 'Odds congeladas',
  critical_phase: 'Lance crítico',
  incident_cooldown: 'Golo/penálti detectado',
  odds_too_low: 'Aposta quase ganha',
  event_finished: 'Evento terminado',
  no_live_odds: 'Sem odds ao vivo',
};

function formatTicketDateTime(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${h}:${m}` };
  } catch { return { date: '', time: '' }; }
}

function formatMatchTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

function formatMatchDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
  } catch { return ''; }
}

function normalizeStatus(status: string): 'pending' | 'won' | 'lost' | 'cashed_out' {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'won' || key === 'ganha') return 'won';
  if (key === 'lost' || key === 'perdida') return 'lost';
  if (key === 'cashed_out') return 'cashed_out';
  return 'pending';
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

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const norm = normalizeStatus(status);
  if (norm === 'won') return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-400 ring-1 ring-emerald-500/25">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Ganha
    </span>
  );
  if (norm === 'lost') return (
    <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-red-400 ring-1 ring-red-500/25">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      Perdida
    </span>
  );
  if (norm === 'cashed_out') return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-300 ring-1 ring-amber-400/25">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Cash Out
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-sky-400 ring-1 ring-sky-500/25">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
      Em Aberto
    </span>
  );
}

// ── Selection outcome dot ────────────────────────────────────────────────────

function SelectionDot({ status }: { status: string }) {
  const norm = normalizeStatus(status);
  if (norm === 'won') return <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 mt-1" />;
  if (norm === 'lost') return <span className="h-2 w-2 rounded-full bg-red-400 shrink-0 mt-1" />;
  return <span className="h-2 w-2 rounded-full bg-gray-500 shrink-0 mt-1" />;
}

// ── Live score badge ─────────────────────────────────────────────────────────

function LiveScoreBadge({ live }: { live?: LiveData | null }) {
  if (!live) return null;
  const isLive = live.isLive;
  const statusKey = String(live.status || '').toUpperCase();
  const isFinished = ['FT', 'AET', 'PEN', 'FINISHED', 'ENDED', 'FINAL'].includes(statusKey);
  const showScore = isLive || isFinished || (live.home_score != null || live.away_score != null);
  if (!showScore) return null;

  return (
    <div className="flex items-center gap-2">
      {isLive && (
        <span className="flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-red-400 ring-1 ring-red-500/25">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          {live.elapsed != null ? `${live.elapsed}'` : 'LIVE'}
        </span>
      )}
      {isFinished && !isLive && (
        <span className="rounded bg-gray-700/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
          FT
        </span>
      )}
      {(live.home_score != null || live.away_score != null) && (
        <span className={`rounded px-2 py-0.5 text-xs font-black tabular-nums ${
          isLive ? 'bg-red-600/20 text-red-300 ring-1 ring-red-600/20' : 'bg-gray-700/40 text-gray-300'
        }`}>
          {live.home_score ?? 0}–{live.away_score ?? 0}
        </span>
      )}
    </div>
  );
}

// ── Single selection row ─────────────────────────────────────────────────────

function SelectionRow({ sel, betStatus, isLast }: { sel: Selection; betStatus: string; isLast: boolean }) {
  const sport = getSportFromLeague(sel.league || '');
  const sportIcon = getSportIcon(sport);
  const homeTeam = sel.home_team || sel.team_match?.split(' vs ')?.[0] || '';
  const awayTeam = sel.away_team || sel.team_match?.split(' vs ')?.[1] || '';
  const selStatus = normalizeStatus(sel.status || betStatus);
  const matchDate = formatMatchDate(sel.live?.event_date);
  const matchTime = formatMatchTime(sel.live?.event_date);

  return (
    <div className={`px-4 py-3.5 ${!isLast ? 'border-b border-white/[0.05]' : ''}`}>
      {/* Match header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <img src={sportIcon} alt={sport} className="h-4 w-4 shrink-0 opacity-75" />
          <span className="text-[11px] text-gray-500 truncate">{sel.league || sport}</span>
          {(matchDate || matchTime) && (
            <span className="text-[11px] text-gray-600 shrink-0">
              {matchDate}{matchTime ? ` ${matchTime}` : ''}
            </span>
          )}
        </div>
        <LiveScoreBadge live={sel.live} />
      </div>

      {/* Teams */}
      <div className="flex items-start gap-2 mb-2">
        <SelectionDot status={sel.status || betStatus} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-gray-200 leading-snug">
              {homeTeam && awayTeam ? `${homeTeam} — ${awayTeam}` : sel.team_match}
            </span>
            <span className={`shrink-0 text-sm font-black tabular-nums ${
              selStatus === 'won' ? 'text-emerald-400' :
              selStatus === 'lost' ? 'text-red-400/70 line-through' :
              'text-white'
            }`}>
              {Number(sel.odd).toFixed(2)}
            </span>
          </div>
          <div className={`mt-0.5 text-xs font-semibold ${
            selStatus === 'won' ? 'text-emerald-400' :
            selStatus === 'lost' ? 'text-red-400' :
            'text-sky-300'
          }`}>
            {translateSelection(sel.selection)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cash Out panel ───────────────────────────────────────────────────────────

function CashoutPanel({ bet, onCashout, processing }: {
  bet: MyBet; onCashout: (bet: MyBet) => void; processing: boolean;
}) {
  if (normalizeStatus(bet.status) !== 'pending' || bet.type === 'multi') return null;
  if (!bet.cashoutAvailable && !bet.cashoutBlocked) return null;

  const value = bet.cashoutValue ?? 0;
  const blocked = !!bet.cashoutBlocked;
  const reason = bet.cashoutBlockedReason ? BLOCK_REASONS[bet.cashoutBlockedReason] || 'Indisponível' : '';

  if (blocked) {
    return (
      <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
        <div>
          <p className="text-xs font-semibold text-gray-400">Cash Out indisponível</p>
          {reason && <p className="mt-0.5 text-[11px] text-gray-600">{reason}</p>}
        </div>
        <span className="rounded bg-gray-800 px-2.5 py-1 text-xs font-mono text-gray-500 opacity-50">
          €{value.toFixed(2)}
        </span>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3">
      <button
        onClick={() => onCashout(bet)}
        disabled={processing}
        className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-bold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? 'A processar…' : `Cash Out · €${value.toFixed(2)}`}
      </button>
    </div>
  );
}

// ── Ticket card ──────────────────────────────────────────────────────────────

function TicketCard({ bet, onCashout, processingId }: {
  bet: MyBet;
  onCashout: (bet: MyBet) => void;
  processingId: string | number | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const isMulti = bet.type === 'multi';
  const settledStatus = normalizeStatus(bet.status);
  const { date, time } = formatTicketDateTime(bet.created_at);

  const selections = isMulti && Array.isArray(bet.selections) && bet.selections.length > 0
    ? bet.selections
    : [buildSingleSelection(bet)];

  const totalOdd = Number(bet.odd || 0);
  const displayReturn =
    settledStatus === 'cashed_out' ? Number(bet.cashoutValue || 0) :
    settledStatus === 'won' ? Number(bet.winnings || bet.potential_win || 0) :
    settledStatus === 'lost' ? 0 :
    Number(bet.potential_win || 0);

  const accentBorder =
    settledStatus === 'won' ? 'border-emerald-500/30' :
    settledStatus === 'lost' ? 'border-red-500/20' :
    settledStatus === 'cashed_out' ? 'border-amber-400/25' :
    'border-sky-500/20';

  return (
    <div className={`overflow-hidden rounded-2xl border bg-[#111318] ${accentBorder}`}>

      {/* ── Ticket header ── */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-600">
                #{String(bet.id).padStart(6, '0')}
              </span>
              {isMulti && (
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  Múltipla · {selections.length} seleções
                </span>
              )}
            </div>
            {(date || time) && (
              <div className="mt-0.5 text-[11px] text-gray-600">
                {date}{time ? ` às ${time}` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={bet.status} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-gray-600 hover:text-gray-400 transition"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* ── Selections ── */}
      {expanded && (
        <div>
          {selections.map((sel, idx) => (
            <SelectionRow
              key={`${bet.id}-${idx}-${sel.event_id}`}
              sel={sel}
              betStatus={bet.status}
              isLast={idx === selections.length - 1}
            />
          ))}
        </div>
      )}

      {/* ── Cash out ── */}
      {expanded && (
        <CashoutPanel bet={bet} onCashout={onCashout} processing={processingId === bet.id} />
      )}

      {/* ── Ticket footer ── */}
      <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-t border-white/[0.06] bg-white/[0.025]">
        <div className="px-3 py-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Cota</div>
          <div className="mt-1 text-sm font-black tabular-nums text-white">{totalOdd.toFixed(2)}</div>
        </div>
        <div className="px-3 py-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Apostado</div>
          <div className="mt-1 text-sm font-black tabular-nums text-white">€{Number(bet.stake || 0).toFixed(2)}</div>
        </div>
        <div className="px-3 py-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
            {settledStatus === 'won' ? 'Ganho' :
             settledStatus === 'cashed_out' ? 'Cash Out' :
             settledStatus === 'lost' ? 'Resultado' :
             'Retorno'}
          </div>
          <div className={`mt-1 text-sm font-black tabular-nums ${
            settledStatus === 'won' ? 'text-emerald-400' :
            settledStatus === 'lost' ? 'text-red-400' :
            settledStatus === 'cashed_out' ? 'text-amber-300' :
            'text-sky-400'
          }`}>
            {settledStatus === 'lost' ? '–' : `€${displayReturn.toFixed(2)}`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ tab, setTab, counts }: {
  tab: string;
  setTab: (t: 'ativas' | 'ganhas' | 'perdidas') => void;
  counts: { ativas: number; ganhas: number; perdidas: number };
}) {
  const tabs = [
    { key: 'ativas' as const, label: 'Em Aberto', count: counts.ativas },
    { key: 'ganhas' as const, label: 'Ganhas', count: counts.ganhas },
    { key: 'perdidas' as const, label: 'Perdidas', count: counts.perdidas },
  ];

  return (
    <div className="flex rounded-xl bg-white/[0.04] p-1 gap-1 mb-5">
      {tabs.map(({ key, label, count }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`flex-1 rounded-lg py-2 text-xs font-bold tracking-wide transition-all ${
            tab === key
              ? 'bg-white/[0.1] text-white shadow'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {label}
          {count > 0 && (
            <span className={`ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-black ${
              tab === key ? 'bg-white/10 text-white' : 'bg-white/[0.06] text-gray-500'
            }`}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function MyBetsPage() {
  const { user, addNotification, notifications } = useApp();
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
    const iv = setInterval(() => loadBets(), 15000);
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
    <div className="min-h-screen bg-[#0d0f13] pb-24">
      <div className="mx-auto max-w-2xl px-4 pt-5">
        <h1 className="mb-5 text-xl font-black text-white tracking-tight">
          As Minhas Apostas
        </h1>

        <TabBar tab={tab} setTab={setTab} counts={counts} />

        {!user ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] py-16 text-center">
            <p className="text-sm text-gray-500">Faça login para ver as suas apostas</p>
          </div>
        ) : loading && bets.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 rounded-2xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : filteredBets.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] py-16 text-center">
            <p className="text-sm text-gray-500">
              {tab === 'ativas' ? 'Sem apostas em aberto'
                : tab === 'ganhas' ? 'Ainda sem apostas ganhas'
                : 'Sem apostas perdidas'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBets.map((bet) => (
              <TicketCard
                key={bet.id}
                bet={bet}
                onCashout={handleCashout}
                processingId={processingId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
