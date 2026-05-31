import { useNavigate } from 'react-router-dom';

// Country → flag emoji map for the 48 qualified WC 2026 nations
const FLAG: Record<string, string> = {
  // Group A
  'Mexico': '🇲🇽', 'mexico': '🇲🇽',
  'South Africa': '🇿🇦', 'south africa': '🇿🇦',
  'South Korea': '🇰🇷', 'south korea': '🇰🇷',
  'Czech Republic': '🇨🇿', 'czech republic': '🇨🇿', 'Rep. Tcheca': '🇨🇿', 'czechia': '🇨🇿',
  // Group B
  'Canada': '🇨🇦',
  'Bosnia and Herzegovina': '🇧🇦', 'bosnia': '🇧🇦', 'Bosnia & Herzegovina': '🇧🇦', 'Bósnia e Herzegovina': '🇧🇦',
  // Group C
  'USA': '🇺🇸', 'United States': '🇺🇸', 'EUA': '🇺🇸',
  'Paraguay': '🇵🇾',
  // Group D
  'Brazil': '🇧🇷', 'Brasil': '🇧🇷',
  'Haiti': '🇭🇹',
  // Group E
  'Germany': '🇩🇪', 'Alemanha': '🇩🇪',
  'Japan': '🇯🇵', 'Japão': '🇯🇵',
  // Group F
  'Portugal': '🇵🇹',
  'Argentina': '🇦🇷',
  // Group G
  'Spain': '🇪🇸', 'Espanha': '🇪🇸',
  'Morocco': '🇲🇦', 'Marrocos': '🇲🇦',
  // Group H
  'France': '🇫🇷', 'França': '🇫🇷',
  'Uruguay': '🇺🇾',
  // Other qualified
  'Netherlands': '🇳🇱', 'Holanda': '🇳🇱',
  'Belgium': '🇧🇪', 'Bélgica': '🇧🇪',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Switzerland': '🇨🇭', 'Suíça': '🇨🇭',
  'Croatia': '🇭🇷', 'Croácia': '🇭🇷',
  'Senegal': '🇸🇳',
  'Ecuador': '🇪🇨',
  'Colombia': '🇨🇴',
  'Serbia': '🇷🇸',
  'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Turquia': '🇹🇷',
  'Ukraine': '🇺🇦', 'Ucrânia': '🇺🇦',
  'Australia': '🇦🇺', 'Austrália': '🇦🇺',
  'Iran': '🇮🇷',
  'Qatar': '🇶🇦',
  'Poland': '🇵🇱', 'Polónia': '🇵🇱',
  'Denmark': '🇩🇰', 'Dinamarca': '🇩🇰',
  'Austria': '🇦🇹',
  'Hungary': '🇭🇺', 'Hungria': '🇭🇺',
  'Chile': '🇨🇱',
  'Venezuela': '🇻🇪',
  'Honduras': '🇭🇳',
  'Costa Rica': '🇨🇷',
  'Jamaica': '🇯🇲',
  'Cuba': '🇨🇺',
  'Panama': '🇵🇦', 'Panamá': '🇵🇦',
  'El Salvador': '🇸🇻',
  'Trinidad and Tobago': '🇹🇹',
  'New Zealand': '🇳🇿',
  'Nigeria': '🇳🇬',
  'Ghana': '🇬🇭',
  'Cameroon': '🇨🇲', 'Camarões': '🇨🇲',
  'Egypt': '🇪🇬', 'Egito': '🇪🇬',
  'Algeria': '🇩🇿',
  'Tunisia': '🇹🇳',
  'Mali': '🇲🇱',
  'Ivory Coast': '🇨🇮', "Côte d'Ivoire": '🇨🇮',
  'Saudi Arabia': '🇸🇦',
  'Indonesia': '🇮🇩',
  'China': '🇨🇳',
  'Uzbekistan': '🇺🇿',
};

function flag(name: string) {
  return FLAG[name] || FLAG[name.toLowerCase()] || '🏳️';
}

function groupFromLeague(league: string) {
  const m = league.match(/Group\s+([A-Z])/i);
  return m ? `Grupo ${m[1].toUpperCase()}` : '';
}

interface Props {
  event: any;
}

export default function WorldCupMatchCard({ event }: Props) {
  const navigate = useNavigate();

  const home = event?.home_team || event?.teams?.home?.name || 'Casa';
  const away = event?.away_team || event?.teams?.away?.name || 'Fora';
  const league = String(event?.league?.name || event?.league || '');
  const group = groupFromLeague(league);
  const dateRaw = event?.event_date || event?.fixture?.date || '';
  const dateObj = dateRaw ? new Date(dateRaw) : null;
  const eventId = event?.id || event?.fixture?.id;

  const dateStr = dateObj
    ? dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }).toUpperCase()
    : '';
  const timeStr = dateObj
    ? dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => eventId && navigate(`/event/${eventId}`)}
      onKeyDown={(e) => e.key === 'Enter' && eventId && navigate(`/event/${eventId}`)}
      className="w-full text-left rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
      style={{
        background: 'linear-gradient(135deg, rgba(30,18,4,0.98) 0%, rgba(20,12,2,0.98) 100%)',
        border: '1px solid rgba(255,215,80,0.22)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,215,80,0.1)',
      }}
    >
      {/* Header row: date + group */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid rgba(255,215,80,0.12)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black tracking-widest text-amber-300/70 uppercase">
            {dateStr}
          </span>
          {timeStr && (
            <span className="text-[10px] font-bold text-amber-100/50">· {timeStr}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {group && (
            <span
              className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(212,151,43,0.18)',
                border: '1px solid rgba(255,215,80,0.3)',
                color: '#ffd87a',
              }}
            >
              {group}
            </span>
          )}
          <span className="text-[10px] font-bold text-amber-200/40 uppercase tracking-wide">
            🌍 Copa 2026
          </span>
        </div>
      </div>

      {/* Main row: teams + odds area */}
      <div className="flex items-center px-4 py-4 gap-3">
        {/* Home team */}
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-3xl leading-none">{flag(home)}</span>
          <span className="text-xs font-bold text-white/90 text-center leading-tight max-w-[80px]">
            {home}
          </span>
        </div>

        {/* VS divider + odds-in-breve */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div className="flex items-center gap-2">
            {/* Odds placeholders */}
            {['1', 'X', '2'].map((label) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center w-14 h-11 rounded-xl"
                style={{
                  background: 'rgba(255,215,80,0.06)',
                  border: '1px solid rgba(255,215,80,0.15)',
                }}
              >
                <span className="text-[9px] font-bold text-amber-200/40 uppercase tracking-wide leading-none mb-0.5">
                  {label}
                </span>
                <span className="text-[11px] font-black text-amber-200/30">—</span>
              </div>
            ))}
          </div>
          <span
            className="text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full"
            style={{
              background: 'rgba(212,151,43,0.15)',
              border: '1px solid rgba(255,215,80,0.25)',
              color: '#ffd060',
            }}
          >
            ⏳ Odds em breve
          </span>
        </div>

        {/* Away team */}
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <span className="text-3xl leading-none">{flag(away)}</span>
          <span className="text-xs font-bold text-white/90 text-center leading-tight max-w-[80px]">
            {away}
          </span>
        </div>
      </div>

      {/* Bottom: market chips coming soon */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderTop: '1px solid rgba(255,215,80,0.08)' }}
      >
        {['Resultado', 'Mais/Menos', 'Ambas Marcam', 'Handicap'].map((m) => (
          <span
            key={m}
            className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
