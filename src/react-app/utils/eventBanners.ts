type BannerPick = { url: string; attribution?: string };

const norm = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const TEAM_BANNERS: Array<{ match: (team: string) => boolean; banners: BannerPick[] }> = [
  {
    match: (t) => t.includes('real madrid'),
    banners: [{ url: '/banners/real-madrid.svg' }],
  },
  {
    match: (t) => t === 'barcelona' || t.includes('fc barcelona') || t.includes('barcelona'),
    banners: [{ url: '/banners/barcelona-1.svg' }, { url: '/banners/barcelona-2.svg' }],
  },
];

export function getEventBannerUrl(args: {
  eventId?: string | number;
  homeTeam?: string;
  awayTeam?: string;
}): string | null {
  const home = norm(args.homeTeam || '');
  const away = norm(args.awayTeam || '');
  const candidates = [home, away].filter(Boolean);
  if (candidates.length === 0) return null;

  for (const rule of TEAM_BANNERS) {
    const hit = candidates.find((t) => rule.match(t));
    if (!hit) continue;
    const list = rule.banners;
    if (!list || list.length === 0) return null;
    const key = String(args.eventId || '') + '|' + hit;
    const idx = list.length === 1 ? 0 : (hash(key) % list.length);
    return list[idx]?.url || null;
  }

  return null;
}
