// LiveMomentumGraph — wave-based momentum chart with event markers
// Above the wave we plot icons (⚽ ⚽ goals, 🟨 🟥 cards) at the minute they happened.
import { memo, useMemo } from 'react';

interface MomentumPoint {
  minute: number;
  home: number;
  away: number;
}

interface MarkedEvent {
  minute: number;
  side: 'home' | 'away' | 'unknown';
  kind: 'goal' | 'yellow' | 'red';
}

interface LiveMomentumGraphProps {
  darkMode: boolean;
  stats?: any;
  matchEvents?: any[];
  homeName?: string;
  awayName?: string;
  currentMinute?: number;
}

// Try to extract the minute number from various StatPal/API-Football shapes
function extractMinute(ev: any): number | null {
  const sources = [
    ev?.minute,
    ev?.timer,
    ev?.time?.elapsed,
    ev?.elapsed,
  ];
  for (const s of sources) {
    const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0 && n <= 130) return n;
  }
  // Fall back to scanning text for "12'"
  const text = `${ev?.text || ''} ${ev?.event || ''} ${ev?.detail || ''}`;
  const m = /(\d+)'/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function classifyEvent(ev: any): MarkedEvent['kind'] | null {
  const text = `${ev?.type || ''} ${ev?.detail || ''} ${ev?.text || ''} ${ev?.event || ''}`.toLowerCase();
  if (/red.?card|cartão.?verm/.test(text))            return 'red';
  if (/yellow.?card|cartão.?ama/.test(text))          return 'yellow';
  if (/\b(goal|gol)\b/.test(text) && !/disallow|cancel|anulad|missed|own/.test(text)) return 'goal';
  return null;
}

function classifyTeam(ev: any, homeName?: string): MarkedEvent['side'] {
  const teamName = String(ev?.team?.name || ev?.team || '').toLowerCase();
  const homeNorm = String(homeName || '').toLowerCase().slice(0, 6);
  if (!teamName) return 'unknown';
  if (homeNorm && teamName.includes(homeNorm)) return 'home';
  return 'away';
}

