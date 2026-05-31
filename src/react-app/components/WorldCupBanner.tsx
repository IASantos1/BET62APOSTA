import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';

interface WorldCupBannerProps {
  variant?: 'compact' | 'hero';
}

export default function WorldCupBanner({ variant = 'compact' }: WorldCupBannerProps) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 6;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -5;
    el.style.transform = `perspective(1200px) rotateX(${y}deg) rotateY(${x}deg) scale(1.012)`;
  };
  const handleLeave = () => {
    if (wrapRef.current) {
      wrapRef.current.style.transform =
        'perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1)';
    }
  };

  const isHero = variant === 'hero';

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={() => navigate('/copa-do-mundo')}
      className="relative w-full overflow-hidden rounded-2xl cursor-pointer select-none"
      style={{
        transition: 'transform 0.18s ease',
        boxShadow:
          '0 20px 55px rgba(0,0,0,0.6), 0 4px 16px rgba(212,151,43,0.3), inset 0 0 0 1px rgba(255,215,120,0.2)',
      }}
    >
      {/* Main image — fills the banner */}
      <img
        src="/assets/copa-do-mundo-2026.jpeg"
        alt="Copa do Mundo 2026 – BET62"
        draggable={false}
        className={`w-full object-cover object-center ${isHero ? 'max-h-[340px]' : 'max-h-[220px] sm:max-h-[280px] md:max-h-[320px]'}`}
        style={{ display: 'block' }}
      />

      {/* Subtle hover-shine sweep */}
      <div
        className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-100"
        style={{
          background:
            'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)',
          transition: 'opacity 0.3s',
        }}
      />

      {/* Bottom edge glow so it blends with the page */}
      <div
        className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.35), transparent)',
        }}
      />

      {/* Pulse ring on the APOSTE AGORA area (bottom-right) */}
      <span
        className="absolute right-4 bottom-4 pointer-events-none"
        style={{ animation: 'wcPulse 2.4s ease-in-out infinite' }}
      >
        <span
          className="block w-3 h-3 rounded-full"
          style={{ background: 'rgba(255,215,80,0.7)', boxShadow: '0 0 10px 4px rgba(255,200,50,0.4)' }}
        />
      </span>

      <style>{`
        @keyframes wcPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50% { opacity:0.4; transform:scale(1.7); }
        }
      `}</style>
    </div>
  );
}
