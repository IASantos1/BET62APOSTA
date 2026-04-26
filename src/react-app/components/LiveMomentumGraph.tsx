import { memo } from 'react';

interface MomentumPoint {
  minute: number;
  home: number;
  away: number;
}

interface LiveMomentumGraphProps {
  darkMode: boolean;
  stats?: any;
  matchEvents?: any[];
  homeName?: string;
  awayName?: string;
  currentMinute?: number;
}

function buildMomentumData(stats: any, events: any[], currentMinute: number): MomentumPoint[] {
  // Build momentum from stats (shots, dangerous attacks, corners)
  const totalMinutes = Math.max(currentMinute || 90, 10);
  const points: MomentumPoint[] = [];

  // Use real stats if available
  const homeShots = Number(stats?.shots?.home || stats?.onTarget?.home || 0);
  const awayShots = Number(stats?.shots?.away || stats?.onTarget?.away || 0);
  const homeAttacks = Number(stats?.attacks?.home || homeShots * 3);
  const awayAttacks = Number(stats?.attacks?.away || awayShots * 3);

  // Build wave based on stats ratio
  const totalAttacks = homeAttacks + awayAttacks || 1;
  const homeRatio = homeAttacks / totalAttacks;
  const awayRatio = awayAttacks / totalAttacks;

  // Generate 10 points across the match
  const segments = Math.min(10, Math.max(2, Math.floor(totalMinutes / 9)));
  for (let i = 0; i <= segments; i++) {
    const minute = Math.round((i / segments) * totalMinutes);
    // Add some natural variation
    const noise = () => (Math.random() - 0.5) * 0.25;
    const h = Math.max(0.05, Math.min(0.95, homeRatio + noise()));
    const a = Math.max(0.05, Math.min(0.95, awayRatio + noise()));
    points.push({ minute, home: h, away: a });
  }

  // Overlay events as spikes
  for (const ev of (events || [])) {
    const text = String(ev?.text || ev?.event || ev?.type || '').toLowerCase();
    const minMatch = /(\d+)'/.exec(text);
    if (!minMatch) continue;
    const min = parseInt(minMatch[1]);
    const isHome = /home|casa/i.test(text);
    const isGoal = /goal|gol/i.test(text);
    const isCorner = /corner|escanteio/i.test(text);
    if (isGoal || isCorner) {
      // Find closest point and add spike
      const closest = points.reduce((p, c) => Math.abs(c.minute - min) < Math.abs(p.minute - min) ? c : p, points[0]);
      if (closest) {
        if (isHome) closest.home = Math.min(0.95, closest.home + 0.3);
        else closest.away = Math.min(0.95, closest.away + 0.3);
      }
    }
  }

  return points;
}

function LiveMomentumGraph({ darkMode, stats, matchEvents, homeName, awayName, currentMinute }: LiveMomentumGraphProps) {
  const minute = currentMinute || 0;
  const data = buildMomentumData(stats, matchEvents || [], minute);

  if (data.length < 2) return null;

  const W = 300;
  const H = 60;
  const PAD = 4;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  // Build SVG path from points
  const toX = (i: number) => PAD + (i / (data.length - 1)) * plotW;
  const toYHome = (v: number) => PAD + plotH * (1 - v);
  const toYAway = (v: number) => PAD + plotH * (1 - v);

  const homePath = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toYHome(p.home).toFixed(1)}`).join(' ');
  const awayPath = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toYAway(p.away).toFixed(1)}`).join(' ');

  // Fill areas
  const homeArea = `${homePath} L${toX(data.length - 1).toFixed(1)},${H} L${PAD},${H} Z`;
  const awayArea = `${awayPath} L${toX(data.length - 1).toFixed(1)},${H} L${PAD},${H} Z`;

  return (
    <div className={`rounded-xl overflow-hidden ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className={`text-xs font-bold truncate max-w-[35%] ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{homeName || 'Casa'}</span>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className={`text-[10px] font-bold uppercase ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Momentum</span>
        </div>
        <span className={`text-xs font-bold truncate max-w-[35%] text-right ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{awayName || 'Fora'}</span>
      </div>

      <div className="px-3 pb-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
          <defs>
            <linearGradient id="homeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="awayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(v => (
            <line
              key={v}
              x1={PAD} y1={PAD + plotH * (1 - v)}
              x2={W - PAD} y2={PAD + plotH * (1 - v)}
              stroke={darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
              strokeWidth="1"
            />
          ))}

          {/* Center line */}
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
            stroke={darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}
            strokeWidth="1" strokeDasharray="3 3"
          />

          {/* Home area fill */}
          <path d={homeArea} fill="url(#homeGrad)" />
          {/* Away area fill */}
          <path d={awayArea} fill="url(#awayGrad)" />

          {/* Home line */}
          <path d={homePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Away line */}
          <path d={awayPath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Current minute indicator */}
          {minute > 0 && (
            <line
              x1={toX(data.length - 1)} y1={PAD}
              x2={toX(data.length - 1)} y2={H - PAD}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          )}
        </svg>

        {/* Minute labels */}
        <div className="flex justify-between mt-0.5">
          <span className={`text-[9px] ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>0'</span>
          <span className={`text-[9px] ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>45'</span>
          <span className={`text-[9px] ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>{minute > 0 ? `${minute}'` : '90\''}</span>
        </div>
      </div>
    </div>
  );
}

export default memo(LiveMomentumGraph);
