import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface WorldCupBannerProps {
  variant?: 'compact' | 'hero';
  disableLink?: boolean;
}

// ── Particles ──────────────────────────────────────────────────────────────
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  x: 5 + (i / 27) * 90 + (Math.sin(i * 2.3) * 6),
  delay: (i * 0.37) % 4.5,
  dur: 3.0 + (i % 7) * 0.45,
  size: 1.5 + (i % 5) * 0.6,
  opacity: 0.45 + (i % 4) * 0.12,
}));

// ── Countdown ──────────────────────────────────────────────────────────────
const KICKOFF = new Date('2026-06-11T18:00:00Z').getTime();

function useCountdown() {
  const [diff, setDiff] = useState(() => Math.max(0, KICKOFF - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setDiff(Math.max(0, KICKOFF - Date.now())), 1000);
    return () => clearInterval(t);
  }, []);
  const totalSeconds = Math.floor(diff / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, started: diff === 0 };
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 38 }}>
      <div
        className="font-black tabular-nums leading-none"
        style={{
          fontSize: 'clamp(16px, 3.5vw, 26px)',
          color: '#ffd040',
          textShadow: '0 0 18px rgba(255,200,40,0.85), 0 2px 8px rgba(0,0,0,0.8)',
          letterSpacing: '-0.02em',
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div
        className="uppercase tracking-widest font-bold"
        style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}
      >
        {label}
      </div>
    </div>
  );
}

