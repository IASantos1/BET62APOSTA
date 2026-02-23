import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '../../components/feature/Header';
import { Footer } from '../../components/feature/Footer';
import { MobileBottomNav } from '../../components/feature/MobileBottomNav';
import { useTheme } from '../../contexts/ThemeContext';
import { useLiveMatches } from '../../hooks/useLiveMatches';
import { useUpcomingMatches } from '../../hooks/useUpcomingMatches';
import { VarOverlay } from '../../components/feature/VarOverlay';
import { useLiveEventsConnector } from '../../hooks/useLiveEventsConnector';
import { SkeletonLoader } from '../../components/base/SkeletonLoader';
import { useLiveOddsAutoRefresh } from '../../hooks/useLiveOddsAutoRefresh';
import { useStandingsAutoRefresh } from '../../hooks/useStandingsAutoRefresh';
import { AutoRefreshIndicator } from '../../components/feature/AutoRefreshIndicator';
import { useSmoothTransition } from '../../hooks/useSmoothTransition';
import { fetchEventOdds } from '../../services/apiFootballService';
import { fetchLiveOdds as fetchLiveOddsList } from '../../services/oddsService';

// ✅ LAZY LOADING: Componentes pesados carregam sob demanda
const MatchHeader = lazy(() => import('./components/MatchHeader'));
const MatchStatistics = lazy(() => import('./components/MatchStatistics'));
const MatchMarkets = lazy(() => import('./components/MatchMarkets'));
const MatchH2H = lazy(() => import('./components/MatchH2H'));
const MatchStandings = lazy(() => import('./components/MatchStandings'));
const OddsChangeNotifications = lazy(() => import('./components/OddsChangeNotifications'));
const BettingSlipPanel = lazy(() => import('../home/components/BettingSlipPanel'));
const MobileBettingSlip = lazy(() => import('../../components/feature/MobileBettingSlip'));

/**
 * @typedef {Object} BetSelection
 * @property {number} id
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} selection
 * @property {number} odd
 * @property {string} league
 * @property {string} [market]
 * @property {string} [matchId]
 */

