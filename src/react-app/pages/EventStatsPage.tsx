import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '@/react-app/contexts/AppContext'
import { BetSlip } from '@/react-app/components/BetSlip'
import LiveMomentumSticksGraph from '@/react-app/components/LiveMomentumSticksGraph'
import { Sidebar } from '@/react-app/components/Sidebar'
import { useLiveFeed } from '@/react-app/hooks/useLiveFeed'
import { useMergedEvents } from '@/react-app/hooks/useMergedEvents'
import { useSportsEvents } from '@/react-app/hooks/useSportsEvents'
import { useTopLeagues } from '@/react-app/hooks/useTopLeagues'
import { useUpcomingCache } from '@/react-app/hooks/useUpcomingCache'
import { apiFetch } from '@/react-app/utils/api'
import type { Event } from '@/shared/types'

const toNum = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value).replace('%', '').replace(',', '.').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function formatPercent(value: number) {
  return `${Math.round(clamp(value, 0, 100))}%`
}

function formatOdd(probability: number | null) {
  if (probability == null || probability <= 0) return '--'
  return (100 / probability).toFixed(2)
}

function extractStatPair(rawStats: any, groupedStats: any[] | null, matchers: RegExp[]): { home: number; away: number } | null {
  if (Array.isArray(groupedStats)) {
    for (const period of groupedStats) {
      const groups = Array.isArray(period?.groups) ? period.groups : []
      for (const group of groups) {
        const items = Array.isArray(group?.statisticsItems) ? group.statisticsItems : []
        for (const item of items) {
          const label = String(item?.name || item?.key || item?.type || '').toLowerCase()
          if (!matchers.some((regex) => regex.test(label))) continue
          const home = toNum(item?.homeValue ?? item?.home ?? item?.local)
          const away = toNum(item?.awayValue ?? item?.away ?? item?.visitor)
          if (home != null && away != null) return { home, away }
        }
      }
    }
  }

  if (Array.isArray(rawStats)) {
    if (
      rawStats.length >= 2 &&
      rawStats.some((entry: any) => Array.isArray(entry?.statistics)) &&
      rawStats[0]?.team &&
      rawStats[1]?.team
    ) {
      const homeStats = rawStats[0]?.statistics || []
      const awayStats = rawStats[1]?.statistics || []
      for (const matcher of matchers) {
        const homeItem = homeStats.find((item: any) => matcher.test(String(item?.type || item?.name || '').toLowerCase()))
        const awayItem = awayStats.find((item: any) => matcher.test(String(item?.type || item?.name || '').toLowerCase()))
        const home = toNum(homeItem?.value)
        const away = toNum(awayItem?.value)
        if (home != null && away != null) return { home, away }
      }
    }

    for (const matcher of matchers) {
      const homeItem = rawStats.find((item: any) => matcher.test(String(item?.type || item?.name || '').toLowerCase()) && String(item?.team?.name || item?.team?.id || '').toLowerCase().includes('home'))
      const awayItem = rawStats.find((item: any) => matcher.test(String(item?.type || item?.name || '').toLowerCase()) && String(item?.team?.name || item?.team?.id || '').toLowerCase().includes('away'))
      const home = toNum(homeItem?.value)
      const away = toNum(awayItem?.value)
      if (home != null && away != null) return { home, away }
    }
  }

  return null
}

function computeH2HSummary(h2hData: any[], homeTeam: string, awayTeam: string) {
  return h2hData.reduce(
    (acc, match) => {
      const rawHome = String(match?.homeTeam || match?.home_team || '').toLowerCase()
      const rawAway = String(match?.awayTeam || match?.away_team || '').toLowerCase()
      const homeScore = Number(match?.homeScore ?? String(match?.score || '0-0').split('-')[0] ?? 0)
      const awayScore = Number(match?.awayScore ?? String(match?.score || '0-0').split('-')[1] ?? 0)

      const isSameOrientation =
        rawHome.includes(homeTeam.toLowerCase()) && rawAway.includes(awayTeam.toLowerCase())
      const isInvertedOrientation =
        rawHome.includes(awayTeam.toLowerCase()) && rawAway.includes(homeTeam.toLowerCase())

      if (homeScore === awayScore) {
        acc.draws += 1
      } else if ((isSameOrientation && homeScore > awayScore) || (isInvertedOrientation && awayScore > homeScore)) {
        acc.homeWins += 1
      } else if ((isSameOrientation && awayScore > homeScore) || (isInvertedOrientation && homeScore > awayScore)) {
        acc.awayWins += 1
      }

      const totalGoals = homeScore + awayScore
      if (totalGoals > 1.5) acc.over15 += 1
      if (totalGoals > 2.5) acc.over25 += 1
      if (homeScore > 0 && awayScore > 0) acc.btts += 1
      acc.totalGoals += totalGoals
      acc.matches += 1
      return acc
    },
    { homeWins: 0, awayWins: 0, draws: 0, over15: 0, over25: 0, btts: 0, totalGoals: 0, matches: 0 }
  )
}