function CountdownSep() {
  return (
    <div
      className="font-black self-start pt-[3px]"
      style={{ fontSize: 'clamp(14px,3vw,22px)', color: 'rgba(255,200,60,0.55)', lineHeight: 1 }}
    >
      :
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function WorldCupBanner({ variant = 'compact', disableLink = false }: WorldCupBannerProps) {
  const navigate = useNavigate();
  const wrapRef  = useRef<HTMLDivElement>(null);
  const [shimmer, setShimmer] = useState(false);
  const [trophyPulse, setTrophyPulse] = useState(false);
  const { days, hours, minutes, seconds, started } = useCountdown();

  // Gold shimmer sweep every 3.5 s
  useEffect(() => {
    const t = setInterval(() => setShimmer(s => !s), 3500);
    return () => clearInterval(t);
  }, []);

  // Trophy pulse every 4 s
  useEffect(() => {
    const t = setInterval(() => {
      setTrophyPulse(true);
      setTimeout(() => setTrophyPulse(false), 600);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 12;
    const y = ((e.clientY - rect.top)  / rect.height - 0.5) * -7;
    el.style.transform = `perspective(1600px) rotateX(${y}deg) rotateY(${x}deg) scale(1.022)`;
  }, []);

  const handleLeave = useCallback(() => {
    if (wrapRef.current)
      wrapRef.current.style.transform = 'perspective(1600px) rotateX(0deg) rotateY(0deg) scale(1)';
  }, []);

  const handleClick = useCallback(() => {
    if (!disableLink) navigate('/copa-do-mundo');
  }, [disableLink, navigate]);

  const isHero = variant === 'hero';

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={disableLink ? undefined : handleClick}
      className={`relative w-full overflow-hidden rounded-2xl ${disableLink ? '' : 'cursor-pointer'} select-none`}
      style={{
        transition: 'transform 0.24s cubic-bezier(0.23,1,0.32,1)',
        boxShadow: [
          '0 40px 100px rgba(0,0,0,0.82)',
          '0 8px 32px rgba(212,151,43,0.50)',
          '0 0 0 1px rgba(255,215,120,0.22)',
          'inset 0 0 60px rgba(0,0,0,0.30)',
        ].join(', '),
      }}
    >
      {/* ── Background image ── */}
      <img
        src="/assets/copa-do-mundo-2026.jpeg"
        alt="Copa do Mundo 2026 – BET62"
        draggable={false}
        className="w-full object-cover object-center block"
        style={{ maxHeight: isHero ? 400 : 280 }}
      />

      {/* ── Dark radial vignette ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: [
            'linear-gradient(to top, rgba(3,4,2,0.96) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.10) 100%)',
            'radial-gradient(ellipse 80% 60% at 50% 120%, rgba(180,120,10,0.18) 0%, transparent 70%)',
          ].join(', '),
        }}
      />

      {/* ── Side vignette ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to right, rgba(0,0,0,0.42) 0%, transparent 22%, transparent 78%, rgba(0,0,0,0.42) 100%)',
        }}
      />

      {/* ── Gold top border glow ── */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{
          height: 2,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,215,80,0.50) 15%, rgba(255,225,80,1) 50%, rgba(255,215,80,0.50) 85%, transparent 100%)',
          boxShadow: '0 0 22px 6px rgba(255,200,40,0.60)',
        }}
      />

      {/* ── Gold bottom glow accent ── */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: 1,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,215,80,0.25) 30%, rgba(255,215,80,0.55) 50%, rgba(255,215,80,0.25) 70%, transparent 100%)',
        }}
      />

      {/* ── Shimmer sweep ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.07) 50%, transparent 72%)',
          transform: shimmer ? 'translateX(110%)' : 'translateX(-110%)',
          transition: 'transform 1.4s cubic-bezier(0.4,0,0.2,1)',
          willChange: 'transform',
        }}
      />

      {/* ── Floating gold particles ── */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        {PARTICLES.map((p) => (
          <circle
            key={p.id}
            cx={`${p.x}%`}
            cy="100%"
            r={p.size}
            fill={`rgba(255,210,60,${p.opacity})`}
            style={{ animation: `wcFloat_${p.id} ${p.dur}s ${p.delay}s ease-in-out infinite` }}
          />
        ))}
      </svg>

      {/* ── TOP-LEFT: "Em destaque" badge ── */}
      <div className="absolute left-4 top-4 pointer-events-none">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
          style={{
            background: 'rgba(0,0,0,0.60)',
            border: '1px solid rgba(255,215,80,0.28)',
            color: '#ffd060',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6, height: 6,
              borderRadius: '50%',
              background: '#ffd060',
              animation: 'wcPulse 1.8s ease-in-out infinite',
            }}
          />
          Em destaque
        </div>
      </div>

      {/* ── TOP-RIGHT: gold pulse dot ── */}
      <div
        className="absolute right-4 top-4 pointer-events-none"
        style={{ animation: 'wcPulse 2.6s ease-in-out infinite' }}
      >
        <div
          style={{
            width: 12, height: 12,
            borderRadius: '50%',
            background: 'rgba(255,215,80,0.88)',
            boxShadow: '0 0 12px 5px rgba(255,200,50,0.55)',
          }}
        />
      </div>

      {/* ── CONTENT overlay ── */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-6 pointer-events-none">
        <div className="flex items-end gap-4">

          {/* Trophy */}
          <div
            className="shrink-0 hidden sm:flex items-center justify-center"
            style={{
              fontSize: isHero ? 52 : 40,
              lineHeight: 1,
              transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), filter 0.3s',
              transform: trophyPulse ? 'scale(1.22) translateY(-4px)' : 'scale(1) translateY(0)',
              filter: trophyPulse
                ? 'drop-shadow(0 0 16px rgba(255,200,40,0.95)) drop-shadow(0 0 32px rgba(255,170,0,0.70))'
                : 'drop-shadow(0 0 8px rgba(255,180,40,0.55))',
            }}
          >
            🏆
          </div>

          {/* Text stack */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div
              className="font-black uppercase leading-none tracking-[0.18em]"
              style={{ fontSize: 10, color: 'rgba(255,215,80,0.72)' }}
            >
              FIFA · <span style={{ color: 'rgba(255,255,255,0.45)' }}>EUA · CANADÁ · MÉXICO</span>
            </div>

            <div
              className={`font-black uppercase leading-none tracking-tight ${isHero ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-xl md:text-2xl'}`}
              style={{ color: '#fff', textShadow: '0 2px 20px rgba(0,0,0,0.95)' }}
            >
              Copa do Mundo{' '}
              <span
                style={{
                  color: '#ffd040',
                  textShadow: '0 0 28px rgba(255,200,40,0.90), 0 2px 12px rgba(0,0,0,0.85)',
                }}
              >
                2026
              </span>
            </div>

            <div
              className="font-semibold"
              style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}
            >
              48 selecções · 104 jogos · começa 11 junho
            </div>

            {/* Countdown */}
            {!started && (
              <div className="flex items-center gap-1 pt-0.5">
                <CountdownUnit value={days}    label="dias" />
                <CountdownSep />
                <CountdownUnit value={hours}   label="hrs" />
                <CountdownSep />
                <CountdownUnit value={minutes} label="min" />
                <CountdownSep />
                <CountdownUnit value={seconds} label="seg" />
              </div>
            )}
            {started && (
              <div
                className="text-[11px] font-black uppercase tracking-wide"
                style={{ color: '#4ade80', textShadow: '0 0 12px rgba(74,222,128,0.6)' }}
              >
                🟢 A decorrer agora
              </div>
            )}
          </div>

          {/* CTA button */}
          {!disableLink && (
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); navigate('/copa-do-mundo'); }}
              className="pointer-events-auto shrink-0 flex flex-col items-center gap-1 rounded-2xl px-4 py-3 font-black uppercase tracking-wide transition-all active:scale-95 hover:brightness-110 hover:scale-105"
              style={{
                background: 'linear-gradient(145deg, #f7c820 0%, #e09010 55%, #c07008 100%)',
                color: '#180800',
                boxShadow: [
                  '0 8px 28px rgba(245,192,24,0.65)',
                  '0 2px 0 rgba(255,255,255,0.22) inset',
                  '0 -2px 0 rgba(0,0,0,0.20) inset',
                ].join(', '),
                border: '1px solid rgba(255,240,120,0.35)',
                transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), filter 0.18s, box-shadow 0.18s',
                textShadow: '0 1px 0 rgba(255,255,255,0.25)',
                minWidth: 90,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>🏆</span>
              <span style={{ fontSize: 10, letterSpacing: '0.12em' }}>Aposte Agora</span>
            </button>
          )}
        </div>
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes wcPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:0.30; transform:scale(1.9); }
        }
        ${PARTICLES.map(p => `
          @keyframes wcFloat_${p.id} {
            0%   { transform:translateY(0) scale(1);            opacity:0; }
            12%  { opacity:${p.opacity}; }
            80%  { opacity:${(p.opacity * 0.6).toFixed(2)}; }
            100% { transform:translateY(-${55 + p.size * 10}px) scale(0.55); opacity:0; }
          }
        `).join('')}
      `}</style>
    </div>
  );
}
