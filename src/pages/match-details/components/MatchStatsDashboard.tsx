import { useEffect, useMemo } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import { useMatchStatistics } from '../../../hooks/useMatchStatistics';
import LiveMomentumGraph from '../../../react-app/components/LiveMomentumGraph';

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatPercent(n: number): string {
  return `${Math.round(clampPercent(n))}%`;
}

function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return decimals > 0 ? Number(value).toFixed(decimals) : `${Math.round(value)}`;
}

function getFormPoints(form: ('W' | 'D' | 'L')[]): number {
  return form.reduce((acc, result) => acc + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0);
}

function computeProbabilities(params: {
  h2h?: { homeWins: number; draws: number; awayWins: number; total: number };
  homeForm?: { form: ('W' | 'D' | 'L')[] };
  awayForm?: { form: ('W' | 'D' | 'L')[] };
}) {
  const h2hTotal = params.h2h?.total || 0;
  const h2hHome = params.h2h?.homeWins || 0;
  const h2hDraw = params.h2h?.draws || 0;
  const h2hAway = params.h2h?.awayWins || 0;

  const homeFormPoints = params.homeForm ? getFormPoints(params.homeForm.form) : 0;
  const awayFormPoints = params.awayForm ? getFormPoints(params.awayForm.form) : 0;
  const formGames =
    params.homeForm?.form?.length && params.awayForm?.form?.length
      ? Math.min(params.homeForm.form.length, params.awayForm.form.length)
      : 0;
  const formMax = formGames * 3 || 1;

  const formHomeStrength = homeFormPoints / formMax;
  const formAwayStrength = awayFormPoints / formMax;

  const h2hHomeP = h2hTotal ? h2hHome / h2hTotal : 0;
  const h2hDrawP = h2hTotal ? h2hDraw / h2hTotal : 0;
  const h2hAwayP = h2hTotal ? h2hAway / h2hTotal : 0;

  const formHomeP = formHomeStrength / (formHomeStrength + formAwayStrength || 1);
  const formAwayP = formAwayStrength / (formHomeStrength + formAwayStrength || 1);
  const formDrawP = 0.18;

  const h2hWeight = h2hTotal > 0 ? 0.55 : 0;
  const formWeight = 0.45;

  let homeWin = (h2hHomeP * h2hWeight + formHomeP * formWeight) * 100;
  let awayWin = (h2hAwayP * h2hWeight + formAwayP * formWeight) * 100;
  let draw = (h2hDrawP * h2hWeight + formDrawP * formWeight) * 100;

  const total = homeWin + draw + awayWin || 1;
  homeWin = (homeWin / total) * 100;
  draw = (draw / total) * 100;
  awayWin = (awayWin / total) * 100;

  return {
    homeWin: clampPercent(homeWin),
    draw: clampPercent(draw),
    awayWin: clampPercent(awayWin),
    counts: {
      homeWins: h2hHome,
      draws: h2hDraw,
      awayWins: h2hAway,
    },
  };
}

function computeH2HMetrics(h2hMatches: any[] | undefined) {
  const matches = Array.isArray(h2hMatches) ? h2hMatches : [];
  if (!matches.length) {
    return {
      avgGoals: null as number | null,
      over15: null as number | null,
      over25: null as number | null,
      btts: null as number | null,
    };
  }

  const totals = matches.map((item) => (item?.goals?.home ?? 0) + (item?.goals?.away ?? 0));
  const avgGoals = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const over15 = (totals.filter((value) => value > 1.5).length / totals.length) * 100;
  const over25 = (totals.filter((value) => value > 2.5).length / totals.length) * 100;
  const btts =
    (matches.filter((item) => (item?.goals?.home ?? 0) > 0 && (item?.goals?.away ?? 0) > 0).length /
      totals.length) *
    100;

  return { avgGoals, over15, over25, btts };
}

