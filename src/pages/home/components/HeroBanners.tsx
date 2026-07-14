
import { useState, useEffect } from 'react';
import { getCachedLogo, cacheLogo } from '../../../services/logoCache';
import { useTheme } from '../../../contexts/ThemeContext';

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  league: string;
  isLive: boolean;
  score?: { home: number; away: number };
  minute?: string;
  odds?: {
    home?: number;
    draw?: number;
    away?: number;
  };
  homeTeamLogo?: string;
  awayTeamLogo?: string;
}

interface HeroBannersProps {
  featuredMatches: Array<{ match: Match; isLive: boolean; style: any }>;
  onSelectMatch: (match: Match) => void;
  onAddSelection: (match: Match, selection: string, odd: number, market?: string) => void;
}

const TeamOfficialLogo = ({ 
  teamName, 
  teamLogo, 
  size = 'md' 
}: { 
  teamName: string; 
  teamLogo?: string;
  size?: 'sm' | 'md' | 'lg' 
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  // Carregar logo do cache ou fazer download
  useEffect(() => {
    if (!teamLogo) {
      setIsLoading(false);
      setHasError(true);
      return;
    }

    const loadLogo = async () => {
      try {
        // Tentar obter do cache primeiro
        const cached = await getCachedLogo(teamLogo);
        if (cached) {
          setCachedUrl(cached);
          setIsLoading(false);
          return;
        }

        // Se não estiver em cache, usar URL original e guardar em background
        setCachedUrl(teamLogo);
        setIsLoading(false);
        
        // Guardar no cache em background
        cacheLogo(teamLogo).then((base64) => {
          if (base64) setCachedUrl(base64);
        });
      } catch {
        setCachedUrl(teamLogo);
        setIsLoading(false);
      }
    };

    loadLogo();
  }, [teamLogo]);
  
  const showLogo = cachedUrl && !hasError;
  
  return (
    <div className={`${sizeClasses[size]} flex items-center justify-center flex-shrink-0 overflow-hidden relative`}>
      {/* Skeleton loading */}
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 animate-pulse rounded-lg" />
      )}
      
      {showLogo ? (
        <img 
          src={cachedUrl} 
          alt={teamName}
          className={`w-full h-full object-contain transition-opacity duration-300 drop-shadow-lg ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
        />
      ) : !isLoading && (
        // ✅ Fallback: ícone genérico de escudo em vez de iniciais
        <div className="w-full h-full flex items-center justify-center bg-white/10 rounded-lg backdrop-blur-sm">
          <i className="ri-shield-line text-white/60 text-lg"></i>
        </div>
      )}
    </div>
  );
};

export const HeroBanners: React.FC<HeroBannersProps> = ({ featuredMatches, onSelectMatch, onAddSelection }) => {
  const { theme } = useTheme();
  
  const handleMatchClick = (match: Match) => {
    onSelectMatch(match);
  };

  const handleOddClick = (e: React.MouseEvent, match: Match, selection: string, odd: number) => {
    e.stopPropagation();
    onAddSelection(match, selection, odd, '1X2');
  };

  return (
    <div className="relative w-full">
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide w-full">
          {featuredMatches && featuredMatches.length > 0 && featuredMatches.map((featured, index) => {
            const match = featured.match;
            const totalOdd =
              (match.odds?.home || 0) +
              (match.odds?.draw || 0) +
              (match.odds?.away || 0);

            return (
              <div
                key={match.id}
                className={`relative flex-shrink-0 w-[88vw] md:w-[360px] rounded-[28px] overflow-hidden cursor-pointer group snap-start animate-banner-entrance border ${
                  theme === 'dark'
                    ? 'bg-gray-900 border-gray-700 shadow-lg shadow-black/30'
                    : 'bg-[#f4f4f7] border-gray-200 shadow-sm'
                }`}
                style={{ animationDelay: `${index * 100}ms` }}
                onClick={() => handleMatchClick(match)}
              >
                <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
                <div className="relative flex h-full flex-col justify-between p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {match.isLive && (
                        <div className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1">
                          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-red-500">Live</span>
                        </div>
                      )}
                      <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {match.league}
                      </span>
                    </div>
                    <div className="text-right">
                      {match.isLive && match.score ? (
                        <div className={`rounded-2xl px-3 py-1 ${
                          theme === 'dark' ? 'bg-white/10 text-white' : 'bg-white text-gray-900'
                        }`}>
                          <span className="text-lg font-black">
                            {match.score.home}-{match.score.away}
                          </span>
                          {match.minute && (
                            <span className="ml-1 text-xs font-bold text-red-500">{match.minute}&apos;</span>
                          )}
                        </div>
                      ) : (
                        <span className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-500'}`}>
                          {match.minute || match.sport}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <TeamOfficialLogo
                        teamName={match.homeTeam}
                        teamLogo={match.homeTeamLogo}
                        size="md"
                      />
                      <span className={`block min-w-0 text-lg font-black truncate ${
                        theme === 'dark' ? 'text-white' : 'text-gray-900'
                      }`}>
                        {match.homeTeam}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <TeamOfficialLogo
                        teamName={match.awayTeam}
                        teamLogo={match.awayTeamLogo}
                        size="md"
                      />
                      <span className={`block min-w-0 text-lg font-bold truncate ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {match.awayTeam}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-4 gap-2">
                    {match.odds?.home ? (
                      <button
                        onClick={(e) => handleOddClick(e, match, '1', match.odds.home!)}
                        className="rounded-2xl border border-gray-200 bg-white px-2 py-2 text-center transition hover:border-red-300 hover:bg-red-50"
                      >
                        <div className="text-[11px] font-black text-gray-400">1</div>
                        <div className="text-lg font-black text-gray-900">{match.odds.home.toFixed(2)}</div>
                      </button>
                    ) : (
                      <div></div>
                    )}
                    {match.odds?.draw !== undefined && match.odds?.draw !== null ? (
                        <button
                          onClick={(e) => handleOddClick(e, match, 'X', match.odds.draw!)}
                          className="rounded-2xl border border-gray-200 bg-white px-2 py-2 text-center transition hover:border-red-300 hover:bg-red-50"
                        >
                          <div className="text-[11px] font-black text-gray-400">X</div>
                          <div className="text-lg font-black text-gray-900">{match.odds.draw.toFixed(2)}</div>
                        </button>
                    ) : (
                      <div></div>
                    )}
                    {match.odds?.away ? (
                        <button
                          onClick={(e) => handleOddClick(e, match, '2', match.odds.away!)}
                          className="rounded-2xl border border-gray-200 bg-white px-2 py-2 text-center transition hover:border-red-300 hover:bg-red-50"
                        >
                          <div className="text-[11px] font-black text-gray-400">2</div>
                          <div className="text-lg font-black text-gray-900">{match.odds.away.toFixed(2)}</div>
                        </button>
                    ) : (
                      <div></div>
                    )}
                    <div className="flex flex-col justify-between rounded-2xl bg-red-600 px-3 py-2 text-white">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/80">Total</div>
                      <div className="text-xl font-black">{totalOdd > 0 ? totalOdd.toFixed(2) : '--'}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