function buildMomentumData(stats: any, currentMinute: number): MomentumPoint[] {
  const totalMinutes = Math.max(currentMinute || 90, 10);

  // Pull team-level stats (API-Football style with team.id home/away)
  const teamStats = (arr: any[] | undefined, side: 'home' | 'away', regex: RegExp) => {
    if (!Array.isArray(arr)) return 0;
    const t = arr.find((s: any) => String(s?.team?.id || '').toLowerCase().includes(side));
    if (!t?.statistics) return 0;
    const it = t.statistics.find((x: any) => regex.test(String(x?.type || '')));
    if (!it) return 0;
    const v = String(it.value ?? '').replace('%', '');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const arr = Array.isArray(stats) ? stats : null;
  let homeRatio = 0.5;
  let awayRatio = 0.5;
  if (arr) {
    const possH = teamStats(arr, 'home', /possession/i) || 50;
    const dangH = teamStats(arr, 'home', /dangerous.*attack/i);
    const dangA = teamStats(arr, 'away', /dangerous.*attack/i);
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

  // Build a smooth deterministic wave (sin-based, no Math.random)
  // 16 segments → smoother bezier curve
  const segments = 16;
  const points: MomentumPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const minute = Math.round(t * totalMinutes);
    // Two superimposed sine waves give a "match flow" feel without randomness
    const flow = 0.18 * Math.sin(t * Math.PI * 2.7 + 0.4) + 0.10 * Math.sin(t * Math.PI * 5.1 + 1.2);
    const h = Math.max(0.08, Math.min(0.92, homeRatio + flow));
    const a = Math.max(0.08, Math.min(0.92, awayRatio - flow));
    points.push({ minute, home: h, away: a });
  }
  return points;
}

// Generate a smooth bezier path through points
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function LiveMomentumGraph({ darkMode, stats, matchEvents, homeName, awayName, currentMinute }: LiveMomentumGraphProps) {
  const minute = currentMinute || 0;
  const data = useMemo(() => buildMomentumData(stats, minute), [stats, minute]);

  // Extract goal/card events with minute
  const markedEvents = useMemo<MarkedEvent[]>(() => {
    if (!Array.isArray(matchEvents)) return [];
    const out: MarkedEvent[] = [];
    for (const ev of matchEvents) {
      const kind = classifyEvent(ev);
      if (!kind) continue;
      const min = extractMinute(ev);
      if (min == null) continue;
      out.push({ minute: min, kind, side: classifyTeam(ev, homeName) });
    }
    return out;
  }, [matchEvents, homeName]);

  if (data.length < 2) return null;

  const W = 320;
  const H = 110;             // taller chart for better visibility
  const PAD_TOP = 26;        // space for event markers above
  const PAD = 6;
  const plotW = W - PAD * 2;
  const plotH = H - PAD - PAD_TOP;

  const totalMin = data[data.length - 1].minute || 90;
  const minToX = (m: number) => PAD + (Math.max(0, Math.min(totalMin, m)) / totalMin) * plotW;
  const toX = (i: number) => PAD + (i / (data.length - 1)) * plotW;
  const toY = (v: number) => PAD_TOP + plotH * (1 - v);

  const homePoints = data.map((p, i) => ({ x: toX(i), y: toY(p.home) }));
  const awayPoints = data.map((p, i) => ({ x: toX(i), y: toY(p.away) }));

  const homePath = smoothPath(homePoints);
  const awayPath = smoothPath(awayPoints);

  // Closed area paths (bezier line + bottom edge)
  const homeArea = `${homePath} L${toX(data.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const awayArea = `${awayPath} L${toX(data.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;

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

      <div className="px-3 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }}>
          <defs>
            <linearGradient id="homeGrad2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="awayGrad2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(v => (
            <line
              key={v}
              x1={PAD} y1={toY(v)}
              x2={W - PAD} y2={toY(v)}
              stroke={darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
              strokeWidth="1"
            />
          ))}

          {/* Center reference line */}
          <line x1={PAD} y1={toY(0.5)} x2={W - PAD} y2={toY(0.5)}
            stroke={darkMode ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)'}
            strokeWidth="1" strokeDasharray="3 3"
          />

          {/* Wave areas */}
          <path d={homeArea} fill="url(#homeGrad2)" />
          <path d={awayArea} fill="url(#awayGrad2)" />

          {/* Wave lines */}
          <path d={homePath} fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={awayPath} fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Current minute indicator */}
          {minute > 0 && minute <= totalMin && (
            <>
              <line
                x1={minToX(minute)} y1={PAD_TOP}
                x2={minToX(minute)} y2={H - PAD}
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <circle cx={minToX(minute)} cy={PAD_TOP - 3} r="2.5" fill="#fbbf24">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
              </circle>
            </>
          )}

          {/* Event markers ABOVE the chart with vertical drop line */}
          {markedEvents.map((ev, i) => {
            const x = minToX(ev.minute);
            const color = ev.kind === 'goal' ? '#10b981' : ev.kind === 'red' ? '#ef4444' : '#fbbf24';
            return (
              <g key={`mk${i}`}>
                {/* Vertical line dropping into the wave */}
                <line x1={x} y1={PAD_TOP} x2={x} y2={H - PAD} stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 2" />
                {/* Marker dot at top */}
                <circle cx={x} cy={14} r="6" fill={color} stroke="#fff" strokeWidth="1.2" />
                {/* Icon */}
                <text x={x} y={17} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#fff">
                  {ev.kind === 'goal' ? '⚽' : ev.kind === 'red' ? 'V' : 'A'}
                </text>
                {/* Minute label below the dot */}
                <text x={x} y={26} textAnchor="middle" fontSize="7" fontWeight="bold"
                  fill={darkMode ? '#e5e7eb' : '#111'}
                >
                  {ev.minute}'
                </text>
              </g>
            );
          })}
        </svg>

        {/* Minute axis */}
        <div className="flex justify-between mt-0.5 px-1">
          <span className={`text-[9px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>0'</span>
          <span className={`text-[9px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>45'</span>
          <span className={`text-[9px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{minute > 0 ? `${minute}'` : '90\''}</span>
        </div>
      </div>
    </div>
  );
}

export default memo(LiveMomentumGraph);