export default function MatchDetailsPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState('markets');
  /** @type {[BetSelection[], Function]} */
  const [selections, setSelections] = useState([]);
  const [isBetSlipExpanded, setIsBetSlipExpanded] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [apiMainOdds, setApiMainOdds] = useState<{ home: number; draw?: number; away: number } | null>(null);

  // Conectar à API de eventos ao vivo
  const { lastEvent } = useLiveEventsConnector(true);

  // ✅ PRÉ-CARREGAMENTO: Buscar dados críticos primeiro
  const { matches: liveMatches, loading: loadingLive } = useLiveMatches({
    autoRefresh: true,
    interval: 5000,
  });
  const { matches: upcomingMatches, loading: loadingUpcoming } = useUpcomingMatches({
    autoRefresh: true,
    interval: 30000,
  });

  const [fallbackMatch, setFallbackMatch] = useState<any | null>(null);

  const match = useMemo(() => {
    const allMatches = [...(liveMatches || []), ...(upcomingMatches || [])];
    const found = allMatches.find((m) => String(m.id) === matchId);

    if (!found) {
      console.log(`⚠️ Jogo ${matchId} não encontrado nas listagens`);
    } else {
      console.log(
        `✅ Jogo encontrado: ${found.homeTeam} vs ${found.awayTeam}`,
        {
          status: found.status,
          score: `${found.homeScore} - ${found.awayScore}`,
          minute: found.minute || found.status?.elapsed,
        }
      );
    }

    return found;
  }, [liveMatches, upcomingMatches, matchId]);

  useEffect(() => {
    let cancelled = false;
    async function fetchFallback() {
      if (match || !matchId) return;
      try {
        const mod = await import('../../services/sportsDataHub');
        const details = await mod.getMatchDetails(String(matchId));
        if (!cancelled) setFallbackMatch(details);
      } catch {
        if (!cancelled) setFallbackMatch(null);
      }
    }
    fetchFallback();
    return () => {
      cancelled = true;
    };
  }, [match, matchId]);

  const resolvedMatch = match || fallbackMatch;

  const isLive = useMemo(() => {
    return !!liveMatches?.some((m) => String(m.id) === matchId);
  }, [liveMatches, matchId]);

  const isSoccer = useMemo(() => {
    if (!resolvedMatch) return false;
    const sport = (resolvedMatch.sport || '').toLowerCase();
    const league = (resolvedMatch.league || '').toLowerCase();
    return (
      sport.includes('soccer') ||
      sport.includes('football') ||
      sport.includes('futebol') ||
      league.includes('liga') ||
      league.includes('league') ||
      league.includes('serie') ||
      league.includes('bundesliga') ||
      league.includes('ligue') ||
      league.includes('premier') ||
      league.includes('champions') ||
      league.includes('europa') ||
      league.includes('copa')
    );
  }, [resolvedMatch]);

  const isLiveMatch = useMemo(() => {
    if (!resolvedMatch) return false;
    const short = resolvedMatch.status?.short || resolvedMatch.statusShort || '';
    const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'Q1', 'Q2', 'Q3', 'Q4', 'OT'];
    return liveStatuses.includes(short) || !!resolvedMatch.isLive;
  }, [resolvedMatch]);

  // ✅ TODOS OS HOOKS DEVEM SER CHAMADOS INCONDICIONALMENTE NO TOPO
  // ✅ Atualização automática de odds ao vivo
  const { odds: liveOdds, isLive: oddsLive, lastUpdate: oddsUpdate } = useLiveOddsAutoRefresh(
    Number(matchId) || 0,
    async () => {
      if (!matchId) return [];
      const list = await fetchLiveOddsList();
      const item = list.find(i => String(i.matchId) === String(matchId));
      if (!item) return [];
      return [
        { key: 'home', value: item.odds.home },
        { key: 'draw', value: item.odds.draw },
        { key: 'away', value: item.odds.away },
      ];
    },
    isLiveMatch
  );

  // ✅ Atualização automática de tabelas (5 minutos)
  const { standings: liveStandings, lastUpdate: _standingsUpdate } = useStandingsAutoRefresh(
    match?.league?.id || 0,
    async () => {
      if (!match?.league?.id) return [];
      const response = await fetch(`/api/standings/${match.league.id}`);
      return response.json();
    },
    !!match?.league?.id
  );

  // ✅ Transições suaves para odds
  const { displayData: _displayOdds } = useSmoothTransition({
    data: liveOdds.length > 0 ? liveOdds : match?.odds || [],
    compareKey: (odds) => {
      if (Array.isArray(odds)) {
        return JSON.stringify(odds.map((o: any) => o.value));
      }
      return JSON.stringify(odds);
    },
  });

  // ✅ Transições suaves para classificação
  const { displayData: _displayStandings } = useSmoothTransition({
    data: liveStandings.length > 0 ? liveStandings : [],
    compareKey: (standings) => standings.map((s: any) => `${s.rank}:${s.points}`).join(','),
  });

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2000);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMainOdds() {
      if (!resolvedMatch) {
        if (!cancelled) setApiMainOdds(null);
        return;
      }

      const sportType = 'football';
      const gameId = Number(resolvedMatch.id || resolvedMatch.fixture?.id || '');

      if (!gameId || sportType !== 'football') {
        if (!cancelled) setApiMainOdds(null);
        return;
      }

      try {
        let odds: { home: number; draw?: number; away: number } | null = null;

        if (isLiveMatch) {
          const list = await fetchLiveOddsList();
          const item = list.find(i => String(i.matchId) === String(gameId));
          if (item) {
            odds = { home: item.odds.home, draw: item.odds.draw, away: item.odds.away };
          }
        } else {
          const preData: any[] = await fetchEventOdds('football', String(gameId));
          if (Array.isArray(preData) && preData.length > 0) {
            const fixture = preData[0];
            const bookmakers = Array.isArray(fixture?.bookmakers) ? fixture.bookmakers : [];
            const mainBookmaker = bookmakers[0];
            const bets = Array.isArray(mainBookmaker?.bets) ? mainBookmaker.bets : [];
            const matchWinner = bets.find((b: any) => {
              const n = String(b?.name || '').toLowerCase();
              return n.includes('match winner') || n.includes('1x2') || b?.id === 1;
            });
            if (matchWinner && Array.isArray(matchWinner.values)) {
              let home: number | null = null;
              let draw: number | null = null;
              let away: number | null = null;
              for (const v of matchWinner.values) {
                const label = String(v?.value || '').toLowerCase();
                const odd = v?.odd != null ? Number(v.odd) : NaN;
                if (!Number.isFinite(odd)) continue;
                if ((label === 'home' || label === '1') && home == null) home = odd;
                if ((label === 'draw' || label === 'x') && draw == null) draw = odd;
                if ((label === 'away' || label === '2') && away == null) away = odd;
              }
              if (home != null && away != null) {
                odds = { home, draw: draw ?? undefined, away };
              }
            }
          }
        }

        if (!cancelled && odds && (odds.home > 0 || odds.away > 0)) {
          setApiMainOdds({
            home: odds.home,
            draw: odds.draw,
            away: odds.away,
          });
        } else if (!cancelled) {
          setApiMainOdds(null);
        }
      } catch (error) {
        console.error('Erro ao carregar odds principais da API-Football', error);
        if (!cancelled) setApiMainOdds(null);
      }
    }

    loadMainOdds();

    return () => {
      cancelled = true;
    };
  }, [resolvedMatch, isLiveMatch]);

  useEffect(() => {
    if (lastEvent && lastEvent.matchId === matchId) {
      if (lastEvent.type === 'VAR_STARTED') {
        showToast('⚠️ VAR em análise - Mercados suspensos');
      } else if (lastEvent.type === 'VAR_ENDED') {
        showToast('✅ VAR concluído - Mercados reabertos');
      } else if (lastEvent.type === 'GOAL') {
        showToast('⚽ GOLO! Mercados temporariamente suspensos');
      }
    }
  }, [lastEvent, matchId, showToast]);

  const handleAddSelection = useCallback(
    (selection, odd, market) => {
      if (!match) return;

      setSelections((prev) => {
        const exists = prev.find(
          (s) =>
            s.homeTeam === match.homeTeam &&
            s.awayTeam === match.awayTeam &&
            s.selection === selection
        );
        if (exists) {
          showToast('Já no boletim!');
          return prev;
        }
        showToast('Adicionado ao boletim!');
        return [
          ...prev,
          {
            id: Date.now(),
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            selection,
            odd,
            league: match.league,
            market,
            matchId: String(match.id),
          },
        ];
      });
    },
    [match, showToast]
  );

  const handleRemoveSelection = useCallback((id) => {
    setSelections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelections([]);
  }, []);

  const toggleBetSlipExpanded = useCallback(() => {
    setIsBetSlipExpanded((prev) => !prev);
  }, []);

  const isSelected = useCallback(
    (selection) => {
      if (!match) return false;
      return selections.some(
        (s) =>
          s.homeTeam === match.homeTeam &&
          s.awayTeam === match.awayTeam &&
          s.selection === selection
      );
    },
    [match, selections]
  );

  const isLoading = loadingLive || loadingUpcoming;

  // ✅ SKELETON LOADER enquanto carrega
  if (isLoading && !match) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100'}`}>
        <Header activeTab="sports" onSportsClick={() => {}} onLiveClick={() => {}} />
        <div className="pt-14 lg:pt-16 px-3 py-4">
          <SkeletonLoader type="card" count={1} />
          <div className="mt-4">
            <SkeletonLoader type="market" count={3} />
          </div>
        </div>
      </div>
    );
  }

  if (!match && !isLoading) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100'}`}>
        <Header activeTab="sports" onSportsClick={() => {}} onLiveClick={() => {}} />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <i className="ri-error-warning-line text-6xl text-amber-500 mb-4"></i>
            <p
              className={`font-semibold text-lg mb-2 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
            >
              Jogo não encontrado
            </p>
            <p
              className={`text-sm mb-4 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}
            >
              Este jogo pode ter terminado ou não está mais disponível
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              Voltar à página inicial
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100'}`}>
      <Header activeTab={isLive ? 'live' : 'sports'} onSportsClick={() => {}} onLiveClick={() => {}} />

      {/* ✅ Indicador de atualização ao vivo */}
      {isLiveMatch && (
        <div className="mb-4">
          <AutoRefreshIndicator 
            isLive={oddsLive} 
            lastUpdate={oddsUpdate}
            showDetails
          />
        </div>
      )}

      {/* ✅ LAZY LOADING: Notificações de odds */}
      <Suspense fallback={null}>
        <OddsChangeNotifications
          matchId={String(match.id)}
          homeTeam={match.homeTeam}
          awayTeam={match.awayTeam}
          league={match.league}
          odds={{
              home: apiMainOdds?.home || match.odds?.home || 0,
              draw: apiMainOdds?.draw ?? match.odds?.draw ?? 0,
              away: apiMainOdds?.away || match.odds?.away || 0,
          }}
        />
      </Suspense>

      <main className="pt-14 lg:pt-16 pb-20 lg:pb-8 lg:mr-64" style={{ paddingBottom: selections.length > 0 ? (isBetSlipExpanded ? '90vh' : '140px') : '80px' }}>
        {/* Back Button */}
        <div className="px-3 py-2">
          <button
            onClick={() => navigate(-1)}
            className={`flex items-center gap-1.5 px-3 py-2 ${
              theme === 'dark'
                ? 'bg-gray-800/80 hover:bg-gray-700 text-white border-gray-700/50'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300'
            } text-xs font-semibold rounded-lg cursor-pointer transition-colors border whitespace-nowrap`}
          >
            <i className="ri-arrow-left-line text-sm"></i>
            Voltar
          </button>
        </div>

        {/* ✅ LAZY LOADING: Match Header */}
        <Suspense fallback={<SkeletonLoader type="card" count={1} />}>
          <MatchHeader
            match={match}
            isLive={isLive}
            onAddSelection={handleAddSelection}
            isSelected={isSelected}
            mainOdds={
              apiMainOdds || (match.odds
                ? {
                    home: match.odds.home,
                    draw: match.odds.draw,
                    away: match.odds.away,
                  }
                : undefined)
            }
          />
        </Suspense>

        {/* Tabs */}
        <div
          className={`sticky top-14 lg:top-16 z-20 ${
            theme === 'dark' ? 'bg-gray-950/95' : 'bg-gray-100/95'
          } backdrop-blur-md border-b ${theme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}
        >
          <div className="flex gap-1 px-3 py-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {[
              { key: 'markets', label: 'Mercados', icon: 'ri-apps-line' },
              { key: 'stats', label: 'Estatísticas', icon: 'ri-bar-chart-box-line' },
              { key: 'h2h', label: 'Confrontos', icon: 'ri-sword-line' },
              ...(isSoccer ? [{ key: 'standings', label: 'Classificação', icon: 'ri-trophy-line' }] : []),
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                  activeTab === tab.key
                    ? tab.key === 'standings'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20'
                      : 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                    : theme === 'dark'
                    ? tab.key === 'standings'
                      ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30'
                      : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700/80 hover:text-gray-300 border border-gray-700/50'
                    : tab.key === 'standings'
                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                <i className={`${tab.icon} text-sm`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ✅ LAZY LOADING: Tab Content */}
        <div className="px-3 py-4">
          {activeTab === 'markets' && (
            <div className="relative">
              <VarOverlay matchId={matchId || ''} />
              <Suspense fallback={<SkeletonLoader type="market" count={3} />}>
                <MatchMarkets match={resolvedMatch} onAddSelection={handleAddSelection} isSelected={isSelected} />
              </Suspense>
            </div>
          )}
          {activeTab === 'stats' && (
            <Suspense fallback={<SkeletonLoader type="stats" count={1} />}>
              <MatchStatistics match={resolvedMatch} isLive={isLive} />
            </Suspense>
          )}
          {activeTab === 'h2h' && (
            <Suspense fallback={<SkeletonLoader type="list" count={1} />}>
              <MatchH2H match={resolvedMatch} />
            </Suspense>
          )}
          {activeTab === 'standings' && (
            <Suspense fallback={<SkeletonLoader type="list" count={1} />}>
              <MatchStandings match={resolvedMatch} />
            </Suspense>
          )}
        </div>

        <Footer />
      </main>

      {/* ✅ LAZY LOADING: Right Sidebar */}
      <aside
        className={`hidden lg:block w-64 ${
          theme === 'dark' ? 'bg-gray-950 border-gray-800/50' : 'bg-white border-gray-200'
        } border-l fixed right-0 top-16 bottom-0 overflow-hidden`}
      >
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          }
        >
          <BettingSlipPanel
            selections={selections}
            onRemoveSelection={handleRemoveSelection}
            onClearAll={handleClearAll}
            onClose={() => {}}
            onSwipeClose={() => {}}
          />
        </Suspense>
      </aside>

      {/* ✅ LAZY LOADING: Mobile Betting Slip */}
      <div className="lg:hidden">
        <Suspense fallback={null}>
          <MobileBettingSlip
            selections={selections}
            onRemoveSelection={handleRemoveSelection}
            onClearAll={handleClearAll}
            isExpanded={isBetSlipExpanded}
            onToggleExpand={toggleBetSlipExpanded}
          />
        </Suspense>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        onHomeClick={() => navigate('/')}
        onLiveClick={() => navigate('/')}
        onBetSlipClick={toggleBetSlipExpanded}
        betCount={selections.length}
      />

      {/* Toasts */}
      <div className="fixed top-14 right-2 z-50 space-y-1.5 max-w-xs">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${theme === 'dark' ? 'bg-gray-800 border-amber-500/30' : 'bg-white border-amber-300'} border px-3 py-2 rounded-lg shadow-2xl animate-slide-in-right`}
          >
            <div className="flex items-center gap-1.5">
              <i className="ri-check-circle-fill text-amber-400 text-xs"></i>
              <span className={`text-[10px] font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-700'}`}>
                {toast.message}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
