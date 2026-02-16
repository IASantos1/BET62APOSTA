
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import { apiFetch } from '../../../services/backendClient';

// ----------- Types removed for plain JavaScript compatibility -----------
// If you are using TypeScript, you can re‑add the interfaces below:
//
// interface MatchStandingsProps {
//   match: any;
// }
//
// interface StandingTeam {
//   rank: number;
//   teamId: number;
//   teamName: string;
//   teamLogo: string;
//   points: number;
//   played: number;
//   won: number;
//   draw: number;
//   lost: number;
//   goalsFor: number;
//   goalsAgainst: number;
//   goalsDiff: number;
//   form?: string;
// }
// -----------------------------------------------------------------------

const LEAGUE_IDS = {
  'Premier League': 39,
  'England Premier League': 39,
  'La Liga': 140,
  'Spain La Liga': 140,
  Bundesliga: 78,
  'Germany Bundesliga': 78,
  'Serie A': 135,
  'Italy Serie A': 135,
  'Ligue 1': 61,
  'France Ligue 1': 61,
  'Primeira Liga': 94,
  'Portugal Primeira Liga': 94,
  'Liga Portugal': 94,
  Eredivisie: 88,
  'Netherlands Eredivisie': 88,
  'Champions League': 2,
  'UEFA Champions League': 2,
  'Europa League': 3,
  'UEFA Europa League': 3,
  Championship: 40,
  'England Championship': 40,
  Brasileirão: 71,
  'Brazil Serie A': 71,
  'Liga Argentina': 128,
  'Argentina Primera Division': 128,
  'Liga MX': 262,
  MLS: 253,
  'Super Lig': 203,
  'Turkey Super Lig': 203,
  'Scottish Premiership': 179,
  'Jupiler Pro League': 144,
  'Belgian Pro League': 144,
  'Saudi Pro League': 307,
};