function computeProbabilitiesFromOdds(homeOdd: number, drawOdd: number, awayOdd: number) {
  const raw = [
    homeOdd > 1.01 ? 1 / homeOdd : 0,
    drawOdd > 1.01 ? 1 / drawOdd : 0,
    awayOdd > 1.01 ? 1 / awayOdd : 0,
  ]
  const total = raw.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  return {
    home: (raw[0] / total) * 100,
    draw: (raw[1] / total) * 100,
    away: (raw[2] / total) * 100,
  }
}

function computeProbabilitiesFromH2H(summary: ReturnType<typeof computeH2HSummary>) {
  if (!summary.matches) return { home: 34, draw: 33, away: 33 }
  return {
    home: (summary.homeWins / summary.matches) * 100,
    draw: (summary.draws / summary.matches) * 100,
    away: (summary.awayWins / summary.matches) * 100,
  }
}

function CircularProbabilityCard({
  label,
  percentage,
  odd,
  color,
  darkMode,
}: {
  label: string
  percentage: number
  odd: string
  color: string
  darkMode: boolean
}) {
  const value = clamp(percentage, 0, 100)
  const circumference = 2 * Math.PI * 34
  const dashOffset = circumference - (value / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
          <circle cx="50" cy="50" r="34" fill="none" stroke={darkMode ? '#202432' : '#d1d5db'} strokeWidth="10" />
          <circle
            cx="50"
            cy="50"
            r="34"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-black">
          {formatPercent(value)}
        </div>
      </div>
      <div className={`mt-3 text-lg font-black text-center ${darkMode ? 'text-white' : 'text-gray-900'}`}>{label}</div>
      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>odd {odd}</div>
    </div>
  )
}

