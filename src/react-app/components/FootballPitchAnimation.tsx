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
  const text = String(ev?.text || ev?.description || ev?.event || ev?.type || '').toLowerCase();
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

// ─── FOOTBALL PITCH SVG ──────────────────────────────────────────────────────
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
    <rect x="8" y="55" width="48" height="70" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <rect x="244" y="55" width="48" height="70" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <rect x="8" y="70" width="22" height="40" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    <rect x="270" y="70" width="22" height="40" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    <circle cx="56" cy="90" r="2.5" fill="rgba(255,255,255,0.7)" />
    <circle cx="244" cy="90" r="2.5" fill="rgba(255,255,255,0.7)" />
    {/* Corner arcs */}
    <path d="M8 8 A8 8 0 0 1 16 8" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M292 8 A8 8 0 0 1 292 16" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M8 172 A8 8 0 0 0 8 164" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
    <path d="M292 172 A8 8 0 0 1 284 172" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="none"/>
  </g>
);

// ─── BASKETBALL COURT SVG ─────────────────────────────────────────────────────
const BasketballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#c8692a" rx="4" />
    <rect x="5" y="5" width="290" height="170" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="5" x2="150" y2="175" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="20" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    {/* Left key */}
    <rect x="5" y="60" width="55" height="60" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    <path d="M60 60 A30 30 0 0 1 60 120" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    {/* Right key */}
    <rect x="240" y="60" width="55" height="60" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    <path d="M240 60 A30 30 0 0 0 240 120" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    {/* Baskets */}
    <circle cx="28" cy="90" r="6" fill="none" stroke="rgba(255,160,0,0.9)" strokeWidth="2" />
    <circle cx="272" cy="90" r="6" fill="none" stroke="rgba(255,160,0,0.9)" strokeWidth="2" />
    {/* 3-point arcs */}
    <path d="M5 35 L45 35 A65 65 0 0 1 45 145 L5 145" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    <path d="M295 35 L255 35 A65 65 0 0 0 255 145 L295 145" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
  </g>
);

// ─── TENNIS COURT SVG ────────────────────────────────────────────────────────
const TennisCourt = () => (
  <g>
    <rect width="300" height="180" fill="#3a7d3a" rx="4" />
    <rect x="10" y="10" width="280" height="160" fill="#4b9e4b" rx="2" />
    <rect x="10" y="10" width="280" height="160" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    {/* Net */}
    <line x1="150" y1="10" x2="150" y2="170" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeDasharray="3 3" />
    {/* Service boxes */}
    <line x1="10" y1="90" x2="290" y2="90" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
    <line x1="80" y1="50" x2="80" y2="130" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
    <line x1="220" y1="50" x2="220" y2="130" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
    {/* Baselines */}
    <line x1="10" y1="35" x2="290" y2="35" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
    <line x1="10" y1="145" x2="290" y2="145" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
    {/* Net posts */}
    <circle cx="150" cy="10" r="3" fill="rgba(255,255,255,0.6)" />
    <circle cx="150" cy="170" r="3" fill="rgba(255,255,255,0.6)" />
  </g>
);

// ─── VOLLEYBALL COURT SVG ────────────────────────────────────────────────────
const VolleyballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#6b4c1e" rx="4" />
    <rect x="10" y="10" width="280" height="160" fill="#7d5820" rx="2" />
    <rect x="10" y="10" width="280" height="160" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    {/* Net */}
    <line x1="150" y1="10" x2="150" y2="170" stroke="rgba(255,255,255,0.95)" strokeWidth="2.5" />
    {/* Attack lines */}
    <line x1="110" y1="10" x2="110" y2="170" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeDasharray="4 4" />
    <line x1="190" y1="10" x2="190" y2="170" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeDasharray="4 4" />
    {/* Center line */}
    <line x1="10" y1="90" x2="290" y2="90" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
  </g>
);

// ─── HANDBALL COURT SVG ──────────────────────────────────────────────────────
const HandballCourt = () => (
  <g>
    <rect width="300" height="180" fill="#a0522d" rx="4" />
    <rect x="8" y="8" width="284" height="164" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="150" y1="8" x2="150" y2="172" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="15" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
    {/* Goal areas */}
    <path d="M8 55 A45 45 0 0 1 8 125" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    <path d="M292 55 A45 45 0 0 0 292 125" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
    {/* Free throw lines */}
    <path d="M8 65 A30 30 0 0 1 8 115" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="3 3" />
    <path d="M292 65 A30 30 0 0 0 292 115" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="3 3" />
    {/* Goals */}
    <rect x="8" y="75" width="12" height="30" fill="none" stroke="rgba(255,200,0,0.9)" strokeWidth="2" />
    <rect x="280" y="75" width="12" height="30" fill="none" stroke="rgba(255,200,0,0.9)" strokeWidth="2" />
  </g>
);

