import { useEffect, useRef, memo, useState } from 'react';

interface FootballPitchAnimationProps {
  homeName: string;
  awayName: string;
  isLive?: boolean;
  score?: string;
  statusLabel?: string;
  timer?: string;
  sport?: string;
  matchEvents?: any[];
  /** Real-time stats from StatPal (possession, attacks, dangerous_attacks, shots) */
  liveStats?: any[] | null;
}

// Extract a numeric stat from API-Football style stats array for a given team
function getTeamStat(stats: any[] | null | undefined, teamSide: 'home' | 'away', statType: RegExp): number {
  if (!Array.isArray(stats) || stats.length === 0) return 0;
  const teamStats = stats.find((s) => {
    const id = String(s?.team?.id || '').toLowerCase();
    return id === teamSide || (teamSide === 'home' && id.includes('home')) || (teamSide === 'away' && id.includes('away'));
  });
  if (!teamStats?.statistics) return 0;
  const entry = teamStats.statistics.find((x: any) => statType.test(String(x?.type || '')));
  if (!entry) return 0;
  const v = String(entry.value ?? '').replace('%', '').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

type SportType = 'football' | 'basketball' | 'tennis' | 'volleyball' | 'handball' | 'hockey' | 'default';

function detectSport(sport?: string): SportType {
  const s = (sport || '').toLowerCase();
  if (s.includes('basketball') || s.includes('basquete') || s.includes('nba')) return 'basketball';
  if (s.includes('tennis') || s.includes('tênis')) return 'tennis';
  if (s.includes('volleyball') || s.includes('vôlei')) return 'volleyball';
  if (s.includes('handball') || s.includes('andebol')) return 'handball';
  if (s.includes('hockey') || s.includes('hóquei')) return 'hockey';
  return 'football';
}

function parseEventLabel(ev: any): { icon: string; label: string } | null {
  const text = String(ev?.text || ev?.description || ev?.event || ev?.type || ev?.detail || '').toLowerCase();
  if (/goal|gol|score/i.test(text)) return { icon: '⚽', label: 'GOL!' };
  if (/corner|escanteio/i.test(text)) return { icon: '🚩', label: 'Escanteio' };
  if (/var/i.test(text)) return { icon: '📺', label: 'VAR' };
  if (/penalty|pênalti|penalti/i.test(text)) return { icon: '🎯', label: 'Pênalti' };
  if (/red.?card|cartão.?verm/i.test(text)) return { icon: '🟥', label: 'Cartão Vermelho' };
  if (/yellow.?card|cartão.?ama/i.test(text)) return { icon: '🟨', label: 'Cartão Amarelo' };
  if (/foul|falta/i.test(text)) return { icon: '🤚', label: 'Falta' };
  if (/half.?time|intervalo/i.test(text)) return { icon: '🕑', label: 'Intervalo' };
  if (/substitut|substitui/i.test(text)) return { icon: '🔄', label: 'Substituição' };
  if (/offside|fora.?de.?jogo/i.test(text)) return { icon: '🚫', label: 'Fora de Jogo' };
  return null;
}

type BallState = 'moving' | 'stopped' | 'goal_left' | 'goal_right' | 'returning';

function getEventBallState(ev: any, homeName: string): BallState | null {
  if (!ev) return null;
  const type = String(ev?.type || '').toLowerCase();
  const detail = String(ev?.detail || ev?.description || ev?.text || ev?.event || '').toLowerCase();
  const combined = `${type} ${detail}`;
  const teamName = String(ev?.team?.name || '').toLowerCase();
  const isHomeTeam = homeName && teamName && homeName.toLowerCase().includes(teamName.slice(0, 5));

  if (/goal|gol/i.test(combined)) {
    // Determine which goal based on which team scored
    // Home team scores → ball goes to right goal (attacking right by convention)
    // Away team scores → ball goes to left goal
    return isHomeTeam ? 'goal_right' : 'goal_left';
  }
  if (/corner|escanteio|throw.?in|lateral|var|offside|fora.?de.?jogo|half.?time|intervalo|penalty|pênalti|free.?kick|falta|red.?card|yellow.?card|cartão|substitut/i.test(combined)) {
    return 'stopped';
  }
  return null;
}

// ─── FOOTBALL PITCH SVG with corner flags ────────────────────────────────────
const FootballField = () => (
  <g>
    <defs>
      <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1a7a1a" />
        <stop offset="33%" stopColor="#1e8c1e" />
        <stop offset="66%" stopColor="#1a7a1a" />
        <stop offset="100%" stopColor="#1e8c1e" />
      </linearGradient>
    </defs>
    <rect width="300" height="180" fill="url(#pitchGrad)" rx="4" />
    {[20,40,60,80,100,120,140,160,180,200,220,240,260,280].map(x => (
      <line key={x} x1={x} y1="0" x2={x} y2="180" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
    ))}
    <rect x="8" y="8" width="284" height="164" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" rx="2" />
    <line x1="150" y1="8" x2="150" y2="172" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="26" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="2" fill="rgba(255,255,255,0.9)" />
    {/* Penalty areas */}
    <rect x="8" y="55" width="48" height="70" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <rect x="244" y="55" width="48" height="70" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    {/* Goal areas */}
    <rect x="8" y="70" width="22" height="40" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    <rect x="270" y="70" width="22" height="40" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    {/* Goals */}
    <rect x="0" y="76" width="8" height="28" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    <rect x="292" y="76" width="8" height="28" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    {/* Penalty spots */}
    <circle cx="56" cy="90" r="2.5" fill="rgba(255,255,255,0.7)" />
    <circle cx="244" cy="90" r="2.5" fill="rgba(255,255,255,0.7)" />
    {/* Corner arcs */}
    <path d="M8 8 A8 8 0 0 1 16 8" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M292 8 A8 8 0 0 1 292 16" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M8 172 A8 8 0 0 0 8 164" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M292 172 A8 8 0 0 1 284 172" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    {/* Corner flags — top-left */}
    <line x1="8" y1="8" x2="8" y2="0" stroke="#ffdd44" strokeWidth="1.5" />
    <polygon points="8,0 14,3 8,6" fill="#e63000" />
    {/* Corner flags — top-right */}
    <line x1="292" y1="8" x2="292" y2="0" stroke="#ffdd44" strokeWidth="1.5" />
    <polygon points="292,0 286,3 292,6" fill="#e63000" />
    {/* Corner flags — bottom-left */}
    <line x1="8" y1="172" x2="8" y2="180" stroke="#ffdd44" strokeWidth="1.5" />
    <polygon points="8,180 14,177 8,174" fill="#e63000" />
    {/* Corner flags — bottom-right */}
    <line x1="292" y1="172" x2="292" y2="180" stroke="#ffdd44" strokeWidth="1.5" />
    <polygon points="292,180 286,177 292,174" fill="#e63000" />
  </g>
);

// ─── OTHER SPORT FIELDS ───────────────────────────────────────────────────────
const BasketballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#c8692a" rx="4" />
    <rect x="5" y="5" width="290" height="170" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="5" x2="150" y2="175" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="20" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="3" fill="rgba(255,255,255,0.9)" />
    <path d="M5 55 L75 55 L75 125 L5 125" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <path d="M295 55 L225 55 L225 125 L295 125" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <path d="M5 55 A35 35 0 0 1 5 125" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="5 3"/>
    <path d="M295 55 A35 35 0 0 0 295 125" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="5 3"/>
    <rect x="0" y="79" width="5" height="22" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    <rect x="295" y="79" width="5" height="22" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
  </g>
);

