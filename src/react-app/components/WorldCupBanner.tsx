import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─────────────────────────────────────────────
   Gold confetti particles (stadium atmosphere)
───────────────────────────────────────────── */
function Confetti() {
  const pieces = Array.from({ length: 26 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 3 + Math.random() * 6,
    duration: 5 + Math.random() * 9,
    delay: Math.random() * 8,
    opacity: 0.25 + Math.random() * 0.5,
    rot: Math.random() * 360,
    gold: Math.random() > 0.4,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: '-16px',
            width: p.size,
            height: p.size * 1.6,
            opacity: p.opacity,
            background: p.gold
              ? 'linear-gradient(135deg,#ffe48a,#d4972b)'
              : 'linear-gradient(135deg,#ff5b6e,#b3122a)',
            transform: `rotate(${p.rot}deg)`,
            borderRadius: 1,
            animation: `wcConfetti ${p.duration}s ${p.delay}s infinite linear`,
          }}
        />
      ))}
    </div>
  );
}

interface WorldCupBannerProps {
  /** Compact = the slim home-page strip, hero = the big page header */
  variant?: 'compact' | 'hero';
}

export default function WorldCupBanner({ variant = 'compact' }: WorldCupBannerProps) {
  const navigate = useNavigate();
  const tiltRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -8;
    el.style.transform = `perspective(1100px) rotateX(${y}deg) rotateY(${x}deg) scale(1.01)`;
  };
  const handleLeave = () => {
    if (tiltRef.current) {
      tiltRef.current.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg) scale(1)';
    }
  };

  const isHero = variant === 'hero';

  return (
    <div
      ref={tiltRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        transition: 'transform 0.2s ease',
        boxShadow:
          '0 18px 50px rgba(0,0,0,0.55), 0 4px 14px rgba(212,151,43,0.25), inset 0 0 0 1px rgba(255,215,120,0.18)',
        background:
          'radial-gradient(120% 120% at 50% -10%, #2a1606 0%, #160a04 45%, #0a0502 100%)',
      }}
    >
      {/* Stadium light beams */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-1/2 left-1/4 w-1/2 h-[200%]"
          style={{
            background:
              'conic-gradient(from 180deg at 50% 0%, transparent 0deg, rgba(255,210,110,0.12) 18deg, transparent 36deg)',
            filter: 'blur(2px)',
            animation: 'wcBeam 7s ease-in-out infinite',
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,200,80,0.18)_0%,transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_85%,rgba(179,18,42,0.22)_0%,transparent_55%)]" />
      </div>

      {/* Pitch glow at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(16,90,40,0.45), transparent)' }}
      />

      <Confetti />

      {/* Shine sweep */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[wcShine_4.5s_ease-in-out_infinite] pointer-events-none" />

      <div
        className={`relative z-10 flex flex-col md:flex-row items-center justify-between gap-4 ${
          isHero ? 'px-6 py-8 md:py-10' : 'px-5 py-5 md:py-6'
        }`}
      >
        {/* Left: text */}
        <div className="text-center md:text-left">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-[10px] md:text-xs font-black tracking-[0.2em] uppercase px-2.5 py-1 rounded-full text-amber-200"
              style={{ background: 'rgba(212,151,43,0.18)', border: '1px solid rgba(255,215,120,0.4)' }}>
              BET62 · FIFA
            </span>
          </div>

          <h2
            className={`font-black leading-[0.92] tracking-tight ${isHero ? 'text-4xl md:text-6xl' : 'text-2xl md:text-4xl'}`}
            style={{
              backgroundImage: 'linear-gradient(180deg,#fff6d8 0%,#ffd874 38%,#d4972b 70%,#9a6512 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 2px 0 rgba(0,0,0,0.25)',
              filter: 'drop-shadow(0 4px 10px rgba(212,151,43,0.45))',
            }}
          >
            COPA DO MUNDO
            <br />
            2026
          </h2>

          <p className={`mt-2 font-bold text-white/90 ${isHero ? 'text-base md:text-lg' : 'text-sm md:text-base'}`}>
            Aposte nos jogos a partir de 11 de junho
          </p>

          {/* Feature chips */}
          <div className="mt-3 flex flex-wrap items-center justify-center md:justify-start gap-2">
            {['⚡ Odds Turbinadas', '🔴 Ao Vivo', '💸 Cash Out'].map((t) => (
              <span
                key={t}
                className="text-[10px] md:text-xs font-bold text-amber-100/90 px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,215,120,0.25)' }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Center: trophy */}
        <div className="relative shrink-0" style={{ animation: 'wcFloat 4.5s ease-in-out infinite' }}>
          <div
            className="absolute inset-0 rounded-full blur-2xl"
            style={{ background: 'radial-gradient(circle,rgba(255,210,110,0.55),transparent 65%)' }}
          />
          <div className={`relative select-none ${isHero ? 'text-[88px] md:text-[120px]' : 'text-[64px] md:text-[84px]'}`}
            style={{ filter: 'drop-shadow(0 12px 18px rgba(0,0,0,0.55))' }}>
            🏆
          </div>
        </div>

        {/* Right: CTA */}
        <button
          type="button"
          onClick={() => navigate('/copa-do-mundo')}
          className={`group relative inline-flex items-center gap-2 rounded-xl font-black uppercase tracking-wider text-[#3a1d00] overflow-hidden active:scale-95 transition-transform ${
            isHero ? 'px-7 py-4 text-base' : 'px-5 py-3 text-sm'
          }`}
          style={{
            backgroundImage: 'linear-gradient(180deg,#ffe9a6 0%,#ffcf57 45%,#d4972b 100%)',
            boxShadow: '0 8px 22px rgba(212,151,43,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
          <span className="relative z-10">Aposte Agora</span>
          <svg className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes wcFloat {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes wcConfetti {
          0% { transform: translateY(-16px) rotate(0deg); }
          100% { transform: translateY(420px) rotate(360deg); }
        }
        @keyframes wcShine {
          0% { transform: translateX(-100%); }
          60%,100% { transform: translateX(100%); }
        }
        @keyframes wcBeam {
          0%,100% { opacity: 0.5; transform: rotate(-4deg); }
          50% { opacity: 1; transform: rotate(4deg); }
        }
      `}</style>
    </div>
  );
}
