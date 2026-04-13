import { useEffect, useMemo, useState } from 'react';

const memCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function normTeam(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcd\b|\bsv\b|\bfk\b|\bsk\b|\bbk\b/g, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTeamBanner(teamName: string): Promise<string | null> {
  const key = normTeam(teamName);
  if (!key) return null;
  if (memCache.has(key)) return memCache.get(key) ?? null;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const promise = fetch(`/api/events/team-image?team=${encodeURIComponent(teamName)}`, { cache: 'force-cache' })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = await r.json().catch(() => null);
      const url = String(data?.url || '').trim() || null;
      memCache.set(key, url);
      inFlight.delete(key);
      return url;
    })
    .catch(() => {
      memCache.set(key, null);
      inFlight.delete(key);
      return null;
    });

  inFlight.set(key, promise);
  return promise;
}

export function useHomeTeamBanner(homeTeam: string, enabled: boolean = true): { bannerUrl: string | null; loading: boolean } {
  const team = useMemo(() => String(homeTeam || '').trim().replace(/[:;,. -]+$/g, '').trim(), [homeTeam]);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !team) return;
    let cancelled = false;
    setLoading(true);
    fetchTeamBanner(team).then((url) => {
      if (cancelled) return;
      setBannerUrl(url);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [team, enabled]);

  return { bannerUrl, loading };
}