export default function MatchStandings({ match }) {
  const { theme } = useTheme();
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---------- Fetch league standings ----------
  const fetchStandings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Try to obtain the league id from the match object or from the mapping
      let leagueId = match.leagueId;

      if (!leagueId && match.league) {
        leagueId = LEAGUE_IDS[match.league];

        // Fallback: partial match
        if (!leagueId) {
          const leagueLower = match.league.toLowerCase();
          for (const [key, id] of Object.entries(LEAGUE_IDS)) {
            if (
              key.toLowerCase().includes(leagueLower) ||
              leagueLower.includes(key.toLowerCase())
            ) {
              leagueId = id;
              break;
            }
          }
        }
      }

      if (!leagueId) {
        console.warn('⚠️ [STANDINGS] League ID not found for:', match.league);
        setError('Classificação não disponível para esta liga');
        setLoading(false);
        return;
      }

      console.info(
        `📊 [STANDINGS] Fetching standings for league ${leagueId} (${match.league})`
      );

      const season = new Date().getFullYear();
      const dataJson = await apiFetch(`/stats/standings?sport=football&league=${leagueId}&season=${season}`, { method: 'GET' });
      if (Array.isArray(dataJson.standings) && dataJson.standings.length > 0) {
        const rawStandings = dataJson.standings;

        const formatted = rawStandings.map((team) => ({
          rank: team.rank,
          teamId: team.team.id,
          teamName: team.team.name,
          teamLogo: team.team.logo,
          points: team.points,
          played: team.all.played,
          won: team.all.win,
          draw: team.all.draw,
          lost: team.all.lose,
          goalsFor: team.all.goals.for,
          goalsAgainst: team.all.goals.against,
          goalsDiff: team.goalsDiff,
          form: team.form,
        }));

        setStandings(formatted);
        console.info(
          `✅ [STANDINGS] Loaded ${formatted.length} teams`
        );
      } else {
        console.warn('⚠️ [STANDINGS] No standings data in response');
        setError('Classificação não disponível');
      }
    } catch (err) {
      console.error('❌ [STANDINGS] Error fetching standings:', err);
      setError('Erro ao carregar classificação');
    } finally {
      setLoading(false);
    }
  }, [match.leagueId, match.league]);

  useEffect(() => {
    fetchStandings();
  }, [fetchStandings]);

  // ----------- Determine ranks for the teams playing this match -----------
  const homeTeamRank = standings.find((t) => {
    const home = match.homeTeam?.toLowerCase() ?? '';
    return (
      t.teamName.toLowerCase().includes(home.split(' ')[0]) ||
      home.includes(t.teamName.toLowerCase().split(' ')[0])
    );
  })?.rank;

  const awayTeamRank = standings.find((t) => {
    const away = match.awayTeam?.toLowerCase() ?? '';
    return (
      t.teamName.toLowerCase().includes(away.split(' ')[0]) ||
      away.includes(t.teamName.toLowerCase().split(' ')[0])
    );
  })?.rank;

  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-4">
        <div
          className={`flex items-center justify-center p-8 rounded-xl ${
            theme === 'dark' ? 'bg-gray-900/70' : 'bg-white'
          }`}
        >
          <div className="text-center">
            <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p
              className={`text-sm font-medium ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              A carregar classificação...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || standings.length === 0) {
    return (
      <div className="space-y-4">
        <div
          className={`p-8 rounded-xl text-center ${
            theme === 'dark'
              ? 'bg-gray-900/70 border border-gray-800/50'
              : 'bg-white border border-gray-200'
          }`}
        >
          <div
            className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
              theme === 'dark' ? 'bg-amber-500/10' : 'bg-amber-50'
            }`}
          >
            <i className="ri-trophy-line text-3xl text-amber-500"></i>
          </div>
          <h3
            className={`font-bold text-lg mb-2 ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            Classificação Indisponível
          </h3>
          <p
            className={`text-sm mb-4 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            {error ||
              'A classificação desta liga não está disponível de momento.'}
          </p>
          <button
            onClick={fetchStandings}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-refresh-line mr-2"></i>
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div
        className={`flex items-center justify-between p-4 rounded-xl ${
          theme === 'dark'
            ? 'bg-gray-900/70 border border-gray-800/50'
            : 'bg-white border border-gray-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 flex items-center justify-center rounded-xl ${
              theme === 'dark'
                ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                : 'bg-gradient-to-br from-amber-50 to-orange-50'
            }`}
          >
            <i className="ri-trophy-fill text-amber-500 text-xl"></i>
          </div>
          <div>
            <h3
              className={`font-bold text-sm ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
            >
              Classificação - {match.league}
            </h3>
            <p
              className={`text-[10px] ${
                theme === 'dark' ? 'text-amber-400/80' : 'text-amber-600'
              }`}
            >
              {standings.length} equipas • Temporada {new Date().getFullYear()}
            </p>
          </div>
        </div>
        <button
          onClick={fetchStandings}
          className={`p-2 rounded-lg transition-colors cursor-pointer ${
            theme === 'dark'
              ? 'hover:bg-gray-800 text-gray-400'
              : 'hover:bg-gray-100 text-gray-500'
          }`}
          title="Atualizar classificação"
        >
          <i className="ri-refresh-line text-sm"></i>
        </button>
      </div>

      {/* Standings table */}
      <div
        className={`rounded-xl border overflow-hidden ${
          theme === 'dark'
            ? 'bg-gray-900/70 border-gray-800/50'
            : 'bg-white border-gray-200'
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr
                className={theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-50'}
              >
                {[
                  '#',
                  'Equipa',
                  'J',
                  'V',
                  'E',
                  'D',
                  'GM',
                  'GS',
                  'DG',
                  'Pts',
                  'Forma',
                ].map((col) => (
                  <th
                    key={col}
                    className={`px-2 py-3 text-left font-semibold ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.map((team) => {
                const isHomeTeam = team.rank === homeTeamRank;
                const isAwayTeam = team.rank === awayTeamRank;
                const isHighlighted = isHomeTeam || isAwayTeam;

                // Zone colours
                let zoneColor = '';
                if (team.rank <= 4) zoneColor = 'border-l-2 border-l-green-500';
                else if (team.rank <= 6)
                  zoneColor = 'border-l-2 border-l-blue-500';
                else if (team.rank > standings.length - 3)
                  zoneColor = 'border-l-2 border-l-red-500';

                return (
                  <tr
                    key={team.teamId}
                    className={`
                      ${zoneColor}
                      ${isHighlighted
                        ? theme === 'dark'
                          ? 'bg-amber-500/10'
                          : 'bg-amber-50'
                        : ''}
                      ${theme === 'dark' ? 'border-gray-800' : 'border-gray-100'}
                      border-b last:border-b-0
                      transition-colors hover:${
                        theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-50'
                      }
                    `}
                  >
                    <td
                      className={`px-2 py-2.5 font-bold ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                      }`}
                    >
                      {team.rank}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <img
                          src={team.teamLogo}
                          alt={team.teamName}
                          className="w-5 h-5 object-contain"
                          onError={(e) => {
                            const target = e.currentTarget as HTMLImageElement;
                            target.src =
                              'https://cdn-icons-png.flaticon.com/512/1165/1165187.png';
                          }}
                        />
                        <span
                          className={`font-semibold truncate max-w-[120px] ${
                            isHighlighted
                              ? theme === 'dark'
                                ? 'text-amber-400'
                                : 'text-amber-600'
                              : theme === 'dark'
                              ? 'text-white'
                              : 'text-gray-900'
                          }`}
                        >
                          {team.teamName}
                        </span>
                        {isHomeTeam && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-400">
                            CASA
                          </span>
                        )}
                        {isAwayTeam && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/20 text-amber-400">
                            FORA
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center font-medium ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    >
                      {team.played}
                    </td>
                    <td className="px-2 py-2.5 text-center text-green-500 font-medium">
                      {team.won}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    >
                      {team.draw}
                    </td>
                    <td className="px-2 py-2.5 text-center text-red-500 font-medium">
                      {team.lost}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    >
                      {team.goalsFor}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    >
                      {team.goalsAgainst}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center font-medium ${
                        team.goalsDiff > 0
                          ? 'text-green-500'
                          : team.goalsDiff < 0
                          ? 'text-red-500'
                          : theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-600'
                      }`}
                    >
                      {team.goalsDiff > 0 ? '+' : ''}
                      {team.goalsDiff}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-center font-black text-sm ${
                        theme === 'dark' ? 'text-amber-400' : 'text-amber-600'
                      }`}
                    >
                      {team.points}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center gap-0.5">
                        {team.form?.split('').slice(-5).map((r, i) => (
                          <span
                            key={i}
                            className={`w-4 h-4 flex items-center justify-center rounded text-[8px] font-bold text-white ${
                              r === 'W'
                                ? 'bg-green-500'
                                : r === 'D'
                                ? 'bg-gray-500'
                                : r === 'L'
                                ? 'bg-red-500'
                                : 'bg-gray-600'
                            }`}
                          >
                            {r === 'W' ? 'V' : r === 'D' ? 'E' : r === 'L' ? 'D' : '-'}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Zones legend */}
        <div
          className={`flex flex-wrap items-center justify-center gap-4 p-4 border-t ${
            theme === 'dark'
              ? 'border-gray-800 bg-gray-900/50'
              : 'border-gray-100 bg-gray-50'
          }`}
        >
          {[
            { color: 'bg-green-500', label: 'Champions League' },
            { color: 'bg-blue-500', label: 'Europa League' },
            { color: 'bg-red-500', label: 'Zona de Descida' },
          ].map((z) => (
            <div key={z.label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-full ${z.color}`}></div>
              <span
                className={`text-[10px] font-medium ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {z.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Teams rank info */}
      {(homeTeamRank || awayTeamRank) && (
        <div
          className={`p-4 rounded-xl ${
            theme === 'dark'
              ? 'bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/20'
              : 'bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <i
              className={`ri-information-line text-sm ${
                theme === 'dark' ? 'text-amber-400' : 'text-amber-600'
              }`}
            ></i>
            <span
              className={`text-xs font-bold ${
                theme === 'dark' ? 'text-amber-400' : 'text-amber-700'
              }`}
            >
              Posição das Equipas
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            {homeTeamRank && (
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-bold ${
                    theme === 'dark' ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'
                  }`}
                >
                  {homeTeamRank}º
                </span>
                <span
                  className={`text-xs font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  {match.homeTeam}
                </span>
              </div>
            )}
            {awayTeamRank && (
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-bold ${
                    theme === 'dark' ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'
                  }`}
                >
                  {awayTeamRank}º
                </span>
                <span
                  className={`text-xs font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  {match.awayTeam}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
