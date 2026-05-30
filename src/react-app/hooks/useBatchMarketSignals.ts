import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../utils/api'

export type LiveCardCta = 'idle' | 'big_chance' | 'goal' | 'penalty' | 'cards'

export interface LiveCardSignals {
  varActive: boolean
  cta: LiveCardCta
  ctaUntil: number
}

function isSoccerSport(sport: any) {
  const s = String(sport || '').toLowerCase()
  return s.includes('soccer') || (s.includes('football') && !s.includes('american')) || s.includes('futebol')
}

function incidentTimeKey(inc: any, idx: number) {
  const minute = Number(inc?.minute ?? 0) || 0
  const added = Number(inc?.addedTime ?? inc?.added_time ?? 0) || 0
  return minute * 1000 + added * 10 + (idx % 10)
}

function hasVarDecisionText(text: string) {
  const t = String(text || '').toLowerCase()
  return (
    t.includes('confirmed') ||
    t.includes('cancelled') ||
    t.includes('canceled') ||
    t.includes('decision') ||
    t.includes('goal confirmed') ||
    t.includes('goal cancelled') ||
    t.includes('penalty confirmed') ||
    t.includes('penalty cancelled') ||
    t.includes('card upgrade') ||
    t.includes('card cancelled') ||
    t.includes('anulad') ||
    t.includes('valid')
  )
}

function computeVarActive(incidents: any[]) {
  if (!Array.isArray(incidents) || incidents.length === 0) return { active: false, sinceKey: -1 }
  let lastVar: any = null
  let lastVarKey = -1
  for (let i = 0; i < incidents.length; i++) {
    const inc = incidents[i]
    if (String(inc?.type || '').toUpperCase() !== 'VAR') continue
    const k = incidentTimeKey(inc, i)
    if (k >= lastVarKey) {
      lastVarKey = k
      lastVar = inc
    }
  }
  if (!lastVar) return { active: false, sinceKey: -1 }
  const confirmed = lastVar?.isConfirmed
  if (confirmed === true && hasVarDecisionText(lastVar?.description || '')) return { active: false, sinceKey: -1 }
  if (confirmed === false) return { active: true, sinceKey: lastVarKey }

  for (let i = 0; i < incidents.length; i++) {
    const inc = incidents[i]
    const k = incidentTimeKey(inc, i)
    if (k < lastVarKey) continue
    const t = String(inc?.type || '').toLowerCase()
    if (t === 'disallowed_goal' || t === 'goal' || t === 'penalty_awarded' || t === 'penalty') return { active: false, sinceKey: -1 }
    if ((t === 'red_card' || t === 'yellow_card' || t === 'yellow_red') && hasVarDecisionText(inc?.description || '')) {
      return { active: false, sinceKey: -1 }
    }
  }

  return { active: true, sinceKey: lastVarKey }
}

function classifyCtaFromIncident(type: string): LiveCardCta {
  const t = String(type || '').toLowerCase()
  if (t === 'goal' || t === 'own_goal') return 'goal'
  if (t === 'penalty' || t === 'penalty_awarded' || t === 'missed_penalty') return 'penalty'
  if (t === 'red_card' || t === 'yellow_card' || t === 'yellow_red') return 'cards'
  return 'idle'
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  const runners = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(runners)
  return out
}

export function useBatchMarketSignals(params: {
  events: any[]
  enabled?: boolean
  maxEvents?: number
}) {
  const { events, enabled = true, maxEvents = 16 } = params

  const tracked = useMemo(() => {
    if (!enabled) return []
    const list: Array<{ id: string; sport: string }> = []
    for (const ev of Array.isArray(events) ? events : []) {
      const id = String(ev?.id ?? ev?.fixture?.id ?? ev?.external_event_id ?? '').trim()
      if (!id) continue
      const sport = String(ev?.sport || '').trim()
      if (!isSoccerSport(sport)) continue
      list.push({ id, sport })
      if (list.length >= maxEvents) break
    }
    return list
  }, [events, enabled, maxEvents])

  const [signals, setSignals] = useState<Record<string, LiveCardSignals>>({})
  const signalsRef = useRef<Record<string, LiveCardSignals>>({})
  const lastIncidentRef = useRef<Map<string, string>>(new Map())
  const lastBigTotalRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!tracked.length) {
      setSignals({})
      lastIncidentRef.current.clear()
      lastBigTotalRef.current.clear()
      return
    }

    let cancelled = false
    let inflight = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const tick = async () => {
      if (cancelled || inflight) return
      inflight = true
      try {
        const now = Date.now()
        const next: Record<string, LiveCardSignals> = { ...signalsRef.current }

        const results = await mapLimit(tracked, 4, async ({ id, sport }) => {
          try {
            const resp = await apiFetch<any>(`/api/events/${encodeURIComponent(id)}/incidents?sport=${encodeURIComponent(sport)}`, {
              method: 'GET',
              cache: 'no-store',
              timeout: 15000,
            })
            return { id, resp }
          } catch {
            return { id, resp: null }
          }
        })

        for (const r of results) {
          const resp = r.resp
          const list: any[] = Array.isArray(resp?.incidents) ? resp.incidents : []
          const v = computeVarActive(list)
          const prev = next[r.id] || { varActive: false, cta: 'idle' as const, ctaUntil: 0 }

          let cta: LiveCardCta = prev.cta
          let ctaUntil = prev.ctaUntil

          if (v.active) {
            cta = 'idle'
            ctaUntil = 0
          } else {
            const big = resp?.bigChances
            const total = Number(big?.home ?? 0) + Number(big?.away ?? 0)
            const lastBig = lastBigTotalRef.current.get(r.id) ?? 0
            if (Number.isFinite(total) && total > lastBig) {
              lastBigTotalRef.current.set(r.id, total)
              cta = 'big_chance'
              ctaUntil = now + 15000
            } else if (Number.isFinite(total) && lastBig === 0) {
              lastBigTotalRef.current.set(r.id, total)
            }

            const latest = (() => {
              let best: any = null
              let bestKey = -Infinity
              for (let i = 0; i < list.length; i++) {
                const inc = list[i]
                const k = incidentTimeKey(inc, i)
                if (k >= bestKey) {
                  bestKey = k
                  best = inc
                }
              }
              return best
            })()

            if (latest?.id != null) {
              const latestId = String(latest.id)
              const lastId = lastIncidentRef.current.get(r.id) || ''
              if (latestId && latestId !== lastId) {
                lastIncidentRef.current.set(r.id, latestId)
                const kind = classifyCtaFromIncident(latest?.type)
                if (kind !== 'idle') {
                  cta = kind
                  ctaUntil = now + (kind === 'goal' ? 12000 : 15000)
                }
              }
            }
          }

          if (ctaUntil && ctaUntil <= now) {
            cta = 'idle'
            ctaUntil = 0
          }

          next[r.id] = { varActive: v.active, cta, ctaUntil }
        }

        if (!cancelled) {
          signalsRef.current = next
          setSignals(next)
        }
      } finally {
        inflight = false
      }
    }

    tick()
    intervalId = setInterval(tick, 9000)
    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [tracked])

  return { signals }
}
