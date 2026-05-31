import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorldCupBanner from '../components/WorldCupBanner';
import WorldCupMatchCard from '../components/WorldCupMatchCard';

const KICKOFF_FROM = new Date('2026-06-11T00:00:00.000Z').getTime();

export default function WorldCupPage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(false);
      try {
        const all: any[] = [];
        const seen = new Set<string>();
        // The API paginates; walk pages until one is empty or adds nothing new
        // (guards against both "end of list" and a non-paginated endpoint that
        // returns the same rows for every page). Hard cap at 12 pages.
        for (let page = 0; page < 12; page++) {
          const r = await fetch(`/api/world-cup-2026/matches?page=${page}`, { cache: 'no-store' });
          if (!r.ok) break;
          const data = await r.json().catch(() => null);
          const list: any[] = Array.isArray(data?.matches) ? data.matches : [];
          if (!list.length) break;
          let added = 0;
          for (const m of list) {
            // Canonical app id (matches /api/events/:id + EventCard): numeric
            // fixture id, e.g. "soccer_15186710" -> "15186710".
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
        if (!cancelled) setMatches(all);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const upcoming = matches
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
  }, [matches]);

  const totalGames = grouped.reduce((acc, g) => acc + g.events.length, 0);

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
          {!loading && totalGames > 0 && (
            <span className="text-xs font-bold text-amber-200/70">{totalGames} jogos</span>
          )}
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
              <div key={g.key} className="space-y-4">
                <div className="px-4 py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center gap-3"
                  style={{ background: 'rgba(212,151,43,0.14)', border: '1px solid rgba(255,215,120,0.25)' }}>
                  <span className="text-amber-300">📅</span>
                  <span className="text-amber-100">{g.label}</span>
                </div>
                <div className="flex flex-col gap-3">
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