// ─── ICE HOCKEY RINK SVG ─────────────────────────────────────────────────────
const HockeyRink = () => (
  <g>
    <rect width="300" height="180" rx="25" fill="#d0e8f0" />
    <rect x="5" y="5" width="290" height="170" rx="20" fill="none" stroke="#3366aa" strokeWidth="2" />
    <line x1="150" y1="5" x2="150" y2="175" stroke="#cc3333" strokeWidth="2" />
    <circle cx="150" cy="90" r="20" fill="none" stroke="#cc3333" strokeWidth="1.5" />
    <circle cx="150" cy="90" r="2" fill="#cc3333" />
    {/* Blue lines */}
    <line x1="95" y1="5" x2="95" y2="175" stroke="#3366aa" strokeWidth="1.5" />
    <line x1="205" y1="5" x2="205" y2="175" stroke="#3366aa" strokeWidth="1.5" />
    {/* Face-off circles */}
    <circle cx="60" cy="58" r="15" fill="none" stroke="#cc3333" strokeWidth="1" />
    <circle cx="60" cy="122" r="15" fill="none" stroke="#cc3333" strokeWidth="1" />
    <circle cx="240" cy="58" r="15" fill="none" stroke="#cc3333" strokeWidth="1" />
    <circle cx="240" cy="122" r="15" fill="none" stroke="#cc3333" strokeWidth="1" />
    {/* Goals */}
    <rect x="5" y="75" width="15" height="30" fill="rgba(204,51,51,0.3)" stroke="#cc3333" strokeWidth="1.5" />
    <rect x="280" y="75" width="15" height="30" fill="rgba(204,51,51,0.3)" stroke="#cc3333" strokeWidth="1.5" />
  </g>
);

// ─── Ball colors per sport ────────────────────────────────────────────────────
function getBallProps(sportType: SportType) {
  switch (sportType) {
    case 'basketball': return { fill: '#f0742e', stroke: '#111', r: 6, lines: true };
    case 'tennis': return { fill: '#ccdd00', stroke: '#888', r: 5, lines: false };
    case 'volleyball': return { fill: '#ffffff', stroke: '#3355aa', r: 6, lines: true };
    case 'handball': return { fill: '#ef5350', stroke: '#111', r: 6, lines: false };
    case 'hockey': return { fill: '#111111', stroke: '#333', r: 5, lines: false };
    default: return { fill: '#ffffff', stroke: '#333', r: 5.5, lines: true };
  }
}

function FootballPitchAnimation({ homeName, awayName, isLive, score, statusLabel, timer, sport, matchEvents }: FootballPitchAnimationProps) {
  const ballRef = useRef<SVGCircleElement>(null);
  const animRef = useRef<number | null>(null);
  const posRef = useRef({ x: 150, y: 90, vx: 0.8, vy: 0.5 });
  const [eventOverlay, setEventOverlay] = useState<{ icon: string; label: string } | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sportType = detectSport(sport);
  const ball = getBallProps(sportType);
  const clean = (n: string) => String(n || '').replace(/\sU\d+$/, '').trim();

  // Show latest event overlay
  useEffect(() => {
    if (!matchEvents || matchEvents.length === 0) return;
    const latest = matchEvents[matchEvents.length - 1];
    const parsed = parseEventLabel(latest);
    if (!parsed) return;
    setEventOverlay(parsed);
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setEventOverlay(null), 3500);
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current); };
  }, [matchEvents]);

  // Ball animation — only when live
  useEffect(() => {
    const ballEl = ballRef.current;
    if (!ballEl) return;

    if (!isLive) {
      // Stationary at center
      ballEl.setAttribute('cx', '150');
      ballEl.setAttribute('cy', '90');
      return;
    }

    const FIELD_W = 300;
    const FIELD_H = 180;
    const MARGIN = 10;
    const SPEED = 0.75;

    const p = posRef.current;
    p.x = 150; p.y = 90;
    p.vx = (Math.random() > 0.5 ? 1 : -1) * (SPEED + Math.random() * 0.4);
    p.vy = (Math.random() > 0.5 ? 1 : -1) * (SPEED * 0.6 + Math.random() * 0.3);

    const step = () => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x <= MARGIN + ball.r) { p.x = MARGIN + ball.r; p.vx = Math.abs(p.vx); }
      if (p.x >= FIELD_W - MARGIN - ball.r) { p.x = FIELD_W - MARGIN - ball.r; p.vx = -Math.abs(p.vx); }
      if (p.y <= MARGIN + ball.r) { p.y = MARGIN + ball.r; p.vy = Math.abs(p.vy); }
      if (p.y >= FIELD_H - MARGIN - ball.r) { p.y = FIELD_H - MARGIN - ball.r; p.vy = -Math.abs(p.vy); }

      // Random direction jitter
      if (Math.random() < 0.005) {
        p.vx += (Math.random() - 0.5) * 0.5;
        p.vy += (Math.random() - 0.5) * 0.5;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const target = SPEED + Math.random() * 0.4;
        if (speed > 0) { p.vx = (p.vx / speed) * target; p.vy = (p.vy / speed) * target; }
      }

      ballEl.setAttribute('cx', String(p.x));
      ballEl.setAttribute('cy', String(p.y));
      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isLive, sportType]);

  const homeShort = clean(homeName).slice(0, 14);
  const awayShort = clean(awayName).slice(0, 14);

  const renderField = () => {
    switch (sportType) {
      case 'basketball': return <BasketballCourt />;
      case 'tennis': return <TennisCourt />;
      case 'volleyball': return <VolleyballCourt />;
      case 'handball': return <HandballCourt />;
      case 'hockey': return <HockeyRink />;
      default: return <FootballField />;
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

      {/* Event Overlay (center of field) */}
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
