import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface WorldCupBannerProps {
  variant?: 'compact' | 'hero';
  disableLink?: boolean;
}

// ── Stable particle definitions (no random on render) ─────────────────────
const PARTICLES = Array.from({ length: 36 }, (_, i) => ({
  id: i,
  x: 2 + (i / 35) * 96 + Math.sin(i * 1.7) * 5,
  delay: (i * 0.29) % 5.5,
  dur: 4.5 + (i % 8) * 0.5,
  size: 1.2 + (i % 6) * 0.55,
  opacity: 0.30 + (i % 5) * 0.14,
  color: i % 3 === 0 ? 'rgba(255,220,40,' : i % 3 === 1 ? 'rgba(255,255,120,' : 'rgba(255,180,20,',
}));

// ── Floodlight rays ────────────────────────────────────────────────────────
const RAYS = [
  { x: 8,  rotate: 18,  opacity: 0.10, width: 60, delay: 0 },
  { x: 22, rotate: 10,  opacity: 0.07, width: 40, delay: 0.8 },
  { x: 78, rotate: -12, opacity: 0.10, width: 60, delay: 0.4 },
  { x: 92, rotate: -8,  opacity: 0.07, width: 40, delay: 1.2 },
];

// ── Countdown ──────────────────────────────────────────────────────────────
const KICKOFF = new Date('2026-06-11T18:00:00Z').getTime();

