import { useNavigate } from 'react-router-dom';
import { useApp } from '@/react-app/contexts/AppContext';

const FLAG: Record<string, string> = {
  'Mexico': '🇲🇽', 'South Africa': '🇿🇦', 'South Korea': '🇰🇷',
  'Czech Republic': '🇨🇿', 'Czechia': '🇨🇿',
  'Canada': '🇨🇦', 'Bosnia and Herzegovina': '🇧🇦', 'Bosnia & Herzegovina': '🇧🇦',
  'Qatar': '🇶🇦', 'Switzerland': '🇨🇭',
  'Brazil': '🇧🇷', 'Morocco': '🇲🇦', 'Haiti': '🇭🇹', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'USA': '🇺🇸', 'United States': '🇺🇸', 'Paraguay': '🇵🇾',
  'Australia': '🇦🇺', 'Türkiye': '🇹🇷', 'Turkey': '🇹🇷',
  'Germany': '🇩🇪', "Curaçao": '🇨🇼', "Côte d'Ivoire": '🇨🇮', 'Ecuador': '🇪🇨',
  'Netherlands': '🇳🇱', 'Japan': '🇯🇵', 'Sweden': '🇸🇪', 'Tunisia': '🇹🇳',
  'Belgium': '🇧🇪', 'Egypt': '🇪🇬', 'Iran': '🇮🇷', 'New Zealand': '🇳🇿',
  'Spain': '🇪🇸', 'Cabo Verde': '🇨🇻', 'Saudi Arabia': '🇸🇦', 'Uruguay': '🇺🇾',
  'France': '🇫🇷', 'Senegal': '🇸🇳', 'Iraq': '🇮🇶', 'Norway': '🇳🇴',
  'Argentina': '🇦🇷', 'Algeria': '🇩🇿', 'Austria': '🇦🇹', 'Jordan': '🇯🇴',
  'Portugal': '🇵🇹', 'DR Congo': '🇨🇩', 'Uzbekistan': '🇺🇿', 'Colombia': '🇨🇴',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Croatia': '🇭🇷', 'Ghana': '🇬🇭', 'Panama': '🇵🇦',
};

const TEAM_BANNER: Record<string, string> = {
  'belgium': '/teams/belgium.jpeg',
  'bélgica': '/teams/belgium.jpeg',
  'egypt': '/teams/egypt.jpeg',
  'egito': '/teams/egypt.jpeg',
  'iran': '/teams/iran.jpeg',
  'irão': '/teams/iran.jpeg',
  'new zealand': '/teams/new-zealand.jpeg',
  'nova zelândia': '/teams/new-zealand.jpeg',
  'all whites': '/teams/new-zealand.jpeg',
  'cape verde': '/teams/cape-verde.jpeg',
  'cabo verde': '/teams/cape-verde.jpeg',
  'saudi arabia': '/teams/saudi-arabia.jpeg',
  'arábia saudita': '/teams/saudi-arabia.jpeg',
  'ksa': '/teams/saudi-arabia.jpeg',
  'uruguay': '/teams/uruguay.jpeg',
  'uruguai': '/teams/uruguay.jpeg',
  'france': '/teams/france.jpeg',
  'frança': '/teams/france.jpeg',
  'iraq': '/teams/iraq.jpeg',
  'iraque': '/teams/iraq.jpeg',
  'norway': '/teams/norway.jpeg',
  'noruega': '/teams/norway.jpeg',
  'senegal': '/teams/senegal.jpeg',
  'turkey': '/teams/turkey.jpeg',
  'türkiye': '/teams/turkey.jpeg',
  'turquia': '/teams/turkey.jpeg',
  'germany': '/teams/germany.jpeg',
  'alemanha': '/teams/germany.jpeg',
  "ivory coast": '/teams/ivory-coast.jpeg',
  "côte d'ivoire": '/teams/ivory-coast.jpeg',
  "cote d'ivoire": '/teams/ivory-coast.jpeg',
  'costa do marfim': '/teams/ivory-coast.jpeg',
  'curaçao': '/teams/curacao.jpeg',
  'curacao': '/teams/curacao.jpeg',
  'ecuador': '/teams/ecuador.jpeg',
  'equador': '/teams/ecuador.jpeg',
  'japan': '/teams/japan.jpeg',
  'japão': '/teams/japan.jpeg',
  'netherlands': '/teams/netherlands.jpeg',
  'holanda': '/teams/netherlands.jpeg',
  'países baixos': '/teams/netherlands.jpeg',
  'sweden': '/teams/sweden.jpeg',
  'suécia': '/teams/sweden.jpeg',
  'tunisia': '/teams/tunisia.jpeg',
  'tunísia': '/teams/tunisia.jpeg',
};