const TennisCourt = () => (
  <g>
    <rect width="300" height="180" fill="#2e6ca8" rx="4" />
    <rect x="10" y="10" width="280" height="160" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="10" x2="150" y2="170" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <line x1="10" y1="90" x2="290" y2="90" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
    <line x1="10" y1="40" x2="290" y2="40" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    <line x1="10" y1="140" x2="290" y2="140" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    <line x1="150" y1="40" x2="150" y2="140" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    <line x1="10" y1="90" x2="290" y2="90" stroke="rgba(255,255,255,0.5)" strokeWidth="3" />
  </g>
);

const VolleyballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#8b4513" rx="4" />
    <rect x="10" y="15" width="280" height="150" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="15" x2="150" y2="165" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <line x1="150" y1="15" x2="150" y2="165" stroke="rgba(255,255,255,0.9)" strokeWidth="4" />
    <line x1="70" y1="15" x2="70" y2="165" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="4 3"/>
    <line x1="230" y1="15" x2="230" y2="165" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="4 3"/>
  </g>
);

const HandballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#d4a020" rx="4" />
    <rect x="8" y="8" width="284" height="164" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="8" x2="150" y2="172" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <path d="M8 62 A48 48 0 0 1 8 118" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
    <path d="M292 62 A48 48 0 0 0 292 118" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
    <rect x="0" y="74" width="8" height="32" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
    <rect x="292" y="74" width="8" height="32" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
  </g>
);

