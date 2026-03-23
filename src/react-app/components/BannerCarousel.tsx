import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/react-app/contexts/AppContext";
import { apiFetch } from "@/react-app/utils/api";

function scoreEvent(event: any) { 
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
  const fallbackBanners = useMemo(() => ([
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
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0b0f1a"/><g opacity="0.22" stroke="#9ca3af" stroke-width="6" fill="none"><rect x="80" y="60" width="1040" height="480" rx="20"/><line x1="600" y1="60" x2="600" y2="540"/><circle cx="600" cy="300" r="90"/><rect x="80" y="190" width="180" height="220" rx="12"/><rect x="940" y="190" width="180" height="220" rx="12"/><circle cx="170" cy="300" r="55"/><circle cx="1030" cy="300" r="55"/></g><g opacity="0.10" fill="#ffd700"><circle cx="180" cy="100" r="4"/><circle cx="1020" cy="520" r="3"/><circle cx="980" cy="110" r="2"/></g></svg>`;
    }
    if (s.includes('tennis')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0b0f1a"/><g opacity="0.22" stroke="#9ca3af" stroke-width="6" fill="none"><rect x="120" y="80" width="960" height="440" rx="20"/><line x1="600" y1="80" x2="600" y2="520"/><line x1="120" y1="300" x2="1080" y2="300"/><rect x="220" y="150" width="760" height="300" rx="16"/><line x1="600" y1="150" x2="600" y2="450"/></g><g opacity="0.10" fill="#ffd700"><circle cx="220" cy="110" r="4"/><circle cx="980" cy="500" r="3"/><circle cx="930" cy="120" r="2"/></g></svg>`;
    }
    if (s.includes('soccer') || s.includes('football')) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0b0f1a"/><g opacity="0.22" stroke="#9ca3af" stroke-width="6" fill="none"><rect x="70" y="70" width="1060" height="460" rx="20"/><line x1="600" y1="70" x2="600" y2="530"/><circle cx="600" cy="300" r="85"/><rect x="70" y="200" width="160" height="200" rx="12"/><rect x="970" y="200" width="160" height="200" rx="12"/><rect x="70" y="240" width="70" height="120" rx="10"/><rect x="1060" y="240" width="70" height="120" rx="10"/></g><g opacity="0.10" fill="#ffd700"><circle cx="140" cy="120" r="4"/><circle cx="1050" cy="480" r="3"/><circle cx="980" cy="120" r="2"/></g></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#0b0f1a"/><g opacity="0.18" stroke="#9ca3af" stroke-width="6" fill="none"><rect x="90" y="90" width="1020" height="420" rx="22"/><line x1="90" y1="300" x2="1110" y2="300"/><line x1="600" y1="90" x2="600" y2="510"/></g><g opacity="0.10" fill="#ffd700"><circle cx="220" cy="130" r="4"/><circle cx="980" cy="470" r="3"/><circle cx="940" cy="140" r="2"/></g></svg>`;
  };

  // FETCH DATA
  useEffect(() => {
    const loadBanners = async () => {
      try {
        const bySport = await apiFetch<any>('/api/events/by-sport?sports=all&include=odds&realtime=0', { cache: 'no-store' });
        const pre = Array.isArray(bySport?.pregame) ? bySport.pregame : [];
        const live = Array.isArray(bySport?.live) ? bySport.live : [];
        const data = pre.length > 0 ? pre : (Array.isArray(live) ? live : []);

        if (Array.isArray(data) && data.length > 0) {
          const validData = data.filter((evt: any) => {
            const status = evt.status || evt.fixture?.status?.short;
            if (['FT', 'AET', 'PEN', 'Finished'].includes(status)) return false;

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
            const isLive = status === 'live' || ['1H','2H','HT','ET','P','LIVE'].includes(status) || evt.is_live === 1;
            if (pre.length > 0 && isLive) return false;

            if (pre.length > 0 && eventTime <= now.getTime()) return false;

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
            const timeStr = `${eventDate.toLocaleDateString('pt-PT', { weekday: 'short' }).toUpperCase()} • ${eventDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;

            const homeOdd = evt.home_odd || evt.odds?.home_odd || 0;
            const drawOdd = evt.draw_odd || evt.odds?.draw_odd || 0;
            const awayOdd = evt.away_odd || evt.odds?.away_odd || 0;

            const hasBoost = evt.odd_boost || false;
            const homeOld = hasBoost ? (parseFloat(homeOdd) * 0.9).toFixed(2) : null;

            // Extrair mercados adicionais da Odds API
            let markets: any[] = [];
            try {
              const rawMarkets = evt.markets;
              if (typeof rawMarkets === 'string') markets = JSON.parse(rawMarkets) || [];
              else if (Array.isArray(rawMarkets)) markets = rawMarkets;
            } catch { markets = []; }

            // Over/Under 2.5
            const ouMarket = markets.find((m: any) =>
              m.key === 'ou_2.5' || m.name?.includes('2.5') || m.id === 'ou_2.5'
            );
            const overOdd = ouMarket?.selections?.find((s: any) => s.label?.toLowerCase().includes('over'))?.odd || null;
            const underOdd = ouMarket?.selections?.find((s: any) => s.label?.toLowerCase().includes('under'))?.odd || null;

            // Ambas Marcam
            const bttsMarket = markets.find((m: any) =>
              m.key === 'btts' || m.name?.toLowerCase().includes('ambas') || m.name?.toLowerCase().includes('both')
            );
            const bttsYes = bttsMarket?.selections?.find((s: any) => s.label === 'Sim' || s.label === 'Yes')?.odd || null;
            const bttsNo = bttsMarket?.selections?.find((s: any) => s.label === 'Não' || s.label === 'No')?.odd || null;

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
              live: Number(evt.is_live || 0) === 1,
              odds: {
                homeOld,
                home: homeOdd,
                draw: drawOdd,
                away: awayOdd,
              },
              extraMarkets: {
                over25: overOdd,
                under25: underOdd,
                bttsYes,
                bttsNo,
              },
              league: evt.league || 'Destaque',
              homeLogo,
              awayLogo,
              sport,
            };
          });
          setBanners(mapped.slice(0, 5));
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

  if (loading) return null;
  const viewBanners = banners.length > 0 ? banners : fallbackBanners;

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
      sport: "soccer"
    });
    
    addNotification({ type: 'success', message: 'Adicionado ao boletim!' });
  };

  return (
    <>
      <style>{`
        .carousel { 
          position: relative; 
          width: 100%;
          max-width: 1200px; 
          margin: auto; 
          padding: 5px 0; 
          text-align: center; 
        } 
        
        .carousel-track {
          display: flex;
          gap: 10px;
          justify-content: center;
          width: 100%;
        }

        /* BANNER */ 
        .banner { 
          position: relative;
          overflow: hidden;
          flex: 1;
          background: linear-gradient(135deg, #0b0f1a 40%, #1f2937 100%); 
          border: 1px solid rgba(156, 163, 175, 0.35); 
          color: #fff; 
          padding: 16px 12px; 
          border-radius: 6px; 
          min-height: 180px; 
          box-shadow: 
            0 0 15px rgba(148, 163, 184, 0.14), 
            0 10px 30px rgba(0, 0, 0, 0.8); 
          transition: all 0.5s ease;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        } 

        .banner-bg {
          position: absolute;
          inset: 0;
          opacity: 0.55;
          background-size: cover;
          background-position: center;
          filter: blur(0px);
          pointer-events: none;
        }

        .banner-watermark {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding-left: 14px;
          opacity: 0.08;
          pointer-events: none;
        }

        .banner-watermark img {
          width: 140px;
          height: 140px;
          object-fit: contain;
        }

        /* EFEITO DE RAIO (SHINE) */
        .banner::after {
          content: "";
          position: absolute;
          top: 0;
          left: -150%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg, 
            transparent, 
            rgba(255, 255, 255, 0.2), 
            transparent
          );
          transform: skewX(-20deg);
          animation: ray-anim 3s infinite;
          pointer-events: none;
        }

        @keyframes ray-anim {
          0% { left: -150%; }
          50% { left: 150%; }
          100% { left: 150%; }
        } 
        
        /* BADGES */ 
        .badges { 
          display: flex; 
          gap: 6px; 
          justify-content: center; 
          margin-bottom: 4px; 
        } 
        
        .live-blink { 
          background: #dc2626; 
          padding: 2px 8px; 
          border-radius: 999px; 
          font-weight: 800; 
          font-size: 9px;
          animation: blink 1.2s infinite; 
        } 
        
        @keyframes blink { 
          0% { box-shadow: 0 0 0 rgba(220,38,38,.8); } 
          50% { box-shadow: 0 0 10px rgba(220,38,38,.8); } 
          100% { box-shadow: 0 0 0 rgba(220,38,38,.8); } 
        } 
        
        .boost { 
          background: linear-gradient(90deg, #22c55e, #16a34a); 
          color: #020617; 
          padding: 2px 8px; 
          border-radius: 999px; 
          font-weight: 800; 
          font-size: 9px;
          box-shadow: 0 0 10px rgba(34,197,94,.8); 
        } 
        
        /* TÍTULO */ 
        .banner h2 { 
          font-size: 17px; 
          font-weight: 800; 
          margin: 6px 0 4px; 
          text-transform: uppercase; 
          line-height: 1.1;
        } 
        
        .banner p { 
          color: #9ca3af; 
          font-size: 10px;
        } 

        .team-logos {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 4px;
        }

        .team-logo {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: rgba(15,23,42,0.9);
          padding: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 10px rgba(15,23,42,0.8);
        }

        .team-logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .team-vs {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #e5e7eb;
        }
        
        /* ODDS */ 
        .odds { 
          display: flex; 
          gap: 6px; 
          margin: 10px 0 0; 
        } 
        
        .odd-btn { 
          flex: 1; 
          background: rgba(2, 6, 23, 0.7); 
          border: 1px solid rgba(156, 163, 175, 0.35); 
          padding: 8px 6px; 
          border-radius: 4px; 
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          min-height: 48px; /* Standardize height */
        }  

        .odd-btn:hover {
          background: rgba(148, 163, 184, 0.10);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(148, 163, 184, 0.15);
        }

        .odd-btn:active {
          transform: translateY(0);
        }
        
        .odd-btn span { 
          font-size: 9px; 
          color: #9ca3af; 
          margin-bottom: 1px;
        } 

        .odds-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        
        .old-odd { 
          display: block; 
          font-size: 9px; 
          text-decoration: line-through; 
          color: #9ca3af; 
          margin-bottom: 0;
        } 
        
        .odd-btn b { 
          display: block; 
          font-size: 13px; 
        } 
        
        .boosted { 
          color: #22c55e; 
          font-size: 14px !important; 
          text-shadow: 0 0 8px rgba(34,197,94,.9); 
          animation: glow 1.5s infinite; 
        } 
        
        @keyframes glow { 
          0% { text-shadow: 0 0 4px rgba(34,197,94,.6); } 
          50% { text-shadow: 0 0 12px rgba(34,197,94,1); } 
          100% { text-shadow: 0 0 4px rgba(34,197,94,.6); } 
        } 
        
        /* MOBILE */ 
        @media (max-width: 768px) { 
          .carousel-track {
            display: flex;
            flex-direction: row;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            justify-content: flex-start; /* Alinha à esquerda */
            padding-bottom: 0;
            -webkit-overflow-scrolling: touch;
            gap: 2%; /* Espaçamento pequeno */
          }
          
          /* Hide Scrollbar */
          .carousel-track::-webkit-scrollbar {
            display: none;
          }
          .carousel-track {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }

          .banner { 
            flex: 0 0 32%; /* 3 banners visíveis (32% * 3 + gaps ~= 100%) */
            scroll-snap-align: start; /* Alinha no início */
            min-width: 0; /* Permite encolher abaixo do conteúdo */
            margin-right: 0;
            padding: 8px 4px; 
            min-height: 140px;
          } 
        
          .banner h2 { 
            font-size: 9px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin: 4px 0 2px;
          }

          .banner p {
            font-size: 8px;
            margin-bottom: 4px;
          }

          .team-logo {
            width: 24px;
            height: 24px;
            padding: 1px;
          }

          .team-vs {
            font-size: 8px;
          }
          
          .badges {
            gap: 2px;
            margin-bottom: 2px;
          }
          
          .live-blink, .boost {
            font-size: 7px;
            padding: 1px 4px;
          }

          .odds {
            gap: 2px;
            margin-top: 4px;
          }

          .odd-btn {
            padding: 4px 1px;
            min-height: 32px;
            border-radius: 3px;
          }

          .odd-btn span {
            font-size: 7px;
          }

          .odd-btn b {
            font-size: 9px;
          }
          
          .old-odd {
            font-size: 7px;
          }
          
          .boosted {
            font-size: 10px !important;
          }
        } 
      `}</style>

      <section 
        className="carousel select-none" 
      > 
        {/* BANNERS TRACK */}
        <div className="carousel-track">
          {viewBanners.map((banner, i) => (
            <div key={banner.id ?? i} className="banner"> 
              <div className="banner-bg" style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(getBgSvg(banner.sport))}")` }} />
              {banner.homeLogo && (
                <div className="banner-watermark">
                  <img src={banner.homeLogo} alt="" />
                </div>
              )}
              <div className="badges"> 
                {banner.live && <span className="live-blink">AO VIVO</span>} 
                {banner.odds.homeOld && <span className="boost">ODD BOOST</span>} 
              </div> 

              {(banner.homeLogo || banner.awayLogo) && (
                <div className="team-logos">
                  {banner.homeLogo && (
                    <div className="team-logo">
                      <img src={banner.homeLogo} alt={banner.home || 'Equipa da casa'} />
                    </div>
                  )}
                  <span className="team-vs">VS</span>
                  {banner.awayLogo && (
                    <div className="team-logo">
                      <img src={banner.awayLogo} alt={banner.away || 'Equipa de fora'} />
                    </div>
                  )}
                </div>
              )}
    
              <h2>{banner.title}</h2> 
              <p>{banner.time}</p> 
    
              {/* Mercado Principal: 1X2 */}
              <div className="odds"> 
                <div className="odd-btn" onClick={() => handleBet(banner, '1', banner.odds.home)}> 
                  <span>1</span> 
                  <div className="odds-row">
                    {banner.odds.homeOld && ( 
                      <small className="old-odd">{banner.odds.homeOld}</small> 
                    )} 
                    <b className={banner.odds.homeOld ? "boosted" : ""}> 
                      {Number(banner.odds.home) > 0 ? banner.odds.home : '—'} 
                    </b> 
                  </div>
                </div> 
    
                {Number(banner.odds.draw) > 0 && (
                  <div className="odd-btn" onClick={() => handleBet(banner, 'X', banner.odds.draw)}> 
                    <span>X</span> 
                    <b>{banner.odds.draw}</b> 
                  </div> 
                )}
    
                <div className="odd-btn" onClick={() => handleBet(banner, '2', banner.odds.away)}> 
                  <span>2</span> 
                  <b>{Number(banner.odds.away) > 0 ? banner.odds.away : '—'}</b> 
                </div> 
              </div>

              {/* Mercados Extras: Over/Under + Ambas Marcam (da Odds API) */}
              {banner.extraMarkets && (banner.extraMarkets.over25 || banner.extraMarkets.bttsYes) && (
                <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {banner.extraMarkets.over25 && (
                    <div className="odd-btn" style={{ flex: '1', minWidth: '40px' }} onClick={() => handleBet(banner, 'Over 2.5', String(banner.extraMarkets.over25))}>
                      <span style={{ fontSize: '7px', color: '#60a5fa' }}>Ov 2.5</span>
                      <b style={{ fontSize: '11px', color: '#93c5fd' }}>{Number(banner.extraMarkets.over25).toFixed(2)}</b>
                    </div>
                  )}
                  {banner.extraMarkets.under25 && (
                    <div className="odd-btn" style={{ flex: '1', minWidth: '40px' }} onClick={() => handleBet(banner, 'Under 2.5', String(banner.extraMarkets.under25))}>
                      <span style={{ fontSize: '7px', color: '#60a5fa' }}>Un 2.5</span>
                      <b style={{ fontSize: '11px', color: '#93c5fd' }}>{Number(banner.extraMarkets.under25).toFixed(2)}</b>
                    </div>
                  )}
                  {banner.extraMarkets.bttsYes && (
                    <div className="odd-btn" style={{ flex: '1', minWidth: '40px' }} onClick={() => handleBet(banner, 'Ambas Marcam', String(banner.extraMarkets.bttsYes))}>
                      <span style={{ fontSize: '7px', color: '#4ade80' }}>AM Sim</span>
                      <b style={{ fontSize: '11px', color: '#86efac' }}>{Number(banner.extraMarkets.bttsYes).toFixed(2)}</b>
                    </div>
                  )}
                  {banner.extraMarkets.bttsNo && (
                    <div className="odd-btn" style={{ flex: '1', minWidth: '40px' }} onClick={() => handleBet(banner, 'Ambas Não Marcam', String(banner.extraMarkets.bttsNo))}>
                      <span style={{ fontSize: '7px', color: '#4ade80' }}>AM Não</span>
                      <b style={{ fontSize: '11px', color: '#86efac' }}>{Number(banner.extraMarkets.bttsNo).toFixed(2)}</b>
                    </div>
                  )}
                </div>
              )}
            </div> 
          ))}
        </div>
      </section> 
    </>
  );
}
