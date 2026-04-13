import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/react-app/contexts/AppContext";
import { apiFetch } from "@/react-app/utils/api";

export function scoreEvent(event: any) { 
  let score = 0; 

  // ⏱️ TEMPO PARA COMEÇAR 
  const startTime = event.start_time || event.event_date;
  const minutes = 
    (new Date(startTime).getTime() - Date.now()) / 60000; 

  if (minutes > 0 && minutes <= 30) score += 700; 
  else if (minutes > 0 && minutes <= 120) score += 400; 

  // 📊 VOLUME DE APOSTAS 
  if (event.total_bets >= 20000) score += 600; 
  else if (event.total_bets >= 10000) score += 400; 
  else if (event.total_bets >= 3000) score += 200; 

  // 🏆 LIGAS TOP 
  const TOP_LEAGUES = [ 
    "Premier League", 
    "La Liga", 
    "Serie A", 
    "Bundesliga", 
    "Ligue 1", 
    "Brasileirão" 
  ]; 

  if (TOP_LEAGUES.includes(event.league)) { 
    score += 300; 
  } 

  // 🚀 ODD BOOST / PROMO 
  if (event.odd_boost) { 
    score += 500; 
  } 

  // ⭐ CLÁSSICO (bônus leve) 
  if (event.is_classic) { 
    score += 150; 
  } 

  return score; 
}

