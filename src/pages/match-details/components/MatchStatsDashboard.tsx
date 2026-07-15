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

type DashboardSport = 'football' | 'volleyball' | 'mma' | 'other';

function detectDashboardSport(match: any): DashboardSport {
  const raw = String(match?.sport || '').trim().toLowerCase();
  if (!raw || raw === 'soccer' || raw === 'football' || raw === 'futebol') return 'football';
  if (raw === 'volleyball' || raw === 'voleibol' || raw === 'vôlei' || raw === 'volei') return 'volleyball';
  if (raw === 'mma') return 'mma';
  return 'other';
}

function parseScorePayload(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : null;
}

function extractSetPairs(match: any): Array<{ home: number | null; away: number | null }> {
  const payload = parseScorePayload(match?.score);
  const setsRoot = payload?.sets || payload?.set || match?.sets || null;
  if (!setsRoot || typeof setsRoot !== 'object') return [];

  const toNum = (value: unknown): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const indexes = Object.keys(setsRoot)
    .map((key) => {
      const result = /^(?:s|set)\s*(\d{1,2})$/i.exec(String(key).trim());
      return result ? Number(result[1]) : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  return indexes.map((index) => {
    const entry =
      setsRoot[`s${index}`] ??
      setsRoot[`set${index}`] ??
      setsRoot[`S${index}`] ??
      setsRoot[`SET${index}`];
    return {
      home: entry && typeof entry === 'object' ? toNum(entry.home) : null,
      away: entry && typeof entry === 'object' ? toNum(entry.away) : null,
    };
  });
}

function countSetWins(sets: Array<{ home: number | null; away: number | null }>): { home: number; away: number } {
  return sets.reduce(
    (acc, set) => {
      if (set.home == null || set.away == null) return acc;
      if (set.home > set.away) acc.home += 1;
      if (set.away > set.home) acc.away += 1;
      return acc;
    },
    { home: 0, away: 0 },
  );
}

function extractCurrentRound(match: any): number {
  const raw = String(match?.period || match?.statusShort || match?.statusLabel || '').toUpperCase();
  const roundMatch = /(?:ROUND|R)\s*([1-9])/.exec(raw);
  if (roundMatch) return Number(roundMatch[1]);
  const minute = Number(match?.elapsed ?? match?.minute ?? 0);
  if (minute > 0) return Math.max(1, Math.ceil(minute / 5));
  return 1;
}

function computeAdaptiveProbabilities(params: {
  sport: DashboardSport;
  homeMetric: number;
  awayMetric: number;
}): { homeWin: number; draw: number; awayWin: number; counts: { homeWins: number; draws: number; awayWins: number } } {
  const homeMetric = Number.isFinite(params.homeMetric) ? params.homeMetric : 0;
  const awayMetric = Number.isFinite(params.awayMetric) ? params.awayMetric : 0;
  const diff = homeMetric - awayMetric;
  const tensionBase = params.sport === 'mma' ? 22 : 30;

  let homeWin = 50 + diff * tensionBase;
  let awayWin = 50 - diff * tensionBase;
  let draw = 100 - Math.abs(diff) * (params.sport === 'mma' ? 28 : 34);

  homeWin = clampPercent(homeWin);
  awayWin = clampPercent(awayWin);
  draw = clampPercent(draw);

  const total = homeWin + draw + awayWin || 1;
  return {
    homeWin: (homeWin / total) * 100,
    draw: (draw / total) * 100,
    awayWin: (awayWin / total) * 100,
    counts: {
      homeWins: Math.max(0, Math.round(homeMetric)),
      draws: Math.max(0, Math.round(draw / 10)),
      awayWins: Math.max(0, Math.round(awayMetric)),
    },
  };
}

function PhaseCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
    </div>
  );
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
  const sport = useMemo(() => detectDashboardSport(match), [match]);
  const setPairs = useMemo(() => extractSetPairs(match), [match]);
  const setWins = useMemo(() => countSetWins(setPairs), [setPairs]);
  const currentRound = useMemo(() => extractCurrentRound(match), [match]);
  const currentSet = setPairs.length > 0 ? setPairs[setPairs.length - 1] : null;
  const volleyballHeaderScore = {
    home: setWins.home || Number(match?.homeScore ?? 0),
    away: setWins.away || Number(match?.awayScore ?? 0),
  };
  const headerScore =
    sport === 'volleyball'
      ? volleyballHeaderScore
      : {
          home: Number(match?.homeScore ?? 0),
          away: Number(match?.awayScore ?? 0),
        };

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
  } = useMatchStatistics(matchId, !!match?.isLive, 30000, sport);

  useEffect(() => {
    if (!homeName || !awayName) return;
    if (!headToHead && !h2hLoading) fetchH2H(homeName, awayName);
    if (!recentForm && !formLoading) fetchRecentForm(homeName, awayName);
  }, [awayName, fetchH2H, fetchRecentForm, formLoading, h2hLoading, headToHead, homeName, recentForm]);

  const h2hMetrics = useMemo(() => computeH2HMetrics(headToHead?.matches), [headToHead]);

  const probabilities = useMemo(
    () => {
      if (sport === 'football') {
        return computeProbabilities({
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
        });
      }

      if (sport === 'volleyball') {
        return computeAdaptiveProbabilities({
          sport,
          homeMetric: setWins.home || Number(match?.homeScore ?? 0),
          awayMetric: setWins.away || Number(match?.awayScore ?? 0),
        });
      }

      if (sport === 'mma') {
        return computeAdaptiveProbabilities({
          sport,
          homeMetric: Number(match?.homeScore ?? 0),
          awayMetric: Number(match?.awayScore ?? 0),
        });
      }

      return computeAdaptiveProbabilities({
        sport: 'other',
        homeMetric: Number(match?.homeScore ?? 0),
        awayMetric: Number(match?.awayScore ?? 0),
      });
    },
    [headToHead, match?.awayScore, match?.homeScore, recentForm, setWins.away, setWins.home, sport],
  );

  const marketRows = useMemo(
    () => {
      if (sport === 'volleyball') {
        const currentSetPoints = (currentSet?.home ?? 0) + (currentSet?.away ?? 0);
        const currentSetGap = Math.abs((currentSet?.home ?? 0) - (currentSet?.away ?? 0));
        return [
          {
            label: 'Mais de 3.5 Sets',
            value: clampPercent((setPairs.length / 5) * 100),
            trailing: `${setPairs.length}/5`,
            color: 'bg-blue-500',
          },
          {
            label: 'Pontos no Set Atual',
            value: clampPercent((currentSetPoints / 50) * 100),
            trailing: `${currentSet?.home ?? 0}-${currentSet?.away ?? 0}`,
            color: 'bg-red-500',
          },
          {
            label: 'Equilíbrio do Set',
            value: clampPercent(100 - currentSetGap * 8),
            trailing: `Dif. ${currentSetGap}`,
            color: 'bg-blue-500',
          },
        ];
      }

      if (sport === 'mma') {
        const totalPoints = Math.max(1, Number(match?.homeScore ?? 0) + Number(match?.awayScore ?? 0));
        return [
          {
            label: `Vantagem ${homeName}`,
            value: clampPercent((Number(match?.homeScore ?? 0) / totalPoints) * 100),
            trailing: `${match?.homeScore ?? 0}`,
            color: 'bg-blue-500',
          },
          {
            label: 'Combate Equilibrado',
            value: probabilities.draw,
            trailing: `R${currentRound}`,
            color: 'bg-red-500',
          },
          {
            label: `Vantagem ${awayName}`,
            value: clampPercent((Number(match?.awayScore ?? 0) / totalPoints) * 100),
            trailing: `${match?.awayScore ?? 0}`,
            color: 'bg-blue-500',
          },
        ];
      }

      return [
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
      ];
    },
    [
      currentRound,
      currentSet?.away,
      currentSet?.home,
      h2hMetrics,
      homeName,
      match?.awayScore,
      match?.homeScore,
      probabilities.draw,
      probabilities.homeWin,
      setPairs.length,
      sport,
      awayName,
    ],
  );

  const detailedStats = useMemo(
    () => {
      if (sport === 'volleyball') {
        const totalPoints = setPairs.reduce(
          (acc, set) => ({
            home: acc.home + (set.home ?? 0),
            away: acc.away + (set.away ?? 0),
          }),
          { home: 0, away: 0 },
        );
        return [
          { label: 'Sets Vencidos', home: setWins.home, away: setWins.away },
          { label: 'Pontos Totais', home: totalPoints.home, away: totalPoints.away },
          { label: 'Pontos no Set Atual', home: currentSet?.home ?? 0, away: currentSet?.away ?? 0 },
          { label: 'Pressão no Jogo', home: probabilities.homeWin, away: probabilities.awayWin, isPercent: true },
        ];
      }

      if (sport === 'mma') {
        return [
          { label: 'Pontuação Parcial', home: Number(match?.homeScore ?? 0), away: Number(match?.awayScore ?? 0) },
          { label: 'Controlo Estimado', home: probabilities.homeWin, away: probabilities.awayWin, isPercent: true },
          { label: 'Ronda Atual', home: currentRound, away: Math.max(1, 3 - currentRound + 1) },
        ];
      }

      return [
        { label: 'Posse de Bola', home: statistics?.possession.home ?? 0, away: statistics?.possession.away ?? 0, isPercent: true },
        { label: 'Cantos', home: statistics?.corners.home ?? 0, away: statistics?.corners.away ?? 0 },
        { label: 'Cartões Amarelos', home: statistics?.yellowCards.home ?? 0, away: statistics?.yellowCards.away ?? 0 },
        { label: 'Cartões Vermelhos', home: statistics?.redCards.home ?? 0, away: statistics?.redCards.away ?? 0 },
        { label: 'Remates à Baliza', home: statistics?.shotsOnTarget.home ?? 0, away: statistics?.shotsOnTarget.away ?? 0 },
        { label: 'Passes', home: statistics?.passes.home ?? 0, away: statistics?.passes.away ?? 0 },
      ];
    },
    [
      currentRound,
      currentSet?.away,
      currentSet?.home,
      match?.awayScore,
      match?.homeScore,
      probabilities.awayWin,
      probabilities.homeWin,
      setPairs,
      setWins.away,
      setWins.home,
      sport,
      statistics,
    ],
  );

  const snapshotCards = useMemo(() => {
    if (sport === 'volleyball') {
      const totalPlayed = setPairs.filter((set) => set.home != null || set.away != null).length;
      const pointGap = Math.abs((currentSet?.home ?? 0) - (currentSet?.away ?? 0));
      return [
        { value: `${setWins.home}-${setWins.away}`, label: 'Sets', sublabel: match?.league || 'Partida', tone: 'red' as const },
        { value: `S${Math.max(1, totalPlayed)}`, label: 'Set Atual', sublabel: `${currentSet?.home ?? 0}-${currentSet?.away ?? 0}`, tone: 'blue' as const },
        { value: `${pointGap}`, label: 'Dif. Pontos', sublabel: 'Set em curso', tone: 'red' as const },
      ];
    }

    if (sport === 'mma') {
      return [
        { value: `R${currentRound}`, label: 'Ronda Atual', sublabel: match?.league || 'Combate', tone: 'red' as const },
        { value: `${match?.homeScore ?? 0}-${match?.awayScore ?? 0}`, label: 'Parcial', sublabel: `${homeName} x ${awayName}`, tone: 'blue' as const },
        { value: String(match?.statusShort || 'LIVE'), label: 'Estado', sublabel: 'Atualização em tempo real', tone: 'red' as const },
      ];
    }

    return [
      { value: formatNumber(h2hMetrics.avgGoals, 1), label: 'Golos/Jogo', sublabel: `Liga: ${formatNumber(h2hMetrics.avgGoals, 1)}`, tone: 'red' as const },
      { value: h2hMetrics.btts == null ? '--' : formatPercent(h2hMetrics.btts), label: 'AEM', sublabel: `Liga: ${h2hMetrics.btts == null ? '--' : formatPercent(h2hMetrics.btts)}`, tone: 'blue' as const },
      { value: formatNumber((statistics?.corners.home ?? 0) + (statistics?.corners.away ?? 0), 1), label: 'Cantos/Jogo', sublabel: match?.league || 'Partida', tone: 'red' as const },
    ];
  }, [
    currentRound,
    currentSet?.away,
    currentSet?.home,
    h2hMetrics.avgGoals,
    h2hMetrics.btts,
    homeName,
    awayName,
    match?.awayScore,
    match?.homeScore,
    match?.league,
    match?.statusShort,
    setPairs,
    setWins.away,
    setWins.home,
    sport,
    statistics?.corners.away,
    statistics?.corners.home,
  ]);

  const probabilityMiddleLabel = sport === 'football' ? 'Empate' : 'Equilíbrio';
  const probabilitySubLabels =
    sport === 'football'
      ? {
          home: `H2H: ${probabilities.counts.homeWins}`,
          middle: `H2H: ${probabilities.counts.draws}`,
          away: `H2H: ${probabilities.counts.awayWins}`,
        }
      : sport === 'volleyball'
        ? {
            home: `Sets: ${setWins.home}`,
            middle: `Sets: ${setPairs.length}`,
            away: `Sets: ${setWins.away}`,
          }
        : {
            home: `Score: ${match?.homeScore ?? 0}`,
            middle: `R${currentRound}`,
            away: `Score: ${match?.awayScore ?? 0}`,
          };
  const showMomentumGraph = sport === 'football';

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
                {headerScore.home} - {headerScore.away}
              </div>
              <div className="mt-2 text-3xl font-black text-slate-800 sm:text-4xl">
                {match?.time || (match?.minute ? `${match.minute}'` : '--:--')}
              </div>
              {sport === 'volleyball' && currentSet ? (
                <div className="mt-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                  Set atual: {currentSet.home ?? 0} - {currentSet.away ?? 0}
                </div>
              ) : null}
              {sport === 'mma' ? (
                <div className="mt-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                  Ronda {currentRound}
                </div>
              ) : null}
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
            <CircularProbability value={probabilities.homeWin} label={homeName} sublabel={probabilitySubLabels.home} color="text-blue-500" />
            <CircularProbability value={probabilities.draw} label={probabilityMiddleLabel} sublabel={probabilitySubLabels.middle} color="text-slate-800" />
            <CircularProbability value={probabilities.awayWin} label={awayName} sublabel={probabilitySubLabels.away} color="text-red-500" />
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
        {snapshotCards.map((card) => (
          <SnapshotCard
            key={`${card.label}-${card.value}`}
            value={card.value}
            label={card.label}
            sublabel={card.sublabel}
            tone={card.tone}
          />
        ))}
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Estatísticas</h3>
            <p className="mt-1 text-sm text-slate-400">
              {showMomentumGraph
                ? 'Gráfico azul e vermelho com leitura do momento do jogo'
                : sport === 'volleyball'
                  ? 'Leitura set a set para o Voleibol em tempo real'
                  : 'Resumo da luta e fase atual em tempo real'}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-slate-600 transition hover:bg-slate-100"
          >
            Atualizar
          </button>
        </div>

        {showMomentumGraph ? (
          <LiveMomentumGraph
            darkMode={darkMode}
            stats={statistics || undefined}
            matchEvents={events}
            homeName={homeName}
            awayName={awayName}
            currentMinute={Number(match?.elapsed ?? match?.minute ?? 0)}
            statusKey={String(match?.statusShort || match?.period || (isLive ? '1H' : 'NS'))}
          />
        ) : sport === 'volleyball' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <PhaseCard
              title="Sets ganhos"
              value={`${setWins.home}-${setWins.away}`}
              subtitle={`${homeName} x ${awayName}`}
            />
            <PhaseCard
              title="Set atual"
              value={`S${Math.max(1, setPairs.length)}`}
              subtitle={`${currentSet?.home ?? 0} - ${currentSet?.away ?? 0}`}
            />
            <PhaseCard
              title="Pontos jogados"
              value={`${(currentSet?.home ?? 0) + (currentSet?.away ?? 0)}`}
              subtitle="No set em curso"
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <PhaseCard title="Ronda atual" value={`R${currentRound}`} subtitle={String(match?.statusShort || 'LIVE')} />
            <PhaseCard title="Parcial" value={`${match?.homeScore ?? 0}-${match?.awayScore ?? 0}`} subtitle={`${homeName} x ${awayName}`} />
            <PhaseCard title="Equilíbrio" value={formatPercent(probabilities.draw)} subtitle="Combate em curso" />
          </div>
        )}

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

        {!loading && !statistics && showMomentumGraph ? (
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
