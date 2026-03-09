import { useState, useEffect } from "react";
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

  // FETCH DATA
  useEffect(() => {
    const loadBanners = async () => {
      try {
        const data = await apiFetch<any[]>('/api/featured-games', { cache: 'no-store' });
        
        if (Array.isArray(data) && data.length > 0) {
          const validData = data.filter(evt => {
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
            if (isLive) return false;

            if (eventTime <= now.getTime()) return false;

            const endWindow = now.getTime() + 72 * 60 * 60 * 1000;
            if (eventTime > endWindow) return false;

            return true;
          });

          // Sort by score
          const sorted = validData.sort((a, b) => scoreEvent(b) - scoreEvent(a));

          const mapped = sorted.map(evt => {
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

            const hasBoost = evt.odd_boost || (Math.random() > 0.8);
            const homeOld = hasBoost ? (parseFloat(homeOdd) * 0.9).toFixed(2) : null;

            const homeLogo =
              evt.fixture?.teams?.home?.logo ||
              evt.fixture?.home?.logo ||
              null;
            const awayLogo =
              evt.fixture?.teams?.away?.logo ||
              evt.fixture?.away?.logo ||
              null;

            return {
              id: evt.id,
              title: evt.match || `${evt.home_team} vs ${evt.away_team}`,
              home: evt.home_team,
              away: evt.away_team,
              time: timeStr,
              live: false,
              odds: {
                homeOld: homeOld,
                home: homeOdd,
                draw: drawOdd,
                away: awayOdd
              },
              league: evt.league || 'Destaque',
              homeLogo,
              awayLogo
            };
          });
          setBanners(mapped.slice(0, 3));
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

  if (loading || banners.length === 0) return null;

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
          background: linear-gradient(135deg, #020617 40%, #003b1f 100%); 
          border: 1px solid rgba(34, 197, 94, 0.5); 
          color: #fff; 
          padding: 16px 12px; 
          border-radius: 6px; 
          min-height: 180px; 
          box-shadow: 
            0 0 15px rgba(34, 197, 94, 0.2), 
            0 10px 30px rgba(0, 0, 0, 0.8); 
          transition: all 0.5s ease;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
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
          background: #020617; 
          border: 1px solid #22c55e; 
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
          background: rgba(34, 197, 94, 0.1);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
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
          {banners.map((banner, i) => (
            <div key={banner.id ?? i} className="banner"> 
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
    
              <div className="odds"> 
                <div className="odd-btn" onClick={() => handleBet(banner, '1', banner.odds.home)}> 
                  <span>1</span> 
                  <div className="odds-row">
                    {banner.odds.homeOld && ( 
                      <small className="old-odd">{banner.odds.homeOld}</small> 
                    )} 
                    <b className={banner.odds.homeOld ? "boosted" : ""}> 
                      {banner.odds.home} 
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
                  <b>{banner.odds.away}</b> 
                </div> 
              </div> 
            </div> 
          ))}
        </div>
      </section> 
    </>
  );
}
