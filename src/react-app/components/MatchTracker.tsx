import { useEffect, useMemo, useState } from 'react'
import { abbreviateTeamName } from '@/shared/helpers'
import { Clock, Zap, ArrowUp, ArrowDown } from 'lucide-react'

// --- Types ---
interface MatchTrackerProps {
  darkMode: boolean
  live: any | null
  homeName: string
  awayName: string
  leagueName?: string
  sportName?: string
}

interface GameEvent {
  id: number
  minute: string
  type: 'goal' | 'card' | 'attack' | 'corner' | 'shot'
  team: 'home' | 'away'
  description: string
}

// --- Components ---

const MatchHeader = ({ league, sport, status, darkMode }: { league: string, sport: string, status: string, darkMode: boolean }) => (
  <div className={`flex items-center justify-between px-4 py-3 border-b ${darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium uppercase tracking-wide">{sport} • {league}</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
      </span>
      <span className="text-xs font-bold uppercase text-red-500">{status}</span>
    </div>
  </div>
)

const Scoreboard = ({ home, away, score, time, darkMode }: { home: string, away: string, score: string, time: string, darkMode: boolean }) => {
  const [homeScore, awayScore] = score.split('-').map(s => s.trim())
  
  return (
    <div className={`py-6 px-4 ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between max-w-md mx-auto">
        <div className="flex-1 text-center">
          <h3 className={`text-lg md:text-xl font-bold mb-1 truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{home}</h3>
        </div>
        
        <div className="px-4 flex flex-col items-center">
          <div className={`text-3xl md:text-4xl font-bold tracking-tight mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {homeScore || '0'} - {awayScore || '0'}
          </div>
          <div className={`flex items-center gap-1 text-sm font-mono ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
            <Clock size={14} />
            <span>{time}</span>
          </div>
        </div>

        <div className="flex-1 text-center">
          <h3 className={`text-lg md:text-xl font-bold mb-1 truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{away}</h3>
        </div>
      </div>
    </div>
  )
}

const Field2D = ({ ball, trail, attackSide, darkMode }: { ball: {x: number, y: number}, trail: {x:number, y:number}[], attackSide: 'home' | 'away' | null, darkMode: boolean }) => {
  return (
    <div className={`relative w-full h-48 md:h-56 bg-[#2e7d32] overflow-hidden shadow-inner border-y ${darkMode ? 'border-gray-800' : 'border-black/10'}`}>
      {/* Field Pattern */}
      <div className="absolute inset-0 opacity-20" 
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent 20px, rgba(0,0,0,0.1) 20px, rgba(0,0,0,0.1) 40px)' }} 
      />
      
      {/* Field Lines */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Center Line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/40 -translate-x-1/2" />
        {/* Center Circle */}
        <div className="absolute left-1/2 top-1/2 w-24 h-24 border-2 border-white/40 rounded-full -translate-x-1/2 -translate-y-1/2" />
        {/* Goals Areas */}
        <div className="absolute left-0 top-1/2 w-16 h-32 border-r-2 border-t-2 border-b-2 border-white/40 -translate-y-1/2" />
        <div className="absolute right-0 top-1/2 w-16 h-32 border-l-2 border-t-2 border-b-2 border-white/40 -translate-y-1/2" />
      </div>

      {/* Attack Indicators */}
      {attackSide && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-bold uppercase flex items-center gap-2 transition-all duration-300`}>
          {attackSide === 'home' ? <ArrowDown size={12} className="rotate-90" /> : <ArrowUp size={12} className="rotate-90" />}
          Ataque {attackSide === 'home' ? 'Casa' : 'Fora'}
        </div>
      )}

      {/* Ball Trail */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <polyline 
          points={trail.map(p => `${p.x}%,${p.y}%`).join(' ')} 
          fill="none" 
          stroke="white" 
          strokeWidth="2" 
          strokeDasharray="4 4"
          className="opacity-40"
        />
      </svg>

      {/* Ball */}
      <div 
        className="absolute w-3 h-3 bg-white rounded-full shadow-lg transition-all duration-700 ease-out z-10"
        style={{ left: `${ball.x}%`, top: `${ball.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className="absolute inset-0 rounded-full border border-black/10" />
      </div>
    </div>
  )
}

const Court2D = ({ darkMode }: { darkMode: boolean }) => {
  return (
    <div className={`relative w-full h-48 md:h-56 overflow-hidden shadow-inner border-y ${darkMode ? 'border-gray-800' : 'border-black/10'}`}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #b45309 0%, #d97706 50%, #b45309 100%)' }} />
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.12) 0, rgba(0,0,0,0.12) 2px, transparent 2px, transparent 24px)' }} />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/50 -translate-x-1/2" />
        <div className="absolute left-1/2 top-1/2 w-24 h-24 border-2 border-white/50 rounded-full -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute left-0 top-1/2 w-20 h-32 border-r-2 border-t-2 border-b-2 border-white/50 -translate-y-1/2" />
        <div className="absolute right-0 top-1/2 w-20 h-32 border-l-2 border-t-2 border-b-2 border-white/50 -translate-y-1/2" />
        <div className="absolute left-4 top-1/2 w-10 h-10 border-2 border-white/50 rounded-full -translate-y-1/2" />
        <div className="absolute right-4 top-1/2 w-10 h-10 border-2 border-white/50 rounded-full -translate-y-1/2" />
      </div>
    </div>
  )
}

const Rink2D = ({ darkMode }: { darkMode: boolean }) => {
  return (
    <div className={`relative w-full h-48 md:h-56 overflow-hidden shadow-inner border-y ${darkMode ? 'border-gray-800' : 'border-black/10'}`}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #e5e7eb 0%, #f8fafc 100%)' }} />
      <div className="absolute inset-3 border-2 border-red-500/40 rounded-[28px]" />
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-red-500/40 -translate-x-1/2" />
      <div className="absolute left-1/2 top-1/2 w-24 h-24 border-2 border-blue-500/40 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className={`absolute left-3 top-1/2 w-16 h-24 border-2 rounded-[20px] -translate-y-1/2 ${darkMode ? 'border-blue-500/35' : 'border-blue-500/30'}`} />
      <div className={`absolute right-3 top-1/2 w-16 h-24 border-2 rounded-[20px] -translate-y-1/2 ${darkMode ? 'border-blue-500/35' : 'border-blue-500/30'}`} />
    </div>
  )
}

const MomentumBar = ({ value, darkMode }: { value: number, darkMode: boolean }) => {
  // value 0-100 (50 is neutral, <50 home pressure, >50 away pressure)
  return (
    <div className={`px-4 py-4 border-b ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold uppercase ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Pressão do Jogo</span>
        <Zap size={14} className={darkMode ? 'text-yellow-400' : 'text-yellow-600'} />
      </div>
      <div className="h-4 bg-gray-200 rounded-full overflow-hidden flex relative">
        {/* Center Marker */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white z-10 opacity-50" />
        
        {/* Home Pressure (Left) */}
        <div 
          className="h-full bg-green-500 transition-all duration-1000 ease-out"
          style={{ width: `${Math.max(0, 50 - (value - 50))}%`, marginLeft: '0' }} 
        />
        
        {/* Spacer for neutral zone if needed, effectively simpler to just show split */}
        <div className="flex-1 bg-gray-200 dark:bg-gray-700" />

        {/* Away Pressure (Right) */}
        <div 
          className="h-full bg-blue-500 transition-all duration-1000 ease-out"
          style={{ width: `${Math.max(0, value - 50)}%` }} 
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono opacity-60">
        <span>DOMÍNIO CASA</span>
        <span>DOMÍNIO FORA</span>
      </div>
    </div>
  )
}

const StatRow = ({ label, homeVal, awayVal, darkMode }: { label: string, homeVal: number | string, awayVal: number | string, darkMode: boolean }) => (
  <div className="flex items-center justify-between py-2 border-b border-dashed border-gray-200 dark:border-gray-700 last:border-0">
    <span className={`font-mono font-bold ${Number(homeVal) > Number(awayVal) ? (darkMode ? 'text-white' : 'text-black') : (darkMode ? 'text-gray-400' : 'text-gray-500')}`}>
      {homeVal}
    </span>
    <span className={`text-xs uppercase font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
    <span className={`font-mono font-bold ${Number(awayVal) > Number(homeVal) ? (darkMode ? 'text-white' : 'text-black') : (darkMode ? 'text-gray-400' : 'text-gray-500')}`}>
      {awayVal}
    </span>
  </div>
)

const MatchStats = ({ stats, darkMode }: { stats: any, darkMode: boolean }) => (
  <div className={`px-4 py-4 border-b ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
    <h4 className={`text-xs font-bold uppercase mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Estatísticas</h4>
    <div className="space-y-1">
      <StatRow label="Posse de Bola" homeVal={`${stats.possession.home}%`} awayVal={`${stats.possession.away}%`} darkMode={darkMode} />
      <StatRow label="Remates" homeVal={stats.shots.home} awayVal={stats.shots.away} darkMode={darkMode} />
      <StatRow label="No Alvo" homeVal={stats.onTarget.home} awayVal={stats.onTarget.away} darkMode={darkMode} />
      <StatRow label="Escanteios" homeVal={stats.corners.home} awayVal={stats.corners.away} darkMode={darkMode} />
      <StatRow label="Cartões" homeVal={stats.cards.home} awayVal={stats.cards.away} darkMode={darkMode} />
    </div>
  </div>
)

const TimelineEvent = ({ event, darkMode }: { event: GameEvent, darkMode: boolean }) => {
  const icon = {
    goal: '⚽',
    card: '🟨',
    attack: '🟢',
    corner: '🚩',
    shot: '🚀'
  }[event.type]

  const isHome = event.team === 'home'

  return (
    <div className={`flex items-start gap-3 py-2 animate-in slide-in-from-top-2 fade-in duration-300`}>
      <div className={`w-12 text-right font-mono text-sm font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {event.minute}'
      </div>
      <div className="flex-1">
        <div className={`flex items-center gap-2 ${isHome ? '' : 'flex-row-reverse text-right'}`}>
          <span className="text-lg">{icon}</span>
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {event.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const MatchTimeline = ({ events, darkMode }: { events: GameEvent[], darkMode: boolean }) => (
  <div className={`px-4 py-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
    <h4 className={`text-xs font-bold uppercase mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Eventos do Jogo</h4>
    <div className="relative">
      <div className={`absolute left-[3.2rem] top-2 bottom-2 w-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />
      <div className="space-y-1">
        {events.slice(0, 10).map((ev) => (
          <TimelineEvent key={ev.id} event={ev} darkMode={darkMode} />
        ))}
        {events.length === 0 && (
          <p className={`text-center text-sm py-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Aguardando início do jogo...
          </p>
        )}
      </div>
    </div>
  </div>
)

// --- Main Component ---

export default function MatchTracker({ darkMode, live, homeName, awayName, leagueName = 'Liga Portugal', sportName = 'Futebol' }: MatchTrackerProps) {
  // --- Simulation State (Disabled) ---
  // const [ball, setBall] = useState({ x: 50, y: 50 })
  // const ballRef = useRef({ x: 50, y: 50 }) // Ref for animation loop stability
  // const [trail, setTrail] = useState<{x:number, y:number}[]>([])
  // const [attackSide, setAttackSide] = useState<'home' | 'away' | null>(null)
  // const [pressure, setPressure] = useState(50) // 0-100 (50 neutral)
  
  // Use static default values instead
  const ball = { x: 50, y: 50 };
  const trail: {x:number, y:number}[] = [];
  const attackSide = null;
  const pressure = 50;
  
  const [stats, setStats] = useState({
    possession: { home: 50, away: 50 },
    shots: { home: 0, away: 0 },
    onTarget: { home: 0, away: 0 },
    corners: { home: 0, away: 0 },
    cards: { home: 0, away: 0 }
  })
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([])

  // --- Formatting ---
  const home = useMemo(() => abbreviateTeamName(homeName || 'Casa'), [homeName])
  const away = useMemo(() => abbreviateTeamName(awayName || 'Fora'), [awayName])
  const time = useMemo(() => {
    const timerRaw = String(live?.timer || live?.fixture?.status?.timer || '').trim()
    if (timerRaw) {
      if (timerRaw.includes(':')) return timerRaw
      const n = Number(timerRaw)
      if (Number.isFinite(n) && n >= 0) {
        const mm = String(Math.floor(n)).padStart(2, '0')
        return `${mm}:00`
      }
    }
    const minute = live?.minute
    if (minute != null && minute !== '') return `${minute}'`
    const elapsed = live?.elapsed ?? live?.fixture?.status?.elapsed
    if (typeof elapsed === 'number' && elapsed > 0) return `${elapsed}'`
    return '—'
  }, [live])
  const score = useMemo(() => {
    if (!live) return '0-0';
    if (typeof live.score === 'string') return live.score;
    
    const formatVal = (v: any) => {
        if (typeof v === 'object' && v !== null) return v.total ?? v.score ?? v.current ?? 0;
        return v;
    };
    
    const h = formatVal(live.goals?.home ?? live.score?.home ?? 0);
    const a = formatVal(live.goals?.away ?? live.score?.away ?? 0);
    return `${h}-${a}`;
  }, [live])
  
  const status = useMemo(() => {
    const s = String(live?.fixture?.status?.short || live?.status || '').toUpperCase().trim()
    if (!s) return 'AO VIVO'
    if (s === 'HT' || s === 'INT' || s === 'BT') return 'INTERVALO'
    if (s === 'FT' || s === 'FIN' || s === 'FINAL') return 'FINAL'
    return s
  }, [live])

  // --- Real Data Integration ---
  const hasRealStats = useMemo(() => !!(live?.fixture?.stats && Array.isArray(live.fixture.stats) && live.fixture.stats.length === 2), [live]);
  const hasRealEvents = useMemo(() => !!(live?.fixture?.events && Array.isArray(live.fixture.events)), [live]);

  useEffect(() => {
    if (hasRealStats) {
        const s = live.fixture.stats;
        // Assume index 0 is home, 1 is away (API-Sports usually follows this, but check team id if possible)
        // For simplicity, we assume order matches home/away teams
        const getVal = (teamIdx: number, type: string) => {
            const t = s[teamIdx]?.statistics?.find((x: any) => x.type === type);
            return t ? (typeof t.value === 'number' ? t.value : parseInt(t.value || '0')) : 0;
        };

        setStats({
            possession: { home: getVal(0, 'Ball Possession') || 50, away: getVal(1, 'Ball Possession') || 50 },
            shots: { home: getVal(0, 'Total Shots'), away: getVal(1, 'Total Shots') },
            onTarget: { home: getVal(0, 'Shots on Goal'), away: getVal(1, 'Shots on Goal') },
            corners: { home: getVal(0, 'Corner Kicks'), away: getVal(1, 'Corner Kicks') },
            cards: { home: (getVal(0, 'Yellow Cards') + getVal(0, 'Red Cards')), away: (getVal(1, 'Yellow Cards') + getVal(1, 'Red Cards')) }
        });
    }
  }, [live, hasRealStats]);

  useEffect(() => {
    if (hasRealEvents) {
        const evs = live.fixture.events
          .map((e: any, idx: number) => {
            const teamName = String(e?.team?.name || '').trim();
            const teamId = e?.team?.id;
            const isHome = (teamName && teamName === homeName) || (teamId != null && teamId === live?.fixture?.home?.id);
            const typeMap: any = { Goal: 'goal', Card: 'card', subst: 'substitution' };
            const elapsed = e?.time?.elapsed ?? e?.elapsed ?? null;
            const extra = e?.time?.extra ?? e?.extra ?? null;
            const minute =
              elapsed != null && elapsed !== ''
                ? `${elapsed}${extra ? `+${extra}` : ''}'`
                : '';
            return {
              id: idx,
              minute,
              type: typeMap[e?.type] || 'attack',
              team: isHome ? 'home' : 'away',
              description: `${String(e?.type || '')}${e?.player?.name ? ` - ${e.player.name}` : ''}${e?.detail ? ` ${e.detail}` : ''}`.trim(),
            };
          })
          .reverse(); // Newest first
        setGameEvents(evs);
    }
  }, [live, hasRealEvents, homeName]);

  // --- Simulation Logic (Visuals Only) ---
  // DISABLED BY REQUEST: Prevent fake simulation when no data is available
  /*
  useEffect(() => {
    const active = !!(live && (Number((live as any)?.is_live || 0) === 1 || String((live as any)?.status || '') === 'live' || (live as any)?.isLive === true))
    if (!active) return

    const tick = () => {
      // Move ball using Ref to avoid dependency cycle
      const currentBall = ballRef.current
      const nx = Math.max(5, Math.min(95, currentBall.x + (Math.random() * 20 - 10)))
      const ny = Math.max(5, Math.min(95, currentBall.y + (Math.random() * 14 - 7)))
      
      ballRef.current = { x: nx, y: ny }
      setBall({ x: nx, y: ny })
      setTrail(prev => [...prev.slice(-20), { x: nx, y: ny }])
      
      // Determine attack side
      const side = nx < 40 ? 'home' : nx > 60 ? 'away' : null
      setAttackSide(side)

      // Update Pressure
      setPressure(prev => {
        const target = side === 'home' ? 30 : side === 'away' ? 70 : 50
        return prev + (target - prev) * 0.1
      })

      // Random Events (ONLY IF NO REAL DATA)
      if (!hasRealEvents && Math.random() > 0.95) {
        const typeRoll = Math.random()
        const eventTeam = Math.random() > 0.5 ? 'home' : 'away'
        const teamName = eventTeam === 'home' ? home : away
        const minute = live?.minute || '0'
        
        let newEvent: GameEvent | null = null

        if (typeRoll > 0.9) {
          newEvent = { id: Date.now(), minute, type: 'goal', team: eventTeam, description: `GOL! ${teamName}` }
          // Reset ball to center
          setBall({ x: 50, y: 50 })
          setTrail([])
          setIsGoal(true)
          setTimeout(() => setIsGoal(false), 3000)
        } else if (typeRoll > 0.7) {
          newEvent = { id: Date.now(), minute, type: 'shot', team: eventTeam, description: `Remate de ${teamName}` }
          if (!hasRealStats) {
             setStats(s => ({ ...s, shots: { ...s.shots, [eventTeam]: s.shots[eventTeam] + 1 } }))
          }
        } else if (typeRoll > 0.5) {
          newEvent = { id: Date.now(), minute, type: 'attack', team: eventTeam, description: `Ataque perigoso ${teamName}` }
        }

        if (newEvent) {
          setGameEvents(prev => [newEvent!, ...prev])
        }
      }
    }

    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [live, home, away, hasRealEvents, hasRealStats]) 
  */

  const sportKey = String(sportName || '').toLowerCase()
  const isBasketball = sportKey.includes('basquet') || sportKey.includes('basket')
  const isHockey = sportKey.includes('hóquei') || sportKey.includes('hockey')
  const isSoccer = sportKey.includes('futebol') || sportKey.includes('soccer')

  return (
    <div className={`w-full max-w-2xl mx-auto overflow-hidden rounded-xl shadow-lg relative ${darkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Goal Overlay Removed */}

      <MatchHeader league={leagueName} sport={sportName} status={status} darkMode={darkMode} />
      
      <Scoreboard home={home} away={away} score={score} time={time} darkMode={darkMode} />
      {isBasketball ? (
        <Court2D darkMode={darkMode} />
      ) : isHockey ? (
        <Rink2D darkMode={darkMode} />
      ) : (
        <Field2D ball={ball} trail={trail} attackSide={attackSide} darkMode={darkMode} />
      )}
      
      <MomentumBar value={pressure} darkMode={darkMode} />
      
      {isSoccer ? (
        <MatchStats stats={stats} darkMode={darkMode} />
      ) : (
        <div className={`px-4 py-4 border-b ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h4 className={`text-xs font-bold uppercase mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Estatísticas</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div className={`${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {(live?.fixture?.stats?.[0]?.statistics || []).slice(0, 8).map((s: any, i: number) => (
                <p key={`hs-${i}`}>{String(s.type || '')}: {typeof s.value === 'number' ? s.value : String(s.value ?? '')}</p>
              ))}
            </div>
            <div className={`${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {(live?.fixture?.stats?.[1]?.statistics || []).slice(0, 8).map((s: any, i: number) => (
                <p key={`as-${i}`}>{String(s.type || '')}: {typeof s.value === 'number' ? s.value : String(s.value ?? '')}</p>
              ))}
            </div>
          </div>
        </div>
      )}
      
      <MatchTimeline events={gameEvents} darkMode={darkMode} />
    </div>
  )
}