function getTeamBanner(teamName: string): string | null {
  if (!teamName) return null;
  const n = teamName.toLowerCase().trim();
  if (TEAM_BANNER[n]) return TEAM_BANNER[n];
  for (const [key, val] of Object.entries(TEAM_BANNER)) {
    if (n.includes(key) || key.includes(n)) return val;
  }
  return null;
}

function flag(name: string) {
  if (!name) return '🏳️';
  return FLAG[name] || FLAG[name.toLowerCase()] || '🏳️';
}

function groupFromLeague(league: string) {
  const m = league.match(/Group\s+([A-L])/i);
  return m ? `Grupo ${m[1].toUpperCase()}` : '';
}

interface Props {
  event: any;
}

export default function WorldCupMatchCard({ event }: Props) {
  const navigate = useNavigate();
  const { betSlip, addToBetSlip, addNotification } = useApp();

  const home = event?.home_team || event?.teams?.home?.name || 'Casa';
  const away = event?.away_team || event?.teams?.away?.name || 'Fora';
  const league = String(event?.league?.name || event?.league || '');
  const group = groupFromLeague(league);
  const dateRaw = event?.event_date || event?.fixture?.date || '';
  const dateObj = dateRaw ? new Date(dateRaw) : null;
  const eventId = String(event?.id || event?.fixture?.id || '');

  const homeOdd = Number(event?.home_odd || 0);
  const drawOdd = Number(event?.draw_odd || 0);
  const awayOdd = Number(event?.away_odd || 0);
  const hasOdds = homeOdd > 1.01 && awayOdd > 1.01;

  const dateStr = dateObj
    ? dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }).toUpperCase()
    : '';
  const timeStr = dateObj
    ? dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : '';

  const homeBanner = getTeamBanner(home);
  const homeFlag = flag(home);
  const awayFlag = flag(away);

  const isActive = (sel: string) =>
    betSlip.some((b) => b.event_id === eventId && b.selection === sel);

  const handleBet = (e: React.MouseEvent, label: string, selKey: string, odd: number) => {
    e.stopPropagation();
    if (!eventId || odd <= 1.01) return;
    const idStr = `ev-${eventId}-${selKey}`;
    addToBetSlip({
      id: idStr,
      event_id: eventId,
      match: `${home} vs ${away}`,
      selection: selKey,
      market: 'Resultado Final',
      odd,
      stake: 0,
      league: typeof league === 'string' ? league : '',
      sport: 'soccer',
      suspended: false,
      market_suspended: false,
    } as any);
    addNotification({ type: 'success', message: `${label} @ ${odd.toFixed(2)} adicionado!` });
  };

  const OddsBtn = ({
    label,
    selKey,
    odd,
  }: {
    label: string;
    selKey: string;
    odd: number;
  }) => {
    const active = isActive(selKey);
    return (
      <button
        type="button"
        onClick={(e) => handleBet(e, label, selKey, odd)}
        className="flex flex-col items-center justify-center w-[54px] h-[48px] rounded-xl transition-all active:scale-95"
        style={{
          background: active
            ? 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)'
            : 'rgba(255,215,80,0.09)',
          border: active
            ? '1px solid rgba(220,38,38,0.8)'
            : '1px solid rgba(255,215,80,0.24)',
          boxShadow: active ? '0 0 14px rgba(220,38,38,0.45)' : 'none',
        }}
      >
        <span className="text-[9px] font-bold text-amber-200/50 uppercase leading-none mb-0.5">
          {label}
        </span>
        <span
          className="text-sm font-black leading-none tabular-nums"
          style={{ color: active ? '#fff' : '#ffd060' }}
        >
          {odd.toFixed(2)}
        </span>
      </button>
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => eventId && navigate(`/event/${eventId}`)}
      onKeyDown={(e) => e.key === 'Enter' && eventId && navigate(`/event/${eventId}`)}
      className="w-full text-left rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
      style={{
        background: 'linear-gradient(135deg, rgba(26,14,2,0.99) 0%, rgba(14,7,0,0.99) 100%)',
        border: '1px solid rgba(255,215,80,0.20)',
        boxShadow: '0 4px 22px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,215,80,0.09)',
      }}
    >
      {/* ── Home team player banner ── */}
      {homeBanner && (
        <div
          className="relative w-full overflow-hidden"
          style={{ height: 148, pointerEvents: 'none' }}
        >
          <img
            src={homeBanner}
            alt={home}
            draggable={false}
            className="w-full h-full object-cover object-top select-none"
            style={{ objectPosition: 'center 20%' }}
          />
          {/* gradient fade bottom → transparent so card blends in */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.10) 55%, rgba(14,7,0,0.97) 100%)',
            }}
          />
          {/* gold top shimmer line */}
          <div
            className="absolute top-0 left-0 right-0"
            style={{
              height: 1.5,
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,215,80,0.55) 30%, rgba(255,225,80,0.95) 50%, rgba(255,215,80,0.55) 70%, transparent 100%)',
              boxShadow: '0 0 10px 3px rgba(255,200,40,0.35)',
            }}
          />
          {/* team name + flag overlay bottom-left */}
          <div className="absolute bottom-3 left-4 flex items-center gap-2">
            <span className="text-2xl leading-none drop-shadow-lg">{homeFlag}</span>
            <span
              className="text-sm font-black uppercase tracking-wide text-white drop-shadow-lg"
              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.9)' }}
            >
              {home}
            </span>
          </div>
          {/* "CASA" badge top-right */}
          <div className="absolute top-3 right-3">
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(255,215,80,0.18)',
                border: '1px solid rgba(255,215,80,0.40)',
                color: '#ffd060',
                backdropFilter: 'blur(4px)',
              }}
            >
              Casa
            </span>
          </div>
        </div>
      )}

      {/* Header row */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid rgba(255,215,80,0.09)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black tracking-widest text-amber-300/65 uppercase">
            {dateStr}
          </span>
          {timeStr && (
            <span className="text-[10px] font-bold text-amber-100/40">· {timeStr}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {group && (
            <span
              className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(212,151,43,0.15)',
                border: '1px solid rgba(255,215,80,0.28)',
                color: '#ffd87a',
              }}
            >
              {group}
            </span>
          )}
          <span className="text-[10px] font-bold text-amber-200/30 uppercase tracking-wide">
            🌍 Copa 2026
          </span>
        </div>
      </div>

      {/* Main: teams + odds */}
      <div className="flex items-center px-4 py-4 gap-3">
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-3xl leading-none">{homeFlag}</span>
          <span className="text-xs font-bold text-white/90 text-center leading-tight max-w-[80px]">
            {home}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2 shrink-0">
          {hasOdds ? (
            <div className="flex items-center gap-1.5">
              <OddsBtn label="1" selKey="Home" odd={homeOdd} />
              {drawOdd > 1.01 && <OddsBtn label="X" selKey="Draw" odd={drawOdd} />}
              <OddsBtn label="2" selKey="Away" odd={awayOdd} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                {['1', 'X', '2'].map((l) => (
                  <div
                    key={l}
                    className="flex flex-col items-center justify-center w-[54px] h-[48px] rounded-xl"
                    style={{
                      background: 'rgba(255,215,80,0.04)',
                      border: '1px solid rgba(255,215,80,0.10)',
                    }}
                  >
                    <span className="text-[9px] font-bold text-amber-200/25 uppercase leading-none mb-0.5">
                      {l}
                    </span>
                    <span className="text-sm font-black text-amber-200/18 leading-none">—</span>
                  </div>
                ))}
              </div>
              <span
                className="text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full"
                style={{
                  background: 'rgba(212,151,43,0.10)',
                  border: '1px solid rgba(255,215,80,0.18)',
                  color: '#ffd060',
                }}
              >
                ⏳ Odds em breve
              </span>
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-3xl leading-none">{awayFlag}</span>
          <span className="text-xs font-bold text-white/90 text-center leading-tight max-w-[80px]">
            {away}
          </span>
        </div>
      </div>

      {/* Bottom chips */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderTop: '1px solid rgba(255,215,80,0.06)' }}
      >
        {['Resultado', 'Mais/Menos', 'Ambas Marcam'].map((m) => (
          <span
            key={m}
            className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.25)',
            }}
          >
            {m}
          </span>
        ))}
        {hasOdds && (
          <span
            className="ml-auto text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(34,197,94,0.10)',
              border: '1px solid rgba(34,197,94,0.28)',
              color: '#4ade80',
            }}
          >
            ✓ Odds disponíveis
          </span>
        )}
      </div>
    </div>
  );
}