function ResultPill({ result }: { result: 'W' | 'D' | 'L' }) {
  const label = result === 'W' ? 'V' : result === 'D' ? 'E' : 'D';
  const cls =
    result === 'W'
      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20'
      : result === 'D'
      ? 'bg-gray-500/15 text-gray-500 border-gray-400/20'
      : 'bg-red-500/15 text-red-500 border-red-500/20';

  return (
    <span className={`flex h-6 w-6 items-center justify-center rounded-md border text-[10px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

function CircularProbability({
  value,
  label,
  sublabel,
  color,
}: {
  value: number;
  label: string;
  sublabel: string;
  color: string;
}) {
  const percent = clampPercent(value);
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative h-28 w-28">
        <svg className="-rotate-90 h-28 w-28" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="8" fill="none" className="text-gray-200" />
          <circle
            cx="50"
            cy="50"
            r="42"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={color}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-black text-slate-900">{formatPercent(percent)}</span>
        </div>
      </div>
      <div className="mt-2 text-lg font-bold text-slate-800">{label}</div>
      <div className="text-sm text-slate-500">{sublabel}</div>
    </div>
  );
}

function MarketProgress({
  label,
  value,
  trailing,
  color,
}: {
  label: string;
  value: number | null;
  trailing: string;
  color: string;
}) {
  const width = clampPercent(value ?? 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="truncate text-lg text-slate-700">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-slate-900">{value == null ? '--' : formatPercent(value)}</span>
          <span className="rounded-xl bg-slate-100 px-3 py-1 text-base font-bold text-slate-600">{trailing}</span>
        </div>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }}></div>
      </div>
    </div>
  );
}

function SnapshotCard({
  value,
  label,
  sublabel,
  tone,
}: {
  value: string;
  label: string;
  sublabel: string;
  tone: 'blue' | 'red';
}) {
  const textColor = tone === 'blue' ? 'text-blue-500' : 'text-red-500';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm">
      <div className={`text-5xl font-black ${textColor}`}>{value}</div>
      <div className="mt-2 text-2xl font-bold text-slate-700">{label}</div>
      <div className="mt-1 text-lg text-slate-500">{sublabel}</div>
    </div>
  );
}

function DetailedStatRow({
  label,
  homeValue,
  awayValue,
  isPercent,
}: {
  label: string;
  homeValue: number;
  awayValue: number;
  isPercent?: boolean;
}) {
  const homeText = isPercent ? `${homeValue}%` : `${homeValue}`;
  const awayText = isPercent ? `${awayValue}%` : `${awayValue}`;
  const total = homeValue + awayValue;
  const homeWidth = total > 0 ? (homeValue / total) * 100 : 50;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-2xl font-black text-blue-600">{homeText}</span>
        <span className="text-center text-sm font-bold uppercase tracking-[0.2em] text-slate-400">{label}</span>
        <span className="text-2xl font-black text-red-500">{awayText}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="bg-blue-500 transition-all duration-500" style={{ width: `${homeWidth}%` }}></div>
        <div className="bg-red-500 transition-all duration-500" style={{ width: `${100 - homeWidth}%` }}></div>
      </div>
    </div>
  );
}

function RecentGamesCard({
  title,
  accent,
  teamForm,
}: {
  title: string;
  accent: 'blue' | 'red';
  teamForm: any | null;
}) {
  const border = accent === 'blue' ? 'border-blue-200' : 'border-red-200';
  const accentText = accent === 'blue' ? 'text-blue-600' : 'text-red-500';
  const matches = teamForm?.matches || [];

  return (
    <div className={`rounded-3xl border bg-white shadow-sm ${border}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className={`text-sm font-black uppercase tracking-[0.2em] ${accentText}`}>{title}</h3>
        <div className="flex items-center gap-1.5">
          {(teamForm?.form || []).slice(0, 5).map((result: 'W' | 'D' | 'L', index: number) => (
            <ResultPill key={`${result}-${index}`} result={result} />
          ))}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {matches.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">Sem dados recentes</div>
        ) : (
          matches.map((item: any, index: number) => {
            const date = item?.fixture?.date ? new Date(item.fixture.date) : null;
            const isHome = item?.teams?.home?.id === teamForm?.teamId;
            const scored = isHome ? (item?.goals?.home ?? 0) : (item?.goals?.away ?? 0);
            const conceded = isHome ? (item?.goals?.away ?? 0) : (item?.goals?.home ?? 0);
            const opponent = isHome ? item?.teams?.away : item?.teams?.home;
            const fmt = date
              ? date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
              : '--/--';
            const result: 'W' | 'D' | 'L' = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';

            return (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <ResultPill result={result} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {opponent?.logo ? <img src={opponent.logo} alt="" className="h-5 w-5 object-contain" /> : null}
                    <span className="truncate text-sm font-bold text-slate-800">{opponent?.name || '-'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{fmt}</div>
                </div>
                <div className="text-right text-lg font-black text-slate-900">
                  {scored} - {conceded}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function MatchStatsDashboard({ match, onOpenMarkets }: { match: any; onOpenMarkets?: () => void }) {
  const { theme } = useTheme();
  const darkMode = theme === 'dark';

  const homeName = match?.homeTeam || match?.teams?.home?.name || 'Casa';
  const awayName = match?.awayTeam || match?.teams?.away?.name || 'Fora';
  const matchId = match?.id || match?.fixtureId || null;

  const {
    statistics,
    events,
    loading,
    error,
    refresh,
    headToHead,
    recentForm,
    h2hLoading,
    formLoading,
    fetchH2H,
    fetchRecentForm,
  } = useMatchStatistics(matchId, !!match?.isLive, 30000);

  useEffect(() => {
    if (!homeName || !awayName) return;
    if (!headToHead && !h2hLoading) fetchH2H(homeName, awayName);
    if (!recentForm && !formLoading) fetchRecentForm(homeName, awayName);
  }, [awayName, fetchH2H, fetchRecentForm, formLoading, h2hLoading, headToHead, homeName, recentForm]);

  const h2hMetrics = useMemo(() => computeH2HMetrics(headToHead?.matches), [headToHead]);

  const probabilities = useMemo(
    () =>
      computeProbabilities({
        h2h: headToHead
          ? {
              homeWins: headToHead.homeWins,
              draws: headToHead.draws,
              awayWins: headToHead.awayWins,
              total: headToHead.total,
            }
          : undefined,
        homeForm: recentForm?.home ? { form: recentForm.home.form } : undefined,
        awayForm: recentForm?.away ? { form: recentForm.away.form } : undefined,
      }),
    [headToHead, recentForm],
  );

  const marketRows = useMemo(
    () => [
      {
        label: 'Mais de 1.5 Golos',
        value: h2hMetrics.over15,
        trailing: h2hMetrics.avgGoals == null ? '--' : h2hMetrics.avgGoals.toFixed(2),
        color: 'bg-blue-500',
      },
      {
        label: 'Mais de 2.5 Golos',
        value: h2hMetrics.over25,
        trailing: probabilities.draw > 0 ? (100 / Math.max(probabilities.homeWin, 1)).toFixed(2) : '--',
        color: 'bg-red-500',
      },
      {
        label: 'Ambas Marcam',
        value: h2hMetrics.btts,
        trailing: h2hMetrics.btts == null ? '--' : (100 / Math.max(h2hMetrics.btts, 1)).toFixed(2),
        color: 'bg-blue-500',
      },
    ],
    [h2hMetrics, probabilities.homeWin, probabilities.draw],
  );

  const detailedStats = useMemo(
    () => [
      { label: 'Posse de Bola', home: statistics?.possession.home ?? 0, away: statistics?.possession.away ?? 0, isPercent: true },
      { label: 'Cantos', home: statistics?.corners.home ?? 0, away: statistics?.corners.away ?? 0 },
      { label: 'Cartões Amarelos', home: statistics?.yellowCards.home ?? 0, away: statistics?.yellowCards.away ?? 0 },
      { label: 'Cartões Vermelhos', home: statistics?.redCards.home ?? 0, away: statistics?.redCards.away ?? 0 },
      { label: 'Remates à Baliza', home: statistics?.shotsOnTarget.home ?? 0, away: statistics?.shotsOnTarget.away ?? 0 },
      { label: 'Passes', home: statistics?.passes.home ?? 0, away: statistics?.passes.away ?? 0 },
    ],
    [statistics],
  );

  const isLive =
    !!match?.isLive ||
    !!match?.minute ||
    !!match?.elapsed ||
    ['1H', '2H', 'HT', 'ET', 'LIVE'].includes(String(match?.statusShort || match?.period || '').toUpperCase());

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-lg shadow-slate-200/60">
        <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500"></div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.28em] text-slate-500">{match?.league || 'Partida'}</div>
              <div className="mt-2 text-sm font-semibold text-slate-400">
                {match?.statusLabel || match?.time || match?.minute || 'Hoje'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isLive ? (
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-red-500">
                  Ao Vivo
                </span>
              ) : null}
              {onOpenMarkets ? (
                <button
                  type="button"
                  onClick={onOpenMarkets}
                  className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-blue-600 transition hover:bg-blue-100"
                >
                  Mercados
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="text-center">
              <div className="text-3xl font-black text-slate-900 sm:text-4xl">{homeName}</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-black text-slate-900 sm:text-6xl">
                {match?.homeScore ?? 0} - {match?.awayScore ?? 0}
              </div>
              <div className="mt-2 text-3xl font-black text-slate-800 sm:text-4xl">
                {match?.time || (match?.minute ? `${match.minute}'` : '--:--')}
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-slate-900 sm:text-4xl">{awayName}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-[32px] border border-slate-200 bg-[#f4f4f7] p-5 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Probabilidade de Resultado</h3>
          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <CircularProbability value={probabilities.homeWin} label={homeName} sublabel={`H2H: ${probabilities.counts.homeWins}`} color="text-blue-500" />
            <CircularProbability value={probabilities.draw} label="Empate" sublabel={`H2H: ${probabilities.counts.draws}`} color="text-slate-800" />
            <CircularProbability value={probabilities.awayWin} label={awayName} sublabel={`H2H: ${probabilities.counts.awayWins}`} color="text-red-500" />
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-[#f4f4f7] p-5 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Mercados Principais</h3>
          <div className="mt-5 space-y-5">
            {marketRows.map((row) => (
              <MarketProgress
                key={row.label}
                label={row.label}
                value={row.value}
                trailing={row.trailing}
                color={row.color}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SnapshotCard value={formatNumber(h2hMetrics.avgGoals, 1)} label="Golos/Jogo" sublabel={`Liga: ${formatNumber(h2hMetrics.avgGoals, 1)}`} tone="red" />
        <SnapshotCard value={h2hMetrics.btts == null ? '--' : formatPercent(h2hMetrics.btts)} label="AEM" sublabel={`Liga: ${h2hMetrics.btts == null ? '--' : formatPercent(h2hMetrics.btts)}`} tone="blue" />
        <SnapshotCard value={formatNumber((statistics?.corners.home ?? 0) + (statistics?.corners.away ?? 0), 1)} label="Cantos/Jogo" sublabel={match?.league || 'Partida'} tone="red" />
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Estatísticas</h3>
            <p className="mt-1 text-sm text-slate-400">Gráfico azul e vermelho com leitura do momento do jogo</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-slate-600 transition hover:bg-slate-100"
          >
            Atualizar
          </button>
        </div>

        <LiveMomentumGraph
          darkMode={darkMode}
          stats={statistics || undefined}
          matchEvents={events}
          homeName={homeName}
          awayName={awayName}
          currentMinute={Number(match?.elapsed ?? match?.minute ?? 0)}
          statusKey={String(match?.statusShort || match?.period || (isLive ? '1H' : 'NS'))}
        />

        <div className="mt-5 space-y-3">
          {detailedStats.map((item) => (
            <DetailedStatRow
              key={item.label}
              label={item.label}
              homeValue={item.home}
              awayValue={item.away}
              isPercent={item.isPercent}
            />
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {error}
          </div>
        ) : null}

        {!loading && !statistics ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-base text-slate-500">
            Estatísticas detalhadas não disponíveis.
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RecentGamesCard title={`Últimos Jogos - ${homeName}`} accent="blue" teamForm={recentForm?.home || null} />
        <RecentGamesCard title={`Últimos Jogos - ${awayName}`} accent="red" teamForm={recentForm?.away || null} />
      </div>
    </div>
  );
}