const HockeyRink = () => (
  <g>
    <rect width="300" height="180" fill="#a8d4f0" rx="4" />
    <rect x="8" y="8" width="284" height="164" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" rx="20" />
    <line x1="150" y1="8" x2="150" y2="172" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="12" fill="none" stroke="rgba(255,0,0,0.7)" strokeWidth="1.5" />
    <line x1="80" y1="8" x2="80" y2="172" stroke="rgba(255,0,0,0.5)" strokeWidth="1" />
    <line x1="220" y1="8" x2="220" y2="172" stroke="rgba(255,0,0,0.5)" strokeWidth="1" />
    <rect x="0" y="72" width="8" height="36" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
    <rect x="292" y="72" width="8" height="36" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.8)" strokeWidth="1" />
  </g>
);

const clean = (s: string) => s.replace(/\s*\(.*?\)/g, '').trim();

const BALL_CONFIG: Record<SportType, { r: number; fill: string; stroke: string; lines: boolean }> = {
  football:   { r: 6, fill: 'white', stroke: '#111', lines: true },
  basketball: { r: 7, fill: '#e87722', stroke: '#5c3317', lines: false },
  tennis:     { r: 5, fill: '#d4e157', stroke: '#827717', lines: false },
  volleyball: { r: 7, fill: 'white', stroke: '#1565c0', lines: false },
  handball:   { r: 6, fill: '#c62828', stroke: '#7f0000', lines: false },
  hockey:     { r: 5, fill: '#212121', stroke: '#555', lines: false },
  default:    { r: 6, fill: 'white', stroke: '#111', lines: true },
};