function MarketRow({
  label,
  percent,
  trailing,
  fillColor,
  darkMode,
}: {
  label: string
  percent: number
  trailing: string
  fillColor: string
  darkMode: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className={`text-lg ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{label}</span>
        <div className="flex items-center gap-3">
          <span className={`text-xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>{formatPercent(percent)}</span>
          <span className={`rounded-2xl px-3 py-1 text-base font-bold ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{trailing}</span>
        </div>
      </div>
      <div className={`h-3 overflow-hidden rounded-full ${darkMode ? 'bg-[#202432]' : 'bg-gray-200'}`}>
        <div className="h-full rounded-full" style={{ width: `${clamp(percent, 0, 100)}%`, background: fillColor }} />
      </div>
    </div>
  )
}

function SnapshotCard({
  value,
  label,
  subLabel,
  darkMode,
}: {
  value: string
  label: string
  subLabel: string
  darkMode: boolean
}) {
  return (
    <div className={`rounded-3xl border px-4 py-6 text-center ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
      <div className="text-5xl font-black text-[#ff5b6b]">{value}</div>
      <div className={`mt-2 text-2xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>{label}</div>
      <div className={`mt-1 text-lg ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{subLabel}</div>
    </div>
  )
}

function DetailedStatRow({
  label,
  homeValue,
  awayValue,
  isPercent,
  darkMode,
}: {
  label: string
  homeValue: number
  awayValue: number
  isPercent?: boolean
  darkMode: boolean
}) {
  const total = homeValue + awayValue
  const homeWidth = total > 0 ? (homeValue / total) * 100 : 50

  return (
    <div className={`rounded-3xl border px-4 py-4 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-2xl font-black text-blue-500">{isPercent ? `${homeValue}%` : homeValue}</span>
        <span className={`text-center text-[11px] font-black uppercase tracking-[0.2em] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
        <span className="text-2xl font-black text-red-500">{isPercent ? `${awayValue}%` : awayValue}</span>
      </div>
      <div className={`flex h-2 overflow-hidden rounded-full ${darkMode ? 'bg-[#202432]' : 'bg-gray-200'}`}>
        <div className="bg-blue-500" style={{ width: `${homeWidth}%` }} />
        <div className="bg-red-500" style={{ width: `${100 - homeWidth}%` }} />
      </div>
    </div>
  )
}

export default function EventStatsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { darkMode, selectedCategory, showMobileSidebar, setShowMobileSidebar } = useApp()
  const [event, setEvent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveStats, setLiveStats] = useState<{ stats: any; groupedStats: any[] | null; events: any[] }>({ stats: [], groupedStats: null, events: [] })
  const [h2hData, setH2hData] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'probability' | 'stats' | 'h2h'>('probability')

  const { live, pregame, loading: eventsLoading } = useSportsEvents(selectedCategory || null)
  const { upcomingEvents } = useUpcomingCache(pregame)
  const { liveEvents: wsLiveEvents } = useLiveFeed(selectedCategory || 'all')
  const mergedSidebarLive = useMergedEvents(live, wsLiveEvents)
  const activeTopLeagues = useTopLeagues(mergedSidebarLive, upcomingEvents)

  const localEventsReady = !eventsLoading && (live.length > 0 || pregame.length > 0 || upcomingEvents.length > 0)

  const localFoundEvent = useMemo(() => {
    if (!id) return null
    const all = [...live, ...pregame, ...upcomingEvents]
    return (
      all.find(
        (e: any) => String(e.id) === String(id) || String(e.external_event_id) === String(id)
      ) || null
    )
  }, [id, live, pregame, upcomingEvents])

  useEffect(() => {
    if (localFoundEvent) {
      setEvent(localFoundEvent)
      setLoading(false)
      setError(null)
    }
  }, [localFoundEvent])

  const mergedEventList = useMergedEvents(event ? [event] : [], wsLiveEvents)

  const displayEvent = useMemo(() => {
    if (!event) return null
    return (
      mergedEventList.find(
        (e: any) =>
          String(e.id) === String(event.id) ||
          String(e.external_event_id) === String(event.id) ||
          String(e.fixture?.id) === String(event.id)
      ) || event
    )
  }, [mergedEventList, event])

  const cleanTeam = useCallback((name: string) => String(name || '').replace(/\sU\d+$/, '').trim(), [])

  const parseGoals = useCallback((goals: any) => {
    if (!goals) return { home: 0, away: 0 }
    if (typeof goals === 'string') {
      try {
        const p = JSON.parse(goals)
        return { home: Number(p.home || 0), away: Number(p.away || 0) }
      } catch {
        return { home: 0, away: 0 }
      }
    }
    return { home: Number(goals.home || 0), away: Number(goals.away || 0) }
  }, [])

  useEffect(() => {
    if (!id) return
    if (localFoundEvent) return
    if (!localEventsReady) return

    const ac = new AbortController()
    const fetchEvent = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch<any>(`/api/events/${id}`, { signal: ac.signal })
        if (data && (data.id || data.home_team)) {
          setEvent(data)
        } else {
          setError('Evento não encontrado ou indisponível.')
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') setError('Evento não encontrado ou indisponível.')
      } finally {
        setLoading(false)
      }
    }

    fetchEvent()
    return () => ac.abort()
  }, [id, localFoundEvent, localEventsReady])

  const statusShort = typeof displayEvent?.status === 'object' ? displayEvent.status?.short : displayEvent?.status
  const statusKey = String(statusShort || displayEvent?.fixture?.status?.short || '').toUpperCase().trim()
  const liveStatuses = useMemo(
    () =>
      new Set([
        'LIVE',
        '1H',
        '2H',
        'HT',
        'ET',
        'BT',
        'P',
        'Q1',
        'Q2',
        'Q3',
        'Q4',
        'OT',
        'P1',
        'P2',
        'P3',
        'S1',
        'S2',
        'S3',
        'S4',
        'S5',
        'IN',
        'IN1',
        'IN2',
        'IN3',
        'IN4',
        'IN5',
        'IN6',
        'IN7',
        'IN8',
        'IN9',
        'IN_PROGRESS',
      ]),
    []
  )

  const isLive = !!displayEvent && (displayEvent.is_live === 1 || liveStatuses.has(statusKey))
  const liveTimerRaw = String((displayEvent as any)?.timer || displayEvent?.fixture?.status?.timer || '').trim()
  const liveTimer = liveTimerRaw
    ? liveTimerRaw.includes(':')
      ? liveTimerRaw
      : (() => {
          const n = Number(liveTimerRaw)
          if (!Number.isFinite(n) || n < 0) return ''
          const mm = String(Math.floor(n)).padStart(2, '0')
          return `${mm}:00`
        })()
    : ''
  const liveElapsed = Number((displayEvent as any)?.elapsed ?? displayEvent?.fixture?.status?.elapsed ?? 0) || 0

  useEffect(() => {
    if (!id) return
    let timer: ReturnType<typeof setTimeout>

    const fetchStats = async () => {
      try {
        const sportArg = (event as any)?.sport ? `?sport=${encodeURIComponent(String((event as any).sport))}` : '';
        const data = await apiFetch<any>(`/api/events/${id}/stats${sportArg}`)
        if (data) setLiveStats({ stats: data.stats ?? [], groupedStats: data.groupedStats ?? null, events: data.events ?? [] })
      } catch {
        /* empty */
      }
    }

    fetchStats()
    if (isLive) {
      const intervalMs = String((displayEvent as any)?.sport || '').toLowerCase() === 'soccer' ? 60000 : 15000
      timer = setInterval(fetchStats, intervalMs)
    }

    return () => clearInterval(timer)
  }, [id, isLive, (displayEvent as any)?.sport])

  useEffect(() => {
    if (!id || !displayEvent) return
    const sport = (displayEvent as any).sport || 'soccer'
    const ac = new AbortController()
    apiFetch<any>(`/api/events/${id}/h2h?sport=${encodeURIComponent(sport)}`, { signal: ac.signal })
      .then((data) => {
        const m = data?.matches ?? []
        setH2hData(m)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [id, displayEvent?.id, isLive])

  const ev = (displayEvent || null) as Event | null
  const g = parseGoals((ev as any)?.goals)
  const homeTeam = cleanTeam((ev as any)?.home_team || '')
  const awayTeam = cleanTeam((ev as any)?.away_team || '')
  const homeOdd = Number((ev as any)?.home_odd || 0)
  const drawOdd = Number((ev as any)?.draw_odd || 0)
  const awayOdd = Number((ev as any)?.away_odd || 0)

  const h2hSummary = useMemo(() => computeH2HSummary(h2hData, homeTeam, awayTeam), [h2hData, homeTeam, awayTeam])
  const probabilities = useMemo(
    () => computeProbabilitiesFromOdds(homeOdd, drawOdd, awayOdd) ?? computeProbabilitiesFromH2H(h2hSummary),
    [homeOdd, drawOdd, awayOdd, h2hSummary]
  )

  const statPairs = useMemo(() => {
    const rawStats = liveStats.stats
    const groupedStats = liveStats.groupedStats
    return {
      possession: extractStatPair(rawStats, groupedStats, [/possession/i]),
      corners: extractStatPair(rawStats, groupedStats, [/corner/i]),
      yellowCards: extractStatPair(rawStats, groupedStats, [/yellow.*card/i]),
      redCards: extractStatPair(rawStats, groupedStats, [/red.*card/i]),
      shotsOnTarget: extractStatPair(rawStats, groupedStats, [/shots?\s*on\s*target/i, /on target/i]),
      dangerousAttacks: extractStatPair(rawStats, groupedStats, [/dangerous.*attack/i]),
      freeKicks: extractStatPair(rawStats, groupedStats, [/free.*kick/i]),
    }
  }, [liveStats])

  const probabilityMarkets = useMemo(() => {
    const matches = Math.max(h2hSummary.matches, 1)
    const avgGoals = h2hSummary.matches > 0 ? h2hSummary.totalGoals / h2hSummary.matches : 0
    const over15 = h2hSummary.matches > 0 ? (h2hSummary.over15 / matches) * 100 : 50
    const over25 = h2hSummary.matches > 0 ? (h2hSummary.over25 / matches) * 100 : 40
    const btts = h2hSummary.matches > 0 ? (h2hSummary.btts / matches) * 100 : 35
    const avgGoalsBar = clamp(avgGoals * 35, 0, 100)

    return [
      { label: 'Mais de 1.5 Golos', percent: over15, trailing: formatOdd(over15), fillColor: '#10d292' },
      { label: 'Mais de 2.5 Golos', percent: over25, trailing: formatOdd(over25), fillColor: '#10d292' },
      { label: 'Ambas Marcam', percent: btts, trailing: formatOdd(btts), fillColor: '#3b82f6' },
      { label: 'Média golos H2H', percent: avgGoalsBar, trailing: `${avgGoals.toFixed(2)} gls`, fillColor: '#f4b400' },
    ]
  }, [h2hSummary])

  const detailedStats = useMemo(() => {
    const rows = [
      statPairs.possession ? { label: 'Posse de Bola', home: Math.round(statPairs.possession.home), away: Math.round(statPairs.possession.away), isPercent: true } : null,
      statPairs.corners ? { label: 'Cantos', home: Math.round(statPairs.corners.home), away: Math.round(statPairs.corners.away) } : null,
      statPairs.yellowCards ? { label: 'Cartões Amarelos', home: Math.round(statPairs.yellowCards.home), away: Math.round(statPairs.yellowCards.away) } : null,
      statPairs.redCards ? { label: 'Cartões Vermelhos', home: Math.round(statPairs.redCards.home), away: Math.round(statPairs.redCards.away) } : null,
      statPairs.shotsOnTarget ? { label: 'Remates à Baliza', home: Math.round(statPairs.shotsOnTarget.home), away: Math.round(statPairs.shotsOnTarget.away) } : null,
      statPairs.dangerousAttacks ? { label: 'Ataques Perigosos', home: Math.round(statPairs.dangerousAttacks.home), away: Math.round(statPairs.dangerousAttacks.away) } : null,
      statPairs.freeKicks ? { label: 'Livres', home: Math.round(statPairs.freeKicks.home), away: Math.round(statPairs.freeKicks.away) } : null,
    ]
    return rows.filter(Boolean) as Array<{ label: string; home: number; away: number; isPercent?: boolean }>
  }, [statPairs])

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full mx-auto"></div>
      </div>
    )
  }

  if (error || !displayEvent || !ev) return <div className="p-8 text-center text-red-600">{error || 'Evento não encontrado'}</div>

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {showMobileSidebar &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileSidebar(false)} />
            <div
              className={`absolute left-0 top-0 bottom-0 w-64 ${
                darkMode ? 'bg-gray-800' : 'bg-white'
              } shadow-xl overflow-y-auto transform transition-transform duration-300`}
            >
              <Sidebar dynamicTopItems={activeTopLeagues} />
            </div>
          </div>,
          document.body
        )}

      <div className="w-full flex items-start gap-4">
        <aside
          className={`hidden lg:block w-64 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${
            darkMode ? 'bg-gray-800' : 'bg-white'
          } border-r ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
        >
          <div className="p-4 space-y-4">
            <Sidebar dynamicTopItems={activeTopLeagues} />
          </div>
        </aside>

        <main className="flex-1 min-w-0 pb-20 mt-4">
          <div
            className={`relative rounded-xl overflow-hidden mb-4 px-4 py-5 flex flex-col items-center gap-2 ${
              darkMode ? 'bg-gray-800' : 'bg-white'
            } border ${darkMode ? 'border-gray-700' : 'border-gray-200'} shadow`}
          >
            {isLive && (
              <div className="flex items-center gap-2 mb-1">
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                </span>
                <span className="text-[11px] font-black text-red-600 uppercase tracking-widest">Ao Vivo</span>
                {statusShort && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                    } uppercase`}
                  >
                    {statusShort}
                  </span>
                )}
                {(liveTimer || liveElapsed > 0) && (
                  <span className="text-[11px] font-bold bg-red-600 text-white px-2 py-0.5 rounded">
                    {liveTimer || `${liveElapsed}'`}
                  </span>
                )}
              </div>
            )}

            <div className="w-full flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm md:text-base truncate">{homeTeam}</div>
              </div>
              <button
                onClick={() => navigate(`/event/${id}`)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border ${
                  darkMode
                    ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600'
                    : 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Mercados
              </button>
              <div className="flex-1 min-w-0 text-right">
                <div className="font-bold text-sm md:text-base truncate">{awayTeam}</div>
              </div>
            </div>

            <div className="mt-3">
              {isLive ? (
                <span className={`font-black text-3xl md:text-4xl tabular-nums ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {g.home} - {g.away}
                </span>
              ) : (
                <span className={`font-black text-xl ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>VS</span>
              )}
            </div>
          </div>

          <div className="mb-5 flex border-b border-gray-800/80">
            {[
              { key: 'probability' as const, label: 'Probabilidade' },
              { key: 'stats' as const, label: 'Estatísticas' },
              { key: 'h2h' as const, label: 'H2H' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-3 text-sm font-black transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-4 border-red-500 bg-red-500/10 text-red-400'
                    : darkMode
                      ? 'text-gray-400 hover:text-gray-200'
                      : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'probability' && (
            <div className="space-y-4">
              <div className={`rounded-[28px] border p-5 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
                <div className={`text-sm font-black uppercase tracking-[0.2em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Probabilidade de Resultado
                </div>
                <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
                  <CircularProbabilityCard
                    label={homeTeam}
                    percentage={probabilities.home}
                    odd={homeOdd > 1.01 ? homeOdd.toFixed(2) : formatOdd(probabilities.home)}
                    color="#3b82f6"
                    darkMode={darkMode}
                  />
                  <CircularProbabilityCard
                    label="Empate"
                    percentage={probabilities.draw}
                    odd={drawOdd > 1.01 ? drawOdd.toFixed(2) : formatOdd(probabilities.draw)}
                    color="#f4b400"
                    darkMode={darkMode}
                  />
                  <CircularProbabilityCard
                    label={awayTeam}
                    percentage={probabilities.away}
                    odd={awayOdd > 1.01 ? awayOdd.toFixed(2) : formatOdd(probabilities.away)}
                    color="#ff4d5e"
                    darkMode={darkMode}
                  />
                </div>
              </div>
              <div className={`rounded-[28px] border p-5 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
                <div className={`text-sm font-black uppercase tracking-[0.2em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Mercados Principais
                </div>
                <div className="mt-5 space-y-5">
                  {probabilityMarkets.map((market) => (
                    <MarketRow key={market.label} {...market} darkMode={darkMode} />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SnapshotCard
                  value={h2hSummary.matches > 0 ? (h2hSummary.totalGoals / h2hSummary.matches).toFixed(1) : '--'}
                  label="Golos/Jogo"
                  subLabel={`Liga: ${h2hSummary.matches > 0 ? (h2hSummary.totalGoals / h2hSummary.matches).toFixed(1) : '--'}`}
                  darkMode={darkMode}
                />
                <SnapshotCard
                  value={h2hSummary.matches > 0 ? formatPercent((h2hSummary.btts / h2hSummary.matches) * 100) : '--'}
                  label="AEM"
                  subLabel={`Liga: ${h2hSummary.matches > 0 ? formatPercent((h2hSummary.btts / h2hSummary.matches) * 100) : '--'}`}
                  darkMode={darkMode}
                />
                <SnapshotCard
                  value={
                    statPairs.corners
                      ? ((statPairs.corners.home + statPairs.corners.away) / 2).toFixed(1)
                      : '--'
                  }
                  label="Cantos/Jogo"
                  subLabel={String((ev as any).league || (ev as any).league_name || 'Partida')}
                  darkMode={darkMode}
                />
              </div>

              <div className={`rounded-[28px] border p-5 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.2em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    H2H Resumo
                  </div>
                  <span className="text-sm font-bold text-blue-400">Ver detalhes</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-5xl font-black text-blue-500">{h2hSummary.homeWins}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{homeTeam}</div>
                  </div>
                  <div>
                    <div className={`text-5xl font-black ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{h2hSummary.draws}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Empates</div>
                  </div>
                  <div>
                    <div className="text-5xl font-black text-red-500">{h2hSummary.awayWins}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{awayTeam}</div>
                  </div>
                </div>
                <div className={`mt-5 flex h-4 overflow-hidden rounded-full ${darkMode ? 'bg-[#202432]' : 'bg-gray-200'}`}>
                  <div
                    className="bg-blue-500"
                    style={{ width: `${h2hSummary.matches ? (h2hSummary.homeWins / h2hSummary.matches) * 100 : 33.33}%` }}
                  />
                  <div
                    className={`${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`}
                    style={{ width: `${h2hSummary.matches ? (h2hSummary.draws / h2hSummary.matches) * 100 : 33.33}%` }}
                  />
                  <div
                    className="bg-red-500"
                    style={{ width: `${h2hSummary.matches ? (h2hSummary.awayWins / h2hSummary.matches) * 100 : 33.33}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-3">
              <LiveMomentumSticksGraph
                darkMode={darkMode}
                stats={liveStats.stats}
                matchEvents={liveStats.events}
                homeName={homeTeam}
                awayName={awayTeam}
                currentMinute={liveElapsed || (liveTimer ? parseInt(liveTimer) : 0)}
                statusKey={statusKey}
              />

              {detailedStats.length > 0 ? (
                <div className="space-y-3">
                  {detailedStats.map((row) => (
                    <DetailedStatRow
                      key={row.label}
                      label={row.label}
                      homeValue={row.home}
                      awayValue={row.away}
                      isPercent={row.isPercent}
                      darkMode={darkMode}
                    />
                  ))}
                </div>
              ) : (
                <div className={`rounded-[28px] border px-4 py-10 text-center text-sm ${darkMode ? 'border-gray-800 bg-[#11131d] text-gray-400' : 'border-gray-200 bg-white text-gray-500'}`}>
                  Estatísticas detalhadas não disponíveis.
                </div>
              )}
            </div>
          )}

          {activeTab === 'h2h' && (
            <div className="space-y-4">
              <div className={`rounded-[28px] border p-5 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
                <div className={`mb-5 text-sm font-black uppercase tracking-[0.2em] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Últimos Confrontos
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-5xl font-black text-blue-500">{h2hSummary.homeWins}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{homeTeam}</div>
                  </div>
                  <div>
                    <div className={`text-5xl font-black ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{h2hSummary.draws}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Empates</div>
                  </div>
                  <div>
                    <div className="text-5xl font-black text-red-500">{h2hSummary.awayWins}</div>
                    <div className={`mt-2 text-lg ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{awayTeam}</div>
                  </div>
                </div>
              </div>

              {h2hData.length === 0 ? (
                <div className={`rounded-[28px] border px-4 py-10 text-center text-sm ${darkMode ? 'border-gray-800 bg-[#11131d] text-gray-400' : 'border-gray-200 bg-white text-gray-500'}`}>
                  Histórico indisponível.
                </div>
              ) : (
                <div className="space-y-3">
                  {h2hData.map((match: any, index: number) => {
                    const rawDate = match?.date || ''
                    const dateStr = rawDate
                      ? new Date(rawDate).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      : ''
                    const homeName = match?.homeTeam || match?.home_team || 'Casa'
                    const awayName = match?.awayTeam || match?.away_team || 'Fora'
                    const homeScore = Number(match?.homeScore ?? String(match?.score || '0-0').split('-')[0] ?? 0)
                    const awayScore = Number(match?.awayScore ?? String(match?.score || '0-0').split('-')[1] ?? 0)

                    return (
                      <div key={`${homeName}-${awayName}-${index}`} className={`rounded-[24px] border p-4 ${darkMode ? 'border-gray-800 bg-[#11131d]' : 'border-gray-200 bg-white'}`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className={`text-xs font-black uppercase tracking-[0.18em] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{dateStr || 'H2H'}</span>
                          <span className={`rounded-xl px-3 py-1 text-sm font-black ${darkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}`}>
                            {homeScore} - {awayScore}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className={`text-lg font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>{homeName}</div>
                          <div className={`text-lg font-bold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{awayName}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </main>

        <aside
          className={`hidden xl:block w-80 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto ${
            darkMode ? 'bg-gray-800' : 'bg-white'
          } border-l ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
        >
          <div className="p-4 space-y-4">
            <BetSlip />
          </div>
        </aside>
      </div>
    </div>
  )
}
