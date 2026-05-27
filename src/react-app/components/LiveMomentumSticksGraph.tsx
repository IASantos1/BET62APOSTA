import { memo, useMemo } from 'react';

interface MomentumPoint {
  minute: number;
  home: number;
  away: number;
}

interface LiveMomentumSticksGraphProps {
  darkMode: boolean;
  stats?: any;
  matchEvents?: any[];
  homeName?: string;
  awayName?: string;
  currentMinute?: number;
  statusKey?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function deriveRatios(stats: any): { homeRatio: number; awayRatio: number } {
  let homeRatio = 0.5;
  let awayRatio = 0.5;
  const arr = Array.isArray(stats) ? stats : null;
  if (arr) {
    const teamStats = (side: 'home' | 'away', regex: RegExp) => {
      const t = arr.find((s: any) => String(s?.team?.id || '').toLowerCase().includes(side));
      if (!t?.statistics) return 0;
      const it = t.statistics.find((x: any) => regex.test(String(x?.type || '')));
      if (!it) return 0;
      const v = String(it.value ?? '').replace('%', '');
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const possH = teamStats('home', /possession/i) || 50;
    const dangH = teamStats('home', /dangerous.*attack/i);
    const dangA = teamStats('away', /dangerous.*attack/i);
    const totDang = dangH + dangA;
    const dangBiasH = totDang > 0 ? dangH / totDang : 0.5;
    homeRatio = (possH / 100) * 0.6 + dangBiasH * 0.4;
    awayRatio = 1 - homeRatio;
  } else if (stats && typeof stats === 'object') {
    const homeShots = Number(stats?.shots?.home || stats?.onTarget?.home || 0);
    const awayShots = Number(stats?.shots?.away || stats?.onTarget?.away || 0);
    const homeAttacks = Number(stats?.attacks?.home || homeShots * 3);
    const awayAttacks = Number(stats?.attacks?.away || awayShots * 3);
    const totalAttacks = homeAttacks + awayAttacks || 1;
    homeRatio = homeAttacks / totalAttacks;
    awayRatio = awayAttacks / totalAttacks;
  }
  return { homeRatio, awayRatio };
}

function buildMomentumData(stats: any, endMin: number, axisMax: number): MomentumPoint[] {
  if (endMin <= 0) return [];
  const { homeRatio, awayRatio } = deriveRatios(stats);
  const points: MomentumPoint[] = [];
  const step = 2;
  const deterministicFlow = (m: number) => {
    const t = m / Math.max(axisMax, 90);
    return 0.18 * Math.sin(t * Math.PI * 2.7 + 0.4) + 0.10 * Math.sin(t * Math.PI * 5.1 + 1.2);
  };
  const pushAt = (m: number) => {
    const flow = deterministicFlow(m);
    points.push({
      minute: m,
      home: clamp(homeRatio + flow, 0.08, 0.92),
      away: clamp(awayRatio - flow, 0.08, 0.92),
    });
  };
  for (let m = 0; m <= endMin; m += step) pushAt(m);
  if (points[points.length - 1]?.minute !== endMin) pushAt(endMin);
  return points;
}

function LiveMomentumSticksGraph({
  darkMode, stats, matchEvents, homeName, awayName, currentMinute, statusKey,
}: LiveMomentumSticksGraphProps) {
  const status = String(statusKey || '').toUpperCase().trim();
  const minute = Math.max(0, Number(currentMinute) || 0);
  const isHT = status === 'HT' || status === 'INT' || /half.?time|intervalo/i.test(status);
  const isFT = ['FT', 'AET', 'PEN', 'FINISHED', 'ENDED', 'AFTER'].some(k => status.includes(k));
  const is1H = status === '1H' || status === '1' || (!isHT && !isFT && minute > 0 && minute <= 45);
  const is2H = status === '2H' || status === '2H' || status === '2' || status === 'ET' || status === 'P';
  const AXIS_MAX = Math.max(95, minute + 2, isFT ? 90 : 0);
  let endMin: number;
  if (isFT)       endMin = Math.max(minute, 90);
  else if (isHT)  endMin = Math.max(minute, 45);
  else if (is1H)  endMin = Math.min(minute, 50);
  else if (is2H)  endMin = Math.min(Math.max(minute, 45), 100);
  else            endMin = Math.min(minute, AXIS_MAX);

  const data = useMemo(() => buildMomentumData(stats, endMin, AXIS_MAX), [stats, endMin, AXIS_MAX]);

  const W = 320;
  const H = 120;
  const PAD_TOP = 30;
  const PAD = 10;
  const plotW = W - PAD * 2;
  const plotH = H - PAD - PAD_TOP;
  const minToX = (m: number) => PAD + (clamp(m, 0, AXIS_MAX) / AXIS_MAX) * plotW;
  const baseY = PAD_TOP + plotH / 2;
  const barW = 3.2;

  return (
    <div className={`rounded-xl overflow-hidden ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
      <div className="px-4 pt-3 pb-1">
        <div className="text-[11px] font-black uppercase tracking-widest text-red-600">Pressão em Tempo Real</div>
      </div>

      <div className="flex items-center justify-between px-4 -mt-0.5 pb-2">
        <span className={`text-xs font-bold truncate max-w-[40%] ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{homeName || 'Casa'}</span>
        <span className={`text-xs font-bold truncate max-w-[40%] text-right ${darkMode ? 'text-green-300' : 'text-green-600'}`}>{awayName || 'Fora'}</span>
      </div>

      <div className="px-3 pb-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
          <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY} stroke={darkMode ? '#334155' : '#e5e7eb'} strokeWidth="1" />
          {data.map((p, idx) => {
            const x = minToX(p.minute);
            const d = clamp(p.home - 0.5, -0.5, 0.5);
            const h = Math.abs(d) * plotH;
            const y1 = baseY;
            const y2 = d >= 0 ? baseY - h : baseY + h;
            const stroke = d >= 0 ? '#ef4444' : '#22c55e';
            return (
              <line
                key={`${p.minute}-${idx}`}
                x1={x}
                y1={y1}
                x2={x}
                y2={y2}
                stroke={stroke}
                strokeWidth={barW}
                strokeLinecap="round"
                opacity={0.95}
              />
            );
          })}
          <text x={PAD} y={H - 6} fontSize="10" fill={darkMode ? '#94a3b8' : '#9ca3af'}>0'</text>
          <text x={W - PAD} y={H - 6} fontSize="10" fill={darkMode ? '#94a3b8' : '#9ca3af'} textAnchor="end">{Math.floor(endMin)}'</text>
        </svg>

        {(!Array.isArray(matchEvents) || matchEvents.length === 0) && (
          <div className={`text-center text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Nenhum evento registado neste momento.
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(LiveMomentumSticksGraph);