function useCountdown() {
  const [diff, setDiff] = useState(() => Math.max(0, KICKOFF - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setDiff(Math.max(0, KICKOFF - Date.now())), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.floor(diff / 1000);
  return {
    days:    Math.floor(total / 86400),
    hours:   Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    started: diff === 0,
  };
}

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 34 }}>
      <div
        className="font-black tabular-nums leading-none"
        style={{
          fontSize: 'clamp(15px, 3.2vw, 24px)',
          background: 'linear-gradient(180deg, #fff5c0 0%, #ffd040 60%, #e09000 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: 'none',
          filter: 'drop-shadow(0 0 10px rgba(255,200,40,0.8))',
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.38)', letterSpacing: '0.14em', marginTop: 2, textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}

function CountSep() {
  return (
    <div
      className="self-start font-black"
      style={{ fontSize: 'clamp(13px, 2.8vw, 20px)', color: 'rgba(255,200,50,0.45)', paddingTop: 2, lineHeight: 1 }}
    >
      :
    </div>
  );
}

// ── Rotating trophy SVG ───────────────────────────────────────────────────
function TrophySvg({ size = 56, pulse = false }: { size?: number; pulse?: boolean }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 56 56"
      style={{
        filter: pulse
          ? 'drop-shadow(0 0 22px rgba(255,200,40,1)) drop-shadow(0 0 44px rgba(255,160,0,0.7))'
          : 'drop-shadow(0 0 10px rgba(255,185,30,0.6)) drop-shadow(0 0 20px rgba(255,140,0,0.35))',
        transform: pulse ? 'scale(1.18) translateY(-4px)' : 'scale(1) translateY(0)',
        transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), filter 0.35s',
        animation: 'wcTrophyFloat 3.8s ease-in-out infinite',
      }}
    >
      {/* Cup body */}
      <path d="M18 8 L38 8 L36 28 Q28 34 20 28 Z" fill="url(#tg1)" />
      {/* Handles */}
      <path d="M18 10 Q8 12 10 22 Q12 28 20 26" fill="none" stroke="url(#tg2)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M38 10 Q48 12 46 22 Q44 28 36 26" fill="none" stroke="url(#tg2)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Stem */}
      <rect x="25" y="28" width="6" height="10" fill="url(#tg1)" rx="1" />
      {/* Base */}
      <rect x="19" y="38" width="18" height="4" fill="url(#tg1)" rx="2" />
      {/* Base foot */}
      <rect x="16" y="42" width="24" height="3" fill="url(#tg3)" rx="1.5" />
      {/* Star */}
      <path d="M28 13 L29 16 L32 16 L30 18 L31 21 L28 19 L25 21 L26 18 L24 16 L27 16 Z" fill="rgba(255,255,255,0.55)" />
      <defs>
        <linearGradient id="tg1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff5a0" />
          <stop offset="40%" stopColor="#ffd040" />
          <stop offset="100%" stopColor="#b07010" />
        </linearGradient>
        <linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd060" />
          <stop offset="100%" stopColor="#c08020" />
        </linearGradient>
        <linearGradient id="tg3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c08010" />
          <stop offset="50%" stopColor="#ffd040" />
          <stop offset="100%" stopColor="#c08010" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Main banner ───────────────────────────────────────────────────────────
export default function WorldCupBanner({ variant = 'compact', disableLink = false }: WorldCupBannerProps) {
  const navigate  = useNavigate();
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [shimmer, setShimmer]       = useState(false);
  const [trophyPulse, setTrophyPulse] = useState(false);
  const { days, hours, minutes, seconds, started } = useCountdown();

  const isHero = variant === 'hero';
  const height = isHero ? 420 : 260;

  // Shimmer sweep every 3 s
  useEffect(() => {
    const t = setInterval(() => setShimmer(s => !s), 3000);
    return () => clearInterval(t);
  }, []);

  // Trophy pulse every 4 s
  useEffect(() => {
    const t = setInterval(() => {
      setTrophyPulse(true);
      setTimeout(() => setTrophyPulse(false), 700);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // 3-D tilt on mouse
  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 14;
    const y = ((e.clientY - rect.top)  / rect.height - 0.5) * -8;
    el.style.transform = `perspective(1400px) rotateX(${y}deg) rotateY(${x}deg) scale(1.025)`;
  }, []);

  const handleLeave = useCallback(() => {
    if (wrapRef.current)
      wrapRef.current.style.transform = 'perspective(1400px) rotateX(0deg) rotateY(0deg) scale(1)';
  }, []);

  const handleClick = useCallback(() => {
    if (!disableLink) navigate('/copa-do-mundo');
  }, [disableLink, navigate]);

  const particleStyles = useMemo(() =>
    PARTICLES.map(p =>
      `@keyframes wcP${p.id}{0%{transform:translateY(0) scale(1);opacity:0}12%{opacity:${p.opacity}}82%{opacity:${(p.opacity*0.5).toFixed(2)}}100%{transform:translateY(-${52+p.size*12}px) scale(0.5);opacity:0}}`
    ).join(''),
  []);

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={disableLink ? undefined : handleClick}
      className={`relative w-full overflow-hidden rounded-2xl ${disableLink ? '' : 'cursor-pointer'} select-none`}
      style={{
        height,
        background: [
          'linear-gradient(170deg, #020d02 0%, #04180a 22%, #071e0c 38%, #0a1a04 55%, #07100a 72%, #040a08 88%, #020702 100%)',
        ].join(', '),
        boxShadow: [
          '0 32px 80px rgba(0,0,0,0.90)',
          '0 0 0 1px rgba(255,215,80,0.18)',
          '0 6px 24px rgba(180,130,10,0.40)',
          'inset 0 0 80px rgba(0,0,0,0.50)',
          'inset 0 1px 0 rgba(255,230,100,0.12)',
        ].join(', '),
        transition: 'transform 0.22s cubic-bezier(0.23,1,0.32,1)',
      }}
    >
      {/* ── Stadium pitch lines (perspective grid) ── */}
      <svg
        className="absolute inset-0 w-full pointer-events-none"
        style={{ height, opacity: 0.13 }}
        viewBox={`0 0 900 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Pitch outline */}
        <rect x="80" y="30" width="740" height={height - 60} rx="4" fill="none" stroke="#4ade80" strokeWidth="1.5" />
        {/* Centre circle */}
        <circle cx="450" cy={height / 2} r="70" fill="none" stroke="#4ade80" strokeWidth="1.2" />
        {/* Centre spot */}
        <circle cx="450" cy={height / 2} r="4" fill="#4ade80" opacity="0.5" />
        {/* Halfway line */}
        <line x1="450" y1="30" x2="450" y2={height - 30} stroke="#4ade80" strokeWidth="1.2" />
        {/* Left penalty box */}
        <rect x="80" y={height/2 - 55} width="120" height="110" fill="none" stroke="#4ade80" strokeWidth="1" />
        <rect x="80" y={height/2 - 28} width="48" height="56" fill="none" stroke="#4ade80" strokeWidth="0.8" />
        {/* Right penalty box */}
        <rect x="700" y={height/2 - 55} width="120" height="110" fill="none" stroke="#4ade80" strokeWidth="1" />
        <rect x="772" y={height/2 - 28} width="48" height="56" fill="none" stroke="#4ade80" strokeWidth="0.8" />
        {/* Corner arcs */}
        <path d="M80,30 Q92,30 92,42" fill="none" stroke="#4ade80" strokeWidth="0.8" />
        <path d="M820,30 Q808,30 808,42" fill="none" stroke="#4ade80" strokeWidth="0.8" />
        <path d={`M80,${height-30} Q92,${height-30} 92,${height-42}`} fill="none" stroke="#4ade80" strokeWidth="0.8" />
        <path d={`M820,${height-30} Q808,${height-30} 808,${height-42}`} fill="none" stroke="#4ade80" strokeWidth="0.8" />
      </svg>

      {/* ── Floodlight rays (top corners) ── */}
      {RAYS.map((r, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${r.x}%`,
            top: 0,
            width: r.width,
            height: '100%',
            background: 'linear-gradient(180deg, rgba(255,248,200,0.18) 0%, rgba(255,240,150,0.04) 40%, transparent 80%)',
            transform: `rotate(${r.rotate}deg)`,
            transformOrigin: 'top center',
            opacity: r.opacity,
            animation: `wcRay ${2.5 + i * 0.6}s ${r.delay}s ease-in-out infinite alternate`,
          }}
        />
      ))}

      {/* ── Deep vignette overlay ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: [
            'radial-gradient(ellipse 90% 70% at 50% 50%, transparent 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.75) 100%)',
            'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.15) 100%)',
            'linear-gradient(to right, rgba(0,0,0,0.50) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.50) 100%)',
          ].join(', '),
        }}
      />

      {/* ── Gold top border ── */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{
          height: 2,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,215,80,0.35) 10%, rgba(255,235,80,1) 50%, rgba(255,215,80,0.35) 90%, transparent 100%)',
          boxShadow: '0 0 28px 8px rgba(255,200,30,0.55)',
        }}
      />

      {/* ── Gold bottom glow ── */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: 60,
          background: 'linear-gradient(to top, rgba(180,110,0,0.18) 0%, transparent 100%)',
        }}
      />

      {/* ── Shimmer sweep ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(112deg, transparent 25%, rgba(255,255,255,0.055) 50%, transparent 75%)',
          transform: shimmer ? 'translateX(115%)' : 'translateX(-115%)',
          transition: 'transform 1.5s cubic-bezier(0.4,0,0.2,1)',
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
            fill={`${p.color}${p.opacity})`}
            style={{ animation: `wcP${p.id} ${p.dur}s ${p.delay}s ease-in-out infinite` }}
          />
        ))}
      </svg>

      {/* ── TOP-LEFT badge ── */}
      <div className="absolute left-4 top-4 pointer-events-none z-10">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-black uppercase"
          style={{
            fontSize: 9,
            letterSpacing: '0.16em',
            background: 'rgba(0,0,0,0.65)',
            border: '1px solid rgba(255,215,80,0.32)',
            color: '#ffd060',
            backdropFilter: 'blur(10px)',
          }}
        >
          <span
            style={{
              display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
              background: '#ffd060', animation: 'wcPulse 1.8s ease-in-out infinite',
            }}
          />
          Em Destaque
        </div>
      </div>

      {/* ── TOP-RIGHT: flags row ── */}
      <div className="absolute right-4 top-4 pointer-events-none z-10 flex items-center gap-1">
        {['🇺🇸','🇨🇦','🇲🇽'].map((f, i) => (
          <span key={i} style={{ fontSize: 14, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.7))' }}>{f}</span>
        ))}
      </div>

      {/* ── CENTER: Trophy (hero only) ── */}
      {isHero && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          style={{ paddingBottom: 80 }}
        >
          <TrophySvg size={96} pulse={trophyPulse} />
        </div>
      )}

      {/* ── BOTTOM: content overlay ── */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-8 z-10 pointer-events-none">
        <div className="flex items-end gap-4">

          {/* Trophy — compact */}
          {!isHero && (
            <div className="shrink-0 hidden sm:block">
              <TrophySvg size={isHero ? 64 : 52} pulse={trophyPulse} />
            </div>
          )}

          {/* Text stack */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Eyebrow */}
            <div
              className="font-black uppercase tracking-[0.20em]"
              style={{ fontSize: 9, color: 'rgba(255,215,80,0.65)' }}
            >
              FIFA · EUA · CANADÁ · MÉXICO
            </div>

            {/* Main title */}
            <div
              className={`font-black uppercase leading-tight tracking-tight ${isHero ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-xl md:text-2xl'}`}
              style={{
                background: 'linear-gradient(90deg, #fff8d0 0%, #ffd040 40%, #ffb020 70%, #ffd040 100%)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                animation: 'wcShimmerText 3s linear infinite',
                filter: 'drop-shadow(0 2px 12px rgba(255,180,30,0.45))',
              }}
            >
              Copa do Mundo 2026
            </div>

            {/* Subtitle */}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>
              48 selecções · 104 jogos · 11 jun – 19 jul · 16 cidades
            </div>

            {/* Countdown */}
            {!started ? (
              <div className="flex items-center gap-1.5 pt-1">
                <CountUnit value={days}    label="dias" />
                <CountSep />
                <CountUnit value={hours}   label="hrs" />
                <CountSep />
                <CountUnit value={minutes} label="min" />
                <CountSep />
                <CountUnit value={seconds} label="seg" />
              </div>
            ) : (
              <div
                className="text-[11px] font-black uppercase tracking-wide"
                style={{ color: '#4ade80', textShadow: '0 0 14px rgba(74,222,128,0.7)' }}
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
              className="pointer-events-auto shrink-0 flex flex-col items-center gap-1.5 rounded-2xl transition-all active:scale-95"
              style={{
                background: 'linear-gradient(145deg, #fff5a0 0%, #ffd020 30%, #e09010 65%, #c07000 100%)',
                color: '#120800',
                fontWeight: 900,
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '10px 18px',
                minWidth: 96,
                boxShadow: [
                  '0 0 0 1px rgba(255,240,120,0.40)',
                  '0 8px 32px rgba(245,192,20,0.70)',
                  '0 2px 0 rgba(255,255,255,0.28) inset',
                  '0 -2px 0 rgba(0,0,0,0.22) inset',
                ].join(', '),
                transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), filter 0.18s, box-shadow 0.18s',
                textShadow: '0 1px 0 rgba(255,255,255,0.30)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1.08) translateY(-2px)';
                (e.currentTarget as HTMLElement).style.filter = 'brightness(1.12)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1) translateY(0)';
                (e.currentTarget as HTMLElement).style.filter = 'brightness(1)';
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }}>🏆</span>
              <span>Aposte Agora</span>
            </button>
          )}
        </div>
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes wcPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:0.28; transform:scale(2); }
        }
        @keyframes wcTrophyFloat {
          0%,100% { transform:translateY(0px); }
          50%      { transform:translateY(-10px); }
        }
        @keyframes wcRay {
          0%   { opacity:0.04; }
          100% { opacity:0.14; }
        }
        @keyframes wcShimmerText {
          0%   { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        ${particleStyles}
      `}</style>
    </div>
  );
}