export function BannerCarousel() {
  const { addToBetSlip, addNotification } = useApp();
  const [banners, setBanners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const fallbackBanners = useMemo(() => ([
    {
      id: 'promo-photo-barca',
      title: 'La Liga · Destaque',
      home: 'Barcelona',
      away: 'Real Madrid',
      time: 'EM BREVE',
      live: false,
      odds: { homeOld: null, home: '0', draw: '0', away: '0' },
      league: 'La Liga',
      homeLogo: null,
      awayLogo: null,
      sport: 'soccer',
      photoBg: '/team-banner-barcelona.jpg',
      promoLabel: 'DESTAQUE DA SEMANA',
      promoText: 'O clássico que para o mundo',
    },
    {
      id: 'promo-1',
      title: 'Bónus de Boas‑Vindas',
      home: 'Depósito',
      away: 'Bónus',
      time: 'PROMOÇÃO',
      live: false,
      odds: { homeOld: null, home: '0', draw: '0', away: '0' },
      league: 'BET62',
      homeLogo: null,
      awayLogo: null,
      sport: 'soccer',
    },
    {
      id: 'promo-2',
      title: 'Cashout & Odds Turbo',
      home: 'Cashout',
      away: 'Turbo',
      time: 'NOVIDADES',
      live: false,
      odds: { homeOld: null, home: '0', draw: '0', away: '0' },
      league: 'BET62',
      homeLogo: null,
      awayLogo: null,
      sport: 'basketball',
    },
    {
      id: 'promo-3',
      title: 'Aposta Ao Vivo',
      home: 'Live',
      away: 'Now',
      time: 'AO VIVO',
      live: false,
      odds: { homeOld: null, home: '0', draw: '0', away: '0' },
      league: 'BET62',
      homeLogo: null,
      awayLogo: null,
      sport: 'tennis',
    },
  ]), []);

  const getBgSvg = (sport: string) => {
    const s = String(sport || '').toLowerCase();
    if (s.includes('basket')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#c9803a"/><g opacity="0.26" stroke="#fef3c7" stroke-width="6" fill="none"><rect x="80" y="60" width="1040" height="480" rx="20"/><line x1="600" y1="60" x2="600" y2="540"/><circle cx="600" cy="300" r="90"/><rect x="80" y="190" width="180" height="220" rx="12"/><rect x="940" y="190" width="180" height="220" rx="12"/><circle cx="170" cy="300" r="55"/><circle cx="1030" cy="300" r="55"/></g><g opacity="0.10" fill="#111827"><circle cx="180" cy="100" r="4"/><circle cx="1020" cy="520" r="3"/><circle cx="980" cy="110" r="2"/></g></svg>`;
    }
    if (s.includes('tennis')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#043b4a"/><g opacity="0.26" stroke="#a7f3d0" stroke-width="6" fill="none"><rect x="120" y="80" width="960" height="440" rx="20"/><line x1="600" y1="80" x2="600" y2="520"/><line x1="120" y1="300" x2="1080" y2="300"/><rect x="220" y="150" width="760" height="300" rx="16"/><line x1="600" y1="150" x2="600" y2="450"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="110" r="4"/><circle cx="980" cy="500" r="3"/><circle cx="930" cy="120" r="2"/></g></svg>`;
    }
    if (s.includes('ice') && s.includes('hockey')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#e0f2fe"/><g opacity="0.26" stroke="#60a5fa" stroke-width="6" fill="none"><rect x="90" y="70" width="1020" height="460" rx="120"/><line x1="600" y1="70" x2="600" y2="530"/><circle cx="360" cy="300" r="70"/><circle cx="840" cy="300" r="70"/><line x1="260" y1="70" x2="260" y2="530"/><line x1="940" y1="70" x2="940" y2="530"/></g><g opacity="0.10" fill="#1d4ed8"><circle cx="180" cy="100" r="4"/><circle cx="1020" cy="520" r="3"/><circle cx="980" cy="110" r="2"/></g></svg>`;
    }
    if (s.includes('american') && s.includes('football')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#052e16"/><g opacity="0.20" stroke="#bbf7d0" stroke-width="6" fill="none"><rect x="70" y="90" width="1060" height="420" rx="22"/><line x1="170" y1="90" x2="170" y2="510"/><line x1="270" y1="90" x2="270" y2="510"/><line x1="370" y1="90" x2="370" y2="510"/><line x1="470" y1="90" x2="470" y2="510"/><line x1="570" y1="90" x2="570" y2="510"/><line x1="670" y1="90" x2="670" y2="510"/><line x1="770" y1="90" x2="770" y2="510"/><line x1="870" y1="90" x2="870" y2="510"/><line x1="970" y1="90" x2="970" y2="510"/><line x1="1070" y1="90" x2="1070" y2="510"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
    }
    if (s.includes('baseball')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0f172a"/><g opacity="0.24" stroke="#fca5a5" stroke-width="6" fill="none"><path d="M600 120 L920 300 L600 480 L280 300 Z"/><circle cx="600" cy="300" r="120"/><rect x="560" y="260" width="80" height="80" rx="10"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
    }
    if (s.includes('volley')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#1a0b2b"/><g opacity="0.24" stroke="#c4b5fd" stroke-width="6" fill="none"><rect x="110" y="90" width="980" height="420" rx="22"/><line x1="600" y1="90" x2="600" y2="510"/><line x1="600" y1="150" x2="600" y2="450"/><line x1="110" y1="300" x2="1090" y2="300"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
    }
    if (s.includes('mma') || s.includes('ufc')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#140b0b"/><g opacity="0.24" stroke="#fecaca" stroke-width="6" fill="none"><path d="M400 110 L800 110 L1020 300 L800 490 L400 490 L180 300 Z"/><circle cx="600" cy="300" r="90"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
    }
    if (s.includes('soccer') || (s.includes('football') && !s.includes('american'))) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0a8a2a"/><g opacity="0.22" stroke="#ffffff" stroke-width="6" fill="none"><rect x="70" y="70" width="1060" height="460" rx="20"/><line x1="600" y1="70" x2="600" y2="530"/><circle cx="600" cy="300" r="85"/><rect x="70" y="200" width="160" height="200" rx="12"/><rect x="970" y="200" width="160" height="200" rx="12"/><rect x="70" y="240" width="70" height="120" rx="10"/><rect x="1060" y="240" width="70" height="120" rx="10"/></g><g opacity="0.10" fill="#14532d"><circle cx="140" cy="120" r="4"/><circle cx="1050" cy="480" r="3"/><circle cx="980" cy="120" r="2"/></g></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0b0f1a"/><g opacity="0.18" stroke="#9ca3af" stroke-width="6" fill="none"><rect x="90" y="90" width="1020" height="420" rx="22"/><line x1="90" y1="300" x2="1110" y2="300"/><line x1="600" y1="90" x2="600" y2="510"/></g><g opacity="0.10" fill="#fff"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
  };

  // FETCH DATA
  useEffect(() => {
    const loadBanners = async () => {
      try {
        const bySport = await apiFetch<any>('/api/events/by-sport?sports=all&include=odds&realtime=0', { cache: 'no-store' });
        const live = Array.isArray(bySport?.live) ? bySport.live : [];
        const pre = Array.isArray(bySport?.pregame) ? bySport.pregame : [];
        const usingLive = live.length > 0;
        const data = usingLive ? live : pre;

        if (Array.isArray(data) && data.length > 0) {
          const validData = data.filter((evt: any) => {
            const st = evt.status;
            const status = typeof st === 'string' ? st : (st?.short || st?.code || '');
            const statusShort = String(status || evt.fixture?.status?.short || '').trim();
            if (['FT', 'AET', 'PEN', 'Finished'].includes(statusShort)) return false;

            const rawDate = evt.event_date || evt.fixture?.date;
            if (!rawDate) return false;
            const d = new Date(rawDate);
            if (Number.isNaN(d.getTime())) return false;

            const now = new Date();
            let dAdj = d;
            const diff = now.getTime() - d.getTime();
            if (Math.abs(diff) > 300 * 24 * 60 * 60 * 1000) {
              dAdj = new Date(d);
              dAdj.setFullYear(now.getFullYear());
            }

            const eventTime = dAdj.getTime();
            const isLive = statusShort === 'live' || ['1H','2H','HT','ET','P','LIVE'].includes(statusShort) || evt.is_live === 1;
            if (!usingLive && isLive) return false;

            if (!usingLive && eventTime <= now.getTime()) return false;

            const endWindow = now.getTime() + 7 * 24 * 60 * 60 * 1000;
            if (eventTime > endWindow) return false;

            return true;
          });

          // Sort by score
          const sorted = validData.sort((a, b) => scoreEvent(b) - scoreEvent(a));

          const mapped = sorted.map((evt: any) => {
            const rawDate = evt.event_date || evt.fixture?.date;
            const baseDate = rawDate ? new Date(rawDate) : new Date();
            const now = new Date();
            let eventDate = baseDate;
            const diff = now.getTime() - baseDate.getTime();
            if (Math.abs(diff) > 300 * 24 * 60 * 60 * 1000) {
              eventDate = new Date(baseDate);
              eventDate.setFullYear(now.getFullYear());
            }
            const elapsed = Number(evt.elapsed || (evt?.status as any)?.elapsed || 0);
            const timer = String(evt.timer || evt?.fixture?.status?.timer || '').trim();
            const isLive = Number(evt.is_live || 0) === 1;
            const timeStr = isLive
              ? `AO VIVO${timer ? ` • ${timer}` : (elapsed > 0 ? ` • ${elapsed}'` : '')}`
              : `${eventDate.toLocaleDateString('pt-PT', { weekday: 'short' }).toUpperCase()} • ${eventDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;

            const hs = (evt?.goals?.home ?? evt?.score?.home ?? 0);
            const as = (evt?.goals?.away ?? evt?.score?.away ?? 0);
            const score = isLive ? `${typeof hs === 'object' ? (hs?.total ?? hs?.score ?? hs?.current ?? 0) : hs}-${typeof as === 'object' ? (as?.total ?? as?.score ?? as?.current ?? 0) : as}` : '';

            const homeOdd = evt.home_odd || evt.odds?.home_odd || 0;
            const drawOdd = evt.draw_odd || evt.odds?.draw_odd || 0;
            const awayOdd = evt.away_odd || evt.odds?.away_odd || 0;

            const homeOld = null;

            const homeLogo =
              evt.home_team_logo ||
              evt.teams?.home?.logo ||
              evt.fixture?.teams?.home?.logo ||
              null;
            const awayLogo =
              evt.away_team_logo ||
              evt.teams?.away?.logo ||
              evt.fixture?.teams?.away?.logo ||
              null;
            const sport = evt.sport || 'soccer';

            return {
              id: evt.id,
              title: evt.match || `${evt.home_team} vs ${evt.away_team}`,
              home: evt.home_team,
              away: evt.away_team,
              time: timeStr,
              live: isLive,
              timer,
              score,
              odds: {
                homeOld: homeOld,
                home: homeOdd,
                draw: drawOdd,
                away: awayOdd,
                homeBook: String(evt.home_odd_bookmaker || ''),
                drawBook: String(evt.draw_odd_bookmaker || ''),
                awayBook: String(evt.away_odd_bookmaker || ''),
              },
              league: evt.league || 'Destaque',
              homeLogo,
              awayLogo,
              sport,
            };
          });
          const onlyLive = mapped.filter((m: any) => m.live);
          const top = onlyLive.length > 0 ? onlyLive.slice(0, 6) : mapped.slice(0, 6);
          setBanners(top);
        }
      } catch (err) {
        // console.error("Failed to load featured games", err);
        // Keep empty state (fallback handled by UI)
      } finally {
        setLoading(false);
      }
    };

    loadBanners();
  }, []);

  // Always show static photo promo banners at the start of the carousel
  const photoBanners = fallbackBanners.filter((b: any) => b.photoBg);
  const eventBanners = banners.length > 0 ? banners : fallbackBanners.filter((b: any) => !b.photoBg);
  const viewBanners = [...photoBanners, ...eventBanners];
  const displayBanners = viewBanners.length > 0 ? [viewBanners[activeIndex % viewBanners.length]] : viewBanners;

  useEffect(() => {
    if (viewBanners.length <= 1) return;
    const t = setInterval(() => setActiveIndex((i) => (i + 1) % viewBanners.length), 6000);
    return () => clearInterval(t);
  }, [viewBanners.length]);

  if (loading) return null;

  const handleBet = (banner: any, selection: string, odd: string) => {
    const price = parseFloat(odd);
    if (!price) return;

    addToBetSlip({
      id: `banner-${banner.id}-${selection}`,
      event_id: banner.id,
      match: banner.title,
      selection,
      odd: price,
      stake: 0,
      league: banner.league,
      sport: banner.sport || "soccer"
    });
    
    addNotification({ type: 'success', message: 'Adicionado ao boletim!' });
  };

  const featured = displayBanners[0];
  const hasDraw = featured ? Number(featured?.odds?.draw || 0) > 0 : false;
  const scoreText = featured?.live && featured?.score ? String(featured.score) : '';
  const isPhotoBanner = !!featured?.photoBg;

  return (
    <>
      <section className="w-full max-w-6xl mx-auto px-3 sm:px-4 select-none">
        <div className="relative overflow-hidden rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-950 via-slate-900 to-gray-900 shadow-2xl" style={{ minHeight: isPhotoBanner ? 220 : undefined }}>
          {isPhotoBanner ? (
            <>
              <img
                src={featured.photoBg}
                alt=""
                className="absolute inset-0 w-full h-full object-cover object-center"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
            </>
          ) : (
            <div
              className="absolute inset-0 opacity-30"
              style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(getBgSvg(featured?.sport || ''))}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            />
          )}
          <div className="relative p-4 sm:p-6">
            {isPhotoBanner ? (
              <div className="flex flex-col justify-between h-full gap-3">
                <div className="flex items-center gap-2">
                  {featured?.promoLabel && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-black uppercase tracking-wider">
                      {featured.promoLabel}
                    </span>
                  )}
                  <span className="text-xs font-bold uppercase tracking-wider text-white/80">{featured?.league}</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl sm:text-3xl font-black text-white leading-tight drop-shadow-lg">
                    {featured?.home}
                    <span className="text-amber-400 mx-2">vs</span>
                    {featured?.away}
                  </div>
                  {featured?.promoText && (
                    <div className="text-sm text-white/70 mt-1 font-medium">{featured.promoText}</div>
                  )}
                  <div className="text-xs text-white/50 mt-1 font-semibold uppercase tracking-wider">{featured?.time}</div>
                </div>
                {hasDraw ? (
                  <div className="mt-3 grid grid-cols-3 gap-2" style={{ maxWidth: 320 }}>
                    <button
                      className="rounded-xl bg-black/50 border border-white/20 hover:bg-black/70 transition-colors p-2.5 text-left backdrop-blur-sm"
                      onClick={() => handleBet(featured, '1', featured?.odds?.home)}
                    >
                      <div className="text-[10px] text-gray-300 font-bold uppercase">1</div>
                      <div className="text-base font-black text-white">{Number(featured?.odds?.home || 0) > 0 ? featured.odds.home : '—'}</div>
                    </button>
                    <button
                      className="rounded-xl bg-black/50 border border-white/20 hover:bg-black/70 transition-colors p-2.5 text-left backdrop-blur-sm"
                      onClick={() => handleBet(featured, 'X', featured?.odds?.draw)}
                    >
                      <div className="text-[10px] text-gray-300 font-bold uppercase">X</div>
                      <div className="text-base font-black text-white">{Number(featured?.odds?.draw || 0) > 0 ? featured.odds.draw : '—'}</div>
                    </button>
                    <button
                      className="rounded-xl bg-black/50 border border-white/20 hover:bg-black/70 transition-colors p-2.5 text-left backdrop-blur-sm"
                      onClick={() => handleBet(featured, '2', featured?.odds?.away)}
                    >
                      <div className="text-[10px] text-gray-300 font-bold uppercase">2</div>
                      <div className="text-base font-black text-white">{Number(featured?.odds?.away || 0) > 0 ? featured.odds.away : '—'}</div>
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 text-sm font-bold uppercase tracking-wider">
                    Ver Evento
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-xs font-bold uppercase tracking-wider text-gray-300 truncate">{featured?.league || 'Destaque'}</div>
                    {featured?.live && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-red-600 text-white">
                        AO VIVO
                        {featured?.timer ? <span className="opacity-90">{String(featured.timer)}</span> : null}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-300 font-semibold">{featured?.time}</div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                      {featured?.homeLogo ? <img src={featured.homeLogo} alt={featured.home} className="w-10 h-10 object-contain" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="text-base sm:text-lg font-black text-white truncate">{featured?.home}</div>
                      <div className="text-xs text-gray-300 truncate">{featured?.away}</div>
                    </div>
                  </div>

                  <div className="text-center shrink-0">
                    <div className="text-2xl sm:text-4xl font-black text-white tabular-nums">
                      {featured?.live ? (scoreText || '0-0') : 'VS'}
                    </div>
                    <div className="text-xs text-gray-300 font-semibold">{featured?.sport ? String(featured.sport).toUpperCase() : ''}</div>
                  </div>

                  <div className="flex items-center gap-3 min-w-0 justify-end">
                    <div className="min-w-0 text-right">
                      <div className="text-base sm:text-lg font-black text-white truncate">{featured?.away}</div>
                      <div className="text-xs text-gray-300 truncate">{featured?.home}</div>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                      {featured?.awayLogo ? <img src={featured.awayLogo} alt={featured.away} className="w-10 h-10 object-contain" /> : null}
                    </div>
                  </div>
                </div>

                <div className={`mt-4 grid gap-2 ${hasDraw ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <button
                    className="rounded-xl bg-black/40 border border-white/10 hover:bg-black/55 transition-colors p-3 text-left"
                    onClick={() => handleBet(featured, '1', featured?.odds?.home)}
                  >
                    <div className="text-[10px] text-gray-300 font-bold uppercase">1</div>
                    <div className="text-lg font-black text-white">{Number(featured?.odds?.home || 0) > 0 ? featured.odds.home : '—'}</div>
                  </button>
                  {hasDraw && (
                    <button
                      className="rounded-xl bg-black/40 border border-white/10 hover:bg-black/55 transition-colors p-3 text-left"
                      onClick={() => handleBet(featured, 'X', featured?.odds?.draw)}
                    >
                      <div className="text-[10px] text-gray-300 font-bold uppercase">X</div>
                      <div className="text-lg font-black text-white">{Number(featured?.odds?.draw || 0) > 0 ? featured.odds.draw : '—'}</div>
                    </button>
                  )}
                  <button
                    className="rounded-xl bg-black/40 border border-white/10 hover:bg-black/55 transition-colors p-3 text-left"
                    onClick={() => handleBet(featured, '2', featured?.odds?.away)}
                  >
                    <div className="text-[10px] text-gray-300 font-bold uppercase">2</div>
                    <div className="text-lg font-black text-white">{Number(featured?.odds?.away || 0) > 0 ? featured.odds.away : '—'}</div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
