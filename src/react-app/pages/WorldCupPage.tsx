import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorldCupBanner from '../components/WorldCupBanner';
import WorldCupMatchCard from '../components/WorldCupMatchCard';

const KICKOFF_FROM = new Date('2026-06-11T00:00:00.000Z').getTime();

async function fetchOddsForEvent(id: string): Promise<{ home_odd: number; draw_odd: number; away_odd: number } | null> {
  try {
    const r = await fetch(`/api/events/${encodeURIComponent(id)}/odds?sport=soccer`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d) return null;
    const home = Number(d.home || 0);
    const draw = Number(d.draw || 0);
    const away = Number(d.away || 0);
    if (home > 1.01 && away > 1.01) return { home_odd: home, draw_odd: draw, away_odd: away };
    return null;
  } catch {
    return null;
  }
}

async function batchFetchOdds(
  ids: string[],
  onUpdate: (id: string, odds: { home_odd: number; draw_odd: number; away_odd: number }) => void,
  concurrency = 6,
) {
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      const odds = await fetchOddsForEvent(id);
      if (odds) onUpdate(id, odds);
    }
  });
  await Promise.all(workers);
}

export default function WorldCupPage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<any[]>([]);
  const [oddsMap, setOddsMap] = useState<Record<string, { home_odd: number; draw_odd: number; away_odd: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const all: any[] = [];
        const seen = new Set<string>();

        for (let page = 0; page < 12; page++) {
          const r = await fetch(`/api/world-cup-2026/matches?page=${page}`, { cache: 'no-store' });
          if (!r.ok) break;
          const data = await r.json().catch(() => null);
          const list: any[] = Array.isArray(data?.matches) ? data.matches : [];
          if (!list.length) break;
          let added = 0;
          for (const m of list) {
            const canonicalId =
              String(m?.id || '').trim() ||
              String(m?.fixture?.id || '').trim() ||
              String(m?.external_event_id || '').split('_').pop() ||
              '';
            const dedupeKey = canonicalId || String(m?.external_event_id || '').trim();
            if (!dedupeKey || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            if (canonicalId) m.id = canonicalId;
            all.push(m);
            added++;
          }
          if (added === 0) break;
        }

        if (!cancelledRef.current) setMatches(all);

        // Fetch odds for all matches in parallel
        const ids = all.map((m) => String(m.id || '')).filter(Boolean);
        if (ids.length) {
          await batchFetchOdds(ids, (id, odds) => {
            if (!cancelledRef.current) {
              setOddsMap((prev) => ({ ...prev, [id]: odds }));
            }
          });
        }
      } catch {
        if (!cancelledRef.current) setError(true);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };

    run();
    return () => { cancelledRef.current = true; };
  }, []);

  const enrichedMatches = useMemo(
    () =>
      matches.map((m) => {
        const id = String(m.id || '');
        const odds = oddsMap[id];
        if (!odds) return m;
        return { ...m, ...odds };
      }),
    [matches, oddsMap],
  );

  const grouped = useMemo(() => {
    const upcoming = enrichedMatches
      .filter((m) => {
        const ms = new Date(m?.event_date || m?.fixture?.date || 0).getTime();
        return Number.isFinite(ms) && ms >= KICKOFF_FROM;
      })
      .sort((a, b) => {
        const ta = new Date(a?.event_date || a?.fixture?.date || 0).getTime();
        const tb = new Date(b?.event_date || b?.fixture?.date || 0).getTime();
        return ta - tb;
      });

    const map = new Map<string, { label: string; events: any[] }>();
    for (const m of upcoming) {
      const d = new Date(m?.event_date || m?.fixture?.date || 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' });
      if (!map.has(key)) map.set(key, { label, events: [] });
      map.get(key)!.events.push(m);
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [enrichedMatches]);

  const totalGames = grouped.reduce((acc, g) => acc + g.events.length, 0);
  const totalWithOdds = Object.keys(oddsMap).length;

  return (
    <div className="min-h-screen bg-[#0a0502] text-white">
      <div className="max-w-5xl mx-auto px-3 md:px-6 py-5 space-y-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-200/80 hover:text-amber-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Voltar
        </button>

        <WorldCupBanner variant="hero" />

        <div className="flex items-baseline justify-between px-1">
          <h1 className="text-xl md:text-2xl font-black uppercase tracking-wide bg-gradient-to-r from-amber-200 to-yellow-400 bg-clip-text text-transparent">
            Todos os jogos
          </h1>
          <div className="flex items-center gap-3">
            {!loading && totalGames > 0 && (
              <span className="text-xs font-bold text-amber-200/70">{totalGames} jogos</span>
            )}
            {totalWithOdds > 0 && (
              <span
                className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(34,197,94,0.12)',
                  border: '1px solid rgba(34,197,94,0.30)',
                  color: '#4ade80',
                }}
              >
                ✓ {totalWithOdds} com odds
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-24">
            <div className="animate-spin h-12 w-12 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-amber-200/70">A carregar jogos da Copa do Mundo...</p>
          </div>
        ) : error || totalGames === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">🏆</div>
            <p className="text-amber-100 font-bold mb-1">Jogos indisponíveis de momento</p>
            <p className="text-amber-200/60 text-sm">
              Os jogos da Copa do Mundo 2026 começam a 11 de junho. Volte em breve.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map((g) => (
              <div key={g.key} className="space-y-3">
                <div
                  className="px-4 py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center gap-3"
                  style={{
                    background: 'rgba(212,151,43,0.12)',
                    border: '1px solid rgba(255,215,120,0.22)',
                  }}
                >
                  <span className="text-amber-300">📅</span>
                  <span className="text-amber-100 capitalize">{g.label}</span>
                  <span className="ml-auto text-[11px] font-bold text-amber-200/50">
                    {g.events.length} jogos
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {g.events.map((ev) => (
                    <WorldCupMatchCard
                      key={`wc_${ev.id || ev.external_event_id}`}
                      event={ev}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
