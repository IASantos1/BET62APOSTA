import { useEffect, useState } from 'react'

export function Bet62Intro() {
  const alreadySeen = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bet62_intro_seen') === '1';
  const [phase, setPhase] = useState<'in' | 'hold' | 'out' | 'done'>(alreadySeen ? 'done' : 'in')

  useEffect(() => {
    if (alreadySeen) return;
    const t1 = setTimeout(() => setPhase('hold'), 220)
    const t2 = setTimeout(() => setPhase('out'), 1150)
    const t3 = setTimeout(() => { setPhase('done'); sessionStorage.setItem('bet62_intro_seen', '1'); }, 1650)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  if (phase === 'done') return null

  const visible = phase !== 'out'
  const entered = phase === 'hold' || phase === 'out'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'linear-gradient(135deg, #ffffff 0%, #fff7f7 38%, #ffe7e7 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.65s cubic-bezier(0.4,0,0.2,1)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'all' : 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'absolute', top: '-12%', right: '-8%', width: 280, height: 280, borderRadius: '50%', background: 'rgba(200,16,46,0.12)', filter: 'blur(24px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-10%', width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,196,0,0.18)', filter: 'blur(28px)' }} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          transform: entered ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.92)',
          opacity: entered ? 1 : 0,
          transition: 'transform 0.55s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s ease',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'min(86vw, 360px)',
            borderRadius: 32,
            padding: '28px 24px',
            background: 'rgba(255,255,255,0.72)',
            border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 24px 80px rgba(200,16,46,0.12)',
            backdropFilter: 'blur(18px)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'rgba(200,16,46,0.10)',
              animation: 'bet62-ping 1.4s ease-out infinite',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: '84px',
                height: '84px',
                borderRadius: '28px',
                background: 'linear-gradient(135deg, #ff4d4f 0%, #c8102e 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 16px 32px rgba(200,16,46,0.22)',
              }}
            >
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 900,
                  color: '#fff',
                  letterSpacing: '-1px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                B62
              </span>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: '40px',
                  fontWeight: 900,
                  color: '#091227',
                  letterSpacing: '-1.5px',
                  lineHeight: 1,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                BET<span style={{ color: '#C8102E' }}>62</span>
              </div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#6b7280',
                  letterSpacing: '2.8px',
                  textTransform: 'uppercase',
                  marginTop: '6px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                Apostas Desportivas
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: '#8b94a7',
                  marginTop: '10px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                A preparar mercados, odds e destaques em tempo real
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'rgba(200,16,46,0.55)',
                animation: `bet62-bounce 1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes bet62-ping {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes bet62-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.6; }
          50% { transform: translateY(-8px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
