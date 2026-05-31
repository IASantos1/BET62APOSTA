import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface WorldCupBannerProps {
  variant?: 'compact' | 'hero';
  disableLink?: boolean;
}

const PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  delay: Math.random() * 3,
  dur: 2.5 + Math.random() * 2.5,
  size: 2 + Math.random() * 3,
}));

export default function WorldCupBanner({ variant = 'compact', disableLink = false }: WorldCupBannerProps) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [shimmer, setShimmer] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setShimmer(s => !s), 3200);
    return () => clearInterval(t);
  }, []);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -6;
    el.style.transform = `perspective(1400px) rotateX(${y}deg) rotateY(${x}deg) scale(1.018)`;
  };

  const handleLeave = () => {
    if (wrapRef.current) {
      wrapRef.current.style.transform = 'perspective(1400px) rotateX(0deg) rotateY(0deg) scale(1)';
    }
  };

  const handleClick = () => {
    if (!disableLink) navigate('/copa-do-mundo');
  };

  const isHero = variant === 'hero';

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={disableLink ? undefined : handleClick}
      className={`relative w-full overflow-hidden rounded-2xl ${disableLink ? '' : 'cursor-pointer'} select-none`}
      style={{
        transition: 'transform 0.22s cubic-bezier(0.23,1,0.32,1)',
        boxShadow:
          '0 32px 80px rgba(0,0,0,0.75), 0 6px 28px rgba(212,151,43,0.45), inset 0 0 0 1px rgba(255,215,120,0.28)',
      }}
    >
      {/* Background image */}
      <img
        src="/assets/copa-do-mundo-2026.jpeg"
        alt="Copa do Mundo 2026 – BET62"
        draggable={false}
        className={`w-full object-cover object-center ${isHero ? 'max-h-[360px]' : 'max-h-[200px] sm:max-h-[260px] md:max-h-[310px]'}`}
        style={{ display: 'block' }}
      />

      {/* Dark overlay gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.50) 40%, rgba(0,0,0,0.08) 100%)',
        }}
      />

      {/* Side vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to right, rgba(0,0,0,0.35) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      {/* Gold top line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,215,80,0.6) 20%, rgba(255,215,80,1) 50%, rgba(255,215,80,0.6) 80%, transparent 100%)',
          boxShadow: '0 0 16px 4px rgba(255,200,40,0.55)',
        }}
      />

      {/* Gold shimmer sweep */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)',
          transform: shimmer ? 'translateX(100%)' : 'translateX(-100%)',
          transition: 'transform 1.2s ease-in-out',
          willChange: 'transform',
        }}
      />

      {/* Hover shimmer */}
      <div
        className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-100"
        style={{
          background:
            'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.05) 50%, transparent 62%)',
          transition: 'opacity 0.35s',
        }}
      />

      {/* Floating particles */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: 'visible' }}
      >
        {PARTICLES.map((p) => (
          <circle
            key={p.id}
            cx={`${p.x}%`}
            cy="100%"
            r={p.size}
            fill="rgba(255,210,60,0.65)"
            style={{
              animation: `wcFloat_${p.id} ${p.dur}s ${p.delay}s ease-in-out infinite`,
            }}
          />
        ))}
      </svg>

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-4 flex items-end justify-between pointer-events-none">
        <div className="space-y-1">
          <div
            className="text-[10px] font-black uppercase tracking-[0.24em] leading-none"
            style={{ color: 'rgba(255,215,80,0.80)' }}
          >
            FIFA ·{' '}
            <span className="text-white/55">EUA · CANADÁ · MÉXICO</span>
          </div>

          <div
            className={`font-black uppercase leading-none tracking-tight ${isHero ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-lg md:text-2xl'}`}
            style={{ color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.9)' }}
          >
            Copa do Mundo{' '}
            <span
              style={{
                color: '#ffd040',
                textShadow: '0 0 24px rgba(255,200,40,0.85), 0 2px 10px rgba(0,0,0,0.8)',
              }}
            >
              2026
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
              48 selecções · 104 jogos · começa 11 junho
            </span>
          </div>
        </div>

        {!disableLink && (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); navigate('/copa-do-mundo'); }}
            className="pointer-events-auto shrink-0 ml-3 flex items-center gap-2 rounded-xl px-4 py-2.5 font-black uppercase text-[11px] tracking-wide transition-all active:scale-95 hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, #f5c018 0%, #d4890a 100%)',
              color: '#1a0800',
              boxShadow: '0 6px 22px rgba(245,192,24,0.60), inset 0 1px 0 rgba(255,255,255,0.30)',
              border: '1px solid rgba(255,235,100,0.45)',
            }}
          >
            <span style={{ fontSize: '14px' }}>🏆</span>
            <span>Aposte Agora</span>
          </button>
        )}
      </div>

      {/* Live pulse dot */}
      <div
        className="absolute right-4 top-4 pointer-events-none"
        style={{ animation: 'wcPulse 2.6s ease-in-out infinite' }}
      >
        <div
          className="w-3 h-3 rounded-full"
          style={{
            background: 'rgba(255,215,80,0.90)',
            boxShadow: '0 0 10px 4px rgba(255,200,50,0.55)',
          }}
        />
      </div>

      {/* "AO VIVO" badge (top-left) */}
      <div className="absolute left-4 top-4 pointer-events-none">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,215,80,0.30)',
            color: '#ffd060',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span style={{ animation: 'wcPulse 1.8s ease-in-out infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ffd060' }} />
          Em destaque
        </div>
      </div>

      <style>{`
        @keyframes wcPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50% { opacity:0.35; transform:scale(1.85); }
        }
        ${PARTICLES.map(p => `
          @keyframes wcFloat_${p.id} {
            0%   { transform: translateY(0) scale(1);   opacity: 0; }
            15%  { opacity: 0.8; }
            80%  { opacity: 0.5; }
            100% { transform: translateY(-${60 + p.size * 8}px) scale(0.6); opacity: 0; }
          }
        `).join('')}
      `}</style>
    </div>
  );
}
