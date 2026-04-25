import { useEffect, useRef, memo } from 'react';

interface FootballPitchAnimationProps {
  homeName: string;
  awayName: string;
  isLive?: boolean;
  score?: string;
  statusLabel?: string;
  timer?: string;
}

function FootballPitchAnimation({ homeName, awayName, isLive, score, statusLabel, timer }: FootballPitchAnimationProps) {
  const ballRef = useRef<SVGCircleElement>(null);
  const animRef = useRef<number | null>(null);
  const posRef = useRef({ x: 150, y: 100, vx: 0.8, vy: 0.5 });

  const clean = (n: string) => String(n || '').replace(/\sU\d+$/, '').trim();

  useEffect(() => {
    const ball = ballRef.current;
    if (!ball) return;

    const FIELD_W = 300;
    const FIELD_H = 180;
    const MARGIN = 8;
    const SPEED_BASE = 0.7;

    const p = posRef.current;
    p.vx = (Math.random() > 0.5 ? 1 : -1) * (SPEED_BASE + Math.random() * 0.4);
    p.vy = (Math.random() > 0.5 ? 1 : -1) * (SPEED_BASE * 0.6 + Math.random() * 0.3);

    const step = () => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x <= MARGIN + 5) { p.x = MARGIN + 5; p.vx = Math.abs(p.vx); }
      if (p.x >= FIELD_W - MARGIN - 5) { p.x = FIELD_W - MARGIN - 5; p.vx = -Math.abs(p.vx); }
      if (p.y <= MARGIN + 5) { p.y = MARGIN + 5; p.vy = Math.abs(p.vy); }
      if (p.y >= FIELD_H - MARGIN - 5) { p.y = FIELD_H - MARGIN - 5; p.vy = -Math.abs(p.vy); }

      if (Math.random() < 0.004) {
        p.vx += (Math.random() - 0.5) * 0.4;
        p.vy += (Math.random() - 0.5) * 0.4;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const target = SPEED_BASE + Math.random() * 0.5;
        if (speed > 0) { p.vx = (p.vx / speed) * target; p.vy = (p.vy / speed) * target; }
      }

      ball.setAttribute('cx', String(p.x));
      ball.setAttribute('cy', String(p.y));
      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  const homeShort = clean(homeName).slice(0, 12);
  const awayShort = clean(awayName).slice(0, 12);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none" style={{ minHeight: 180 }}>
      <svg
        viewBox="0 0 300 180"
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a7a1a" />
            <stop offset="50%" stopColor="#1e8c1e" />
            <stop offset="100%" stopColor="#1a7a1a" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="ballShadow">
            <feDropShadow dx="1" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>

        <rect width="300" height="180" fill="url(#pitchGrad)" rx="4" />

        {[20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280].map(x => (
          <line key={x} x1={x} y1="0" x2={x} y2="180" stroke="rgba(255,255,255,0.04)" strokeWidth="10" />
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

        <circle ref={ballRef} cx="150" cy="90" r="5.5" fill="white" stroke="#333" strokeWidth="0.8" filter="url(#ballShadow)" />
        <circle cx="150" cy="90" r="5.5" fill="none" stroke="#666" strokeWidth="0.4"
          strokeDasharray="4 3"
          style={{ pointerEvents: 'none', opacity: 0.6 }}
        />
      </svg>

      <div className="relative z-10 w-full flex items-center justify-between px-3 pointer-events-none" style={{ paddingTop: 8 }}>
        <div className="text-left" style={{ maxWidth: '38%' }}>
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
                <span className="flex h-1.5 w-1.5 ml-0.5">
                  <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                </span>
              </div>
            </>
          ) : (
            <div className="text-white font-black text-xl drop-shadow-lg opacity-80">VS</div>
          )}
        </div>

        <div className="text-right" style={{ maxWidth: '38%' }}>
          <div className="text-white font-bold text-xs md:text-sm leading-tight drop-shadow-lg truncate">{awayShort}</div>
        </div>
      </div>
    </div>
  );
}

export default memo(FootballPitchAnimation);
