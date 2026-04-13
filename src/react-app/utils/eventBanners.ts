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

function teamGradientSvg(c1: string, c2: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="340" viewBox="0 0 1200 340">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="340" fill="url(#bg)"/>
  <g opacity="0.22" stroke="${accent}" stroke-width="5" fill="none">
    <rect x="60" y="40" width="1080" height="260" rx="18"/>
    <line x1="600" y1="40" x2="600" y2="300"/>
    <circle cx="600" cy="170" r="72"/>
    <rect x="60" y="115" width="145" height="110" rx="10"/>
    <rect x="995" y="115" width="145" height="110" rx="10"/>
    <rect x="60" y="140" width="58" height="60" rx="8"/>
    <rect x="1082" y="140" width="58" height="60" rx="8"/>
  </g>
  <g opacity="0.08" fill="${accent}">
    <circle cx="120" cy="80" r="5"/>
    <circle cx="1080" cy="260" r="3"/>
    <circle cx="980" cy="70" r="2"/>
    <circle cx="200" cy="290" r="3"/>
  </g>
</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

type TeamColors = [string, string, string];

const TEAM_COLORS: Record<string, TeamColors> = {
  barcelona: ['#A50044', '#004D98', '#ffffff'],
  'real madrid': ['#003DA5', '#FEBE10', '#ffffff'],
  'atletico madrid': ['#CE3524', '#1C2A4A', '#ffffff'],
  liverpool: ['#C8102E', '#00B2A9', '#ffffff'],
  'paris saint germain': ['#003370', '#EF3340', '#ffffff'],
  psg: ['#003370', '#EF3340', '#ffffff'],
  'manchester city': ['#6CABDD', '#1C2C5B', '#ffffff'],
  'manchester united': ['#DA291C', '#FBE122', '#ffffff'],
  arsenal: ['#EF0107', '#063672', '#ffffff'],
  chelsea: ['#034694', '#DBA111', '#ffffff'],
  juventus: ['#000000', '#FFFFFF', '#888888'],
  'ac milan': ['#FB090B', '#000000', '#ffffff'],
  milan: ['#FB090B', '#000000', '#ffffff'],
  'inter milan': ['#0068A8', '#000000', '#ffffff'],
  inter: ['#0068A8', '#000000', '#ffffff'],
  internazionale: ['#0068A8', '#000000', '#ffffff'],
  'borussia dortmund': ['#FDE100', '#1A1A1A', '#000000'],
  dortmund: ['#FDE100', '#1A1A1A', '#000000'],
  'bayer leverkusen': ['#E32221', '#000000', '#ffffff'],
  'rb leipzig': ['#DD0741', '#000000', '#ffffff'],
  benfica: ['#E21F27', '#1A1A2E', '#ffffff'],
  porto: ['#013CA6', '#001E3C', '#ffffff'],
  'fc porto': ['#013CA6', '#001E3C', '#ffffff'],
  sporting: ['#006F3D', '#F9C700', '#ffffff'],
  'sporting cp': ['#006F3D', '#F9C700', '#ffffff'],
  ajax: ['#D2122E', '#1A1A1A', '#ffffff'],
  'psv eindhoven': ['#EE0026', '#FFFFFF', '#cccccc'],
  psv: ['#EE0026', '#FFFFFF', '#cccccc'],
  feyenoord: ['#EE0026', '#FFFFFF', '#cccccc'],
  celtic: ['#16A34A', '#FFFFFF', '#cccccc'],
  rangers: ['#0047AB', '#FFFFFF', '#cccccc'],
  sevilla: ['#DF0000', '#FFFFFF', '#cccccc'],
  villarreal: ['#FFDC00', '#1B1B1B', '#000000'],
  'real sociedad': ['#003FA5', '#FFFFFF', '#cccccc'],
  'atletico bilbao': ['#CC0000', '#FFFFFF', '#cccccc'],
  'athletic club': ['#CC0000', '#FFFFFF', '#cccccc'],
  betis: ['#006B3F', '#FFFFFF', '#cccccc'],
  'real betis': ['#006B3F', '#FFFFFF', '#cccccc'],
  napoli: ['#1E93BE', '#FFFFFF', '#cccccc'],
  roma: ['#8B1A1A', '#F7C940', '#ffffff'],
  lazio: ['#81B8D8', '#FFFFFF', '#cccccc'],
  atalanta: ['#0171B8', '#000000', '#ffffff'],
  monaco: ['#D4021B', '#FFFFFF', '#cccccc'],
  lille: ['#FF0000', '#FFFFFF', '#cccccc'],
  lyon: ['#B22222', '#003399', '#ffffff'],
  marseille: ['#009FE3', '#FFFFFF', '#cccccc'],
  'shakhtar donetsk': ['#F07A14', '#000000', '#ffffff'],
  shakhtar: ['#F07A14', '#000000', '#ffffff'],
  'dinamo zagreb': ['#0000CD', '#FFFFFF', '#cccccc'],
  'red star belgrade': ['#CC0000', '#FFFFFF', '#cccccc'],
  bragantino: ['#CC0000', '#FFFFFF', '#cccccc'],
  flamengo: ['#CC0000', '#000000', '#ffffff'],
  palmeiras: ['#006400', '#FFFFFF', '#cccccc'],
  'athletico paranaense': ['#CC0000', '#000000', '#ffffff'],
  'river plate': ['#CC0000', '#FFFFFF', '#cccccc'],
  'boca juniors': ['#FFD700', '#003087', '#ffffff'],
  america: ['#FFD700', '#003087', '#ffffff'],
  chivas: ['#CC0000', '#FFFFFF', '#cccccc'],
};

const SPORT_COLORS: Record<string, TeamColors> = {
  soccer: ['#0a5c1e', '#1a7a30', '#ffffff'],
  basketball: ['#c9803a', '#3a1f00', '#ffffff'],
  tennis: ['#043b4a', '#0a6b7a', '#a7f3d0'],
  'ice-hockey': ['#1a3a6b', '#0e2244', '#60a5fa'],
  volleyball: ['#1a0b2b', '#3b1d5e', '#c4b5fd'],
  handball: ['#1a2b6b', '#0e1d44', '#93c5fd'],
  rugby: ['#1a3a1a', '#0e2212', '#86efac'],
  'american-football': ['#052e16', '#031a0d', '#bbf7d0'],
  boxing: ['#2d0a0a', '#1a0505', '#fca5a5'],
  mma: ['#140b0b', '#0a0505', '#fecaca'],
};

const TEAM_BANNERS: Array<{ match: (team: string) => boolean; banners: BannerPick[] }> = [
  {
    match: (t) => t.includes('barcelona'),
    banners: [
      { url: '/team-banner-barcelona.jpg' },
      { url: '/banners/barcelona-1.svg' },
      { url: '/banners/barcelona-2.svg' },
    ],
  },
  {
    match: (t) => t.includes('real madrid'),
    banners: [{ url: '/banners/real-madrid.svg' }],
  },
];

export function getEventBannerUrl(args: {
  eventId?: string | number;
  homeTeam?: string;
  awayTeam?: string;
  sport?: string;
}): string | null {
  const home = norm(args.homeTeam || '');
  const away = norm(args.awayTeam || '');
  const sportKey = norm(args.sport || 'soccer').replace(/ /g, '-');
  const candidates = [home, away].filter(Boolean);
  if (candidates.length === 0) return null;

  for (const rule of TEAM_BANNERS) {
    const hit = candidates.find((t) => rule.match(t));
    if (!hit) continue;
    const list = rule.banners;
    if (!list || list.length === 0) continue;
    const key = String(args.eventId || '') + '|' + hit;
    const idx = list.length === 1 ? 0 : (hash(key) % list.length);
    return list[idx]?.url || null;
  }

  for (const team of candidates) {
    for (const [key, colors] of Object.entries(TEAM_COLORS)) {
      if (team === key || team.includes(key) || key.includes(team)) {
        return teamGradientSvg(colors[0], colors[1], colors[2]);
      }
    }
  }

  const sc = SPORT_COLORS[sportKey] || SPORT_COLORS['soccer'];
  return teamGradientSvg(sc[0], sc[1], sc[2]);
}
