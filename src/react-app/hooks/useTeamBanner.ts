import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/react-app/utils/api';

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

async function fetchTeamBanner(rawName: string): Promise<string | null> {
  const key = normTeam(rawName);
  if (!key) return null;

  if (memCache.has(key)) return memCache.get(key) ?? null;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const promise = apiFetch<{ url: string | null }>(`/api/events/team-image?team=${encodeURIComponent(rawName)}`)
    .then((data) => {
      const url = data?.url || null;
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

function pickPrimaryTeam(home: string, away: string): string {
  const majorClubs = [
    'barcelona','real madrid','liverpool','manchester','psg','paris saint','juventus',
    'milan','inter','bayern','dortmund','atletico','chelsea','arsenal','ajax',
    'porto','benfica','sporting','celtic','rangers','roma','napoli',
    'atalanta','lazio','sevilla','villarreal','lyon','marseille','monaco',
    'shakhtar','galatasaray','besiktas','fenerbahce','river','boca','flamengo',
    'palmeiras','santos','corinthians','america','chivas',
  ];
  const homeNorm = normTeam(home);
  const awayNorm = normTeam(away);
  for (const club of majorClubs) {
    if (homeNorm.includes(club)) return home;
    if (awayNorm.includes(club)) return away;
  }
  return home;
}

export function useTeamBanner(
  homeTeam: string,
  awayTeam: string,
  enabled: boolean = true,
): { bannerUrl: string | null; loading: boolean } {
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || !homeTeam) return;

    const primaryTeam = pickPrimaryTeam(homeTeam, awayTeam);
    const primaryKey = normTeam(primaryTeam);
    const secondaryTeam = primaryTeam === homeTeam ? awayTeam : homeTeam;

    if (memCache.has(primaryKey)) {
      const cached = memCache.get(primaryKey) ?? null;
      setBannerUrl(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchTeamBanner(primaryTeam).then((url) => {
      if (cancelled || !mountedRef.current) return;
      if (url) {
        setBannerUrl(url);
        setLoading(false);
        return;
      }
      fetchTeamBanner(secondaryTeam).then((url2) => {
        if (cancelled || !mountedRef.current) return;
        setBannerUrl(url2);
        setLoading(false);
      });
    });

    return () => { cancelled = true; };
  }, [homeTeam, awayTeam, enabled]);

  return { bannerUrl, loading };
}