function FootballPitchAnimation({
  homeName, awayName, isLive, score, statusLabel, timer, sport, matchEvents, liveStats,
}: FootballPitchAnimationProps) {
  const sportType = detectSport(sport);
  const ball = BALL_CONFIG[sportType] || BALL_CONFIG.default;

  const ballRef  = useRef<SVGCircleElement>(null);
  const animRef  = useRef<number>(0);
  const posRef   = useRef({ x: 150, y: 90, vx: 0, vy: 0 });
  const stateRef = useRef<BallState>('moving');

  const [eventOverlay, setEventOverlay] = useState<{ icon: string; label: string } | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Event overlay (UI badge) ──────────────────────────────────────────────
  useEffect(() => {
    if (!matchEvents?.length) return;
    const latest = matchEvents[matchEvents.length - 1];
    const parsed = parseEventLabel(latest);
    if (!parsed) return;
    setEventOverlay(parsed);
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setEventOverlay(null), 3500);
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current); };
  }, [matchEvents]);

  // ── Ball physics — DETERMINISTIC (Lissajous curve, no randomness) ─────────
  useEffect(() => {
    const ballEl = ballRef.current;
    if (!ballEl) return;
    if (animRef.current) cancelAnimationFrame(animRef.current);

    // Pre-game or non-football → ball stationary at center
    if (!isLive || sportType !== 'football') {
      ballEl.setAttribute('cx', '150');
      ballEl.setAttribute('cy', '90');
      return;
    }

    const p = posRef.current;

    // Determine ball state from latest event
    const latestEv = matchEvents?.[matchEvents.length - 1];
    const newState = getEventBallState(latestEv, homeName);
    if (newState) stateRef.current = newState;

    // Corner position chosen from event count (deterministic, not random)
    const cornerIdx = (matchEvents?.length ?? 0) % 4;
    const corners = [
      { x: 10, y: 10 }, { x: 290, y: 10 }, { x: 10, y: 170 }, { x: 290, y: 170 },
    ];
    const cornerPos = corners[cornerIdx];

    // Goal target positions
    const goalLeftPos  = { x: 5,   y: 90 };
    const goalRightPos = { x: 295, y: 90 };

    // Auto-resume after a stop (ball shouldn't stay stopped forever)
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    if (stateRef.current === 'stopped') {
      resumeTimer = setTimeout(() => {
        stateRef.current = 'moving';
      }, 20000);
    }

    const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

    // Anchor time so the Lissajous curve is consistent each render
    const t0 = performance.now();

    const step = () => {
      const cur = stateRef.current;
      const t = (performance.now() - t0) / 1000; // seconds

      if (cur === 'moving') {
        // ── Reactive movement biased by real StatPal data ──────────────────
        // Posse de bola → centro de gravidade do movimento (esquerda/direita)
        // Ataques perigosos → tendência a empurrar a bola para a área adversária
        // Casa ataca da esquerda → direita; Fora ataca da direita → esquerda
        const possHome = getTeamStat(liveStats, 'home', /possession/i) || 50;
        const dangerHome = getTeamStat(liveStats, 'home', /dangerous.*attack/i) || 0;
        const dangerAway = getTeamStat(liveStats, 'away', /dangerous.*attack/i) || 0;
        const attacksHome = getTeamStat(liveStats, 'home', /^attacks$/i) || 0;
        const attacksAway = getTeamStat(liveStats, 'away', /^attacks$/i) || 0;

        // Centro X do movimento varia entre 90 (casa dominante) e 210 (fora dominante)
        // A casa joga atacando para a direita (centro de gravidade da bola desloca-se para a direita
        // quando ela tem mais posse + mais ataques; o oposto para a fora).
        const totalDanger = dangerHome + dangerAway;
        const totalAttacks = attacksHome + attacksAway;
        const dangerBiasHome = totalDanger > 0 ? dangerHome / totalDanger : 0.5;
        const attackBiasHome = totalAttacks > 0 ? attacksHome / totalAttacks : 0.5;
        // Combinação: 50% posse + 30% ataques perigosos + 20% ataques totais
        const homePressure = (possHome / 100) * 0.5 + dangerBiasHome * 0.3 + attackBiasHome * 0.2;
        // homePressure 0 → ball stays in home half (left); 1 → ball stays in away half (right)
        const centerX = 60 + homePressure * 180; // varia entre 60 e 240

        // Amplitudes ajustam-se à pressão: equipa muito dominante = movimento concentrado na área adversária
        const dominance = Math.abs(homePressure - 0.5) * 2; // 0 = equilibrado, 1 = total domínio
        const ampX = 70 - dominance * 30; // mais equilíbrio → mais movimento; mais domínio → mais concentrado
        const ampY = 40;

        const freqX = 0.35; // Hz (~3s ciclo completo)
        const freqY = 0.49; // razão irracional → padrão não repetitivo
        const phaseY = Math.PI / 4;
        p.x = centerX + ampX * Math.sin(2 * Math.PI * freqX * t);
        p.y = 90 + ampY * Math.sin(2 * Math.PI * freqY * t + phaseY);

        // Clamp dentro dos limites do campo
        p.x = Math.max(15, Math.min(285, p.x));
        p.y = Math.max(15, Math.min(165, p.y));

      } else if (cur === 'stopped') {
        // Ball stays at current position (no movement)

      } else if (cur === 'goal_left' || cur === 'goal_right') {
        const target = cur === 'goal_left' ? goalLeftPos : goalRightPos;
        p.x = lerp(p.x, target.x, 0.06);
        p.y = lerp(p.y, target.y, 0.06);
        const dist = Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
        if (dist < 2) {
          stateRef.current = 'returning';
          setTimeout(() => {
            p.x = target.x;
            p.y = target.y;
          }, 1500);
        }

      } else if (cur === 'returning') {
        p.x = lerp(p.x, 150, 0.04);
        p.y = lerp(p.y, 90,  0.04);
        const dist = Math.abs(p.x - 150) + Math.abs(p.y - 90);
        if (dist < 3) {
          p.x = 150; p.y = 90;
          stateRef.current = 'moving';
        }
      }

      // Smooth glide to corner if event is a corner kick
      const text = String(latestEv?.type || latestEv?.detail || '').toLowerCase();
      if (cur === 'stopped' && /corner|escanteio/i.test(text)) {
        p.x = lerp(p.x, cornerPos.x, 0.05);
        p.y = lerp(p.y, cornerPos.y, 0.05);
      }

      ballEl.setAttribute('cx', String(Math.round(p.x * 10) / 10));
      ballEl.setAttribute('cy', String(Math.round(p.y * 10) / 10));
      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [isLive, sportType, matchEvents, homeName, liveStats]);

  const homeShort = clean(homeName).slice(0, 14);
  const awayShort = clean(awayName).slice(0, 14);

  const renderField = () => {
    switch (sportType) {
      case 'basketball': return <BasketballCourt />;
      case 'tennis':     return <TennisCourt />;
      case 'volleyball': return <VolleyballCourt />;
      case 'handball':   return <HandballCourt />;
      case 'hockey':     return <HockeyRink />;
      default:           return <FootballField />;
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none" style={{ minHeight: 180 }}>
      <svg
        viewBox="0 0 300 180"
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="ballShadow">
            <feDropShadow dx="1" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>

        {renderField()}

        {/* Ball */}
        <circle
          ref={ballRef}
          cx="150" cy="90"
          r={ball.r}
          fill={ball.fill}
          stroke={ball.stroke}
          strokeWidth="0.8"
          filter="url(#ballShadow)"
        />
        {ball.lines && (
          <circle cx="150" cy="90" r={ball.r} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="0.5"
            strokeDasharray="4 3"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Pregame indicator */}
        {!isLive && (
          <text x="150" y="30" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="9" fontWeight="bold" letterSpacing="2">
            PRÉ-JOGO
          </text>
        )}
      </svg>

      {/* Event Overlay */}
      {eventOverlay && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-black/70 text-white px-4 py-2 rounded-xl text-center animate-bounce shadow-xl">
            <div className="text-2xl">{eventOverlay.icon}</div>
            <div className="text-xs font-black uppercase tracking-widest text-yellow-300">{eventOverlay.label}</div>
          </div>
        </div>
      )}

      {/* Team names & score */}
      <div className="relative z-10 w-full flex items-center justify-between px-3 pointer-events-none" style={{ paddingTop: 8 }}>
        <div className="text-left" style={{ maxWidth: '36%' }}>
          <div className="text-white font-bold text-xs md:text-sm leading-tight drop-shadow-lg truncate">{homeShort}</div>
        </div>

        <div className="text-center flex flex-col items-center gap-0.5">
          {isLive && score ? (
            <>
              <div className="text-white font-black text-2xl md:text-3xl leading-none drop-shadow-lg tabular-nums">{score}</div>
              <div className="flex items-center gap-1 mt-0.5">
                {statusLabel && (
                  <span className="text-[10px] font-bold bg-black/40 text-white px-2 py-0.5 rounded uppercase">{statusLabel}</span>
                )}
                {timer && (
                  <span className="text-[10px] font-bold bg-red-600/90 text-white px-2 py-0.5 rounded">{timer}</span>
                )}
                <span className="relative flex h-1.5 w-1.5 ml-0.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                </span>
              </div>
            </>
          ) : (
            <div className="text-white font-black text-xl drop-shadow-lg opacity-80">VS</div>
          )}
        </div>

        <div className="text-right" style={{ maxWidth: '36%' }}>
          <div className="text-white font-bold text-xs md:text-sm leading-tight drop-shadow-lg truncate">{awayShort}</div>
        </div>
      </div>
    </div>
  );
}

export default memo(FootballPitchAnimation);
