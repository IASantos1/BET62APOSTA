import dayjs from "dayjs";
import { Env } from "../../shared/types";
import { applyHomeAdvantage } from "../utils/normalizeOdds";

// ================= CONFIG =================

const API_FOOTBALL_URL = "https://v3.football.api-sports.io/fixtures";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports";

export const API_SPORTS_CONFIG: Record<string, { url: string, type: 'fixture' | 'game' | 'fight' | 'race' }> = {
    soccer: { url: "https://v3.football.api-sports.io/fixtures", type: 'fixture' },
    basketball: { url: "https://v1.basketball.api-sports.io/games", type: 'game' },
    baseball: { url: "https://v1.baseball.api-sports.io/games", type: 'game' },
    "american-football": { url: "https://v1.american-football.api-sports.io/games", type: 'game' },
    hockey: { url: "https://v1.hockey.api-sports.io/games", type: 'game' },
    "ice-hockey": { url: "https://v1.hockey.api-sports.io/games", type: 'game' },
    rugby: { url: "https://v1.rugby.api-sports.io/games", type: 'game' },
    volleyball: { url: "https://v1.volleyball.api-sports.io/games", type: 'game' },
    handball: { url: "https://v1.handball.api-sports.io/games", type: 'game' },
    mma: { url: "https://v1.mma.api-sports.io/fights", type: 'fight' },
    futsal: { url: "https://v1.futsal.api-sports.io/games", type: 'game' },
    "formula-1": { url: "https://v1.formula-1.api-sports.io/races", type: 'race' },
    "aussie-rules": { url: "https://v1.aussie-rules.api-sports.io/games", type: 'game' },
    boxing: { url: "https://v1.boxing.api-sports.io/games", type: 'game' }
};

export const SPORT_PARAM_TO_CONFIG: Record<string, string> = {
    soccer: "soccer",
    "soccer-all": "soccer",
    todos: "soccer",
    football: "soccer",
    futebol: "soccer",
    basketball: "basketball",
    basquetebol: "basketball",
    nba: "basketball",
    baseball: "baseball",
    beisebol: "baseball",
    "american-football": "american-football",
    nfl: "american-football",
    ncaaf: "american-football",
    ncaa: "american-football",
    "futebol americano": "american-football",
    hockey: "hockey",
    "ice-hockey": "hockey",
    nhl: "hockey",
    voleibol: "volleyball",
    volleyball: "volleyball",
    handebol: "handball",
    handball: "handball",
    rugby: "rugby",
    rúgbi: "rugby",
    mma: "mma",
    formula1: "formula-1",
    "formula-1": "formula-1",
    "fórmula 1": "formula-1",
    afl: "aussie-rules",
    "aussie-rules": "aussie-rules"
};

// 0️⃣ Sport Mappings (User Request -> Keywords)
const WANTED_SPORTS = [
    'aussie_rules', // AFL
    'basketball',   // Basquetebol
    'baseball',     // Beisebol
    'motor_sport',  // Fórmula 1 (check specific key)
    'soccer',       // Futebol
    'americanfootball', // Futebol Americano
    'handball',     // Handebol
    'icehockey',    // Hóquei
    'mma',          // MMA
    'rugby',        // Rúgbi
    'tennis',       // Ténis
    'volleyball',   // Voleibol
    'boxing',       // Boxe
    'futsal'        // Futsal
];

// 4️⃣ Tabela de equivalência (Simple In-Memory)
const TEAM_ALIASES: Record<string, string[]> = {
  "manchester city": ["man city", "manchester city fc", "manchester city"],
  "manchester united": ["man utd", "manchester united fc", "man united"],
  "arsenal": ["arsenal fc", "arsenal"],
  "chelsea": ["chelsea fc", "chelsea"],
  "liverpool": ["liverpool fc", "liverpool"],
  "tottenham hotspur": ["tottenham", "spurs", "tottenham hotspur fc"],
  "newcastle united": ["newcastle", "newcastle utd"],
};

// ================= UTILIDADES =================

function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/\./g, "") // Remove dots (F.C. -> FC)
    .replace(/'/g, "")  // Remove apostrophes
    .replace(/\b(fc|cf|sc|ac|afc|ec|cd|bc|vc|hc|club|volei|voley|volley|handball|basket|hockey)\b/g, "") // Remove suffixes
    .replace(/\b(utd)\b/g, "united") // Standardize Utd -> United
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .trim()
    .replace(/\s+/g, " "); // Remove double spaces
}

function getCanonicalName(rawName: string): string {
  const normalized = normalizeText(rawName);
  
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(normalized) || canonical === normalized) {
      return canonical;
    }
  }
  
  return normalized;
}

function filterSmallLeagues(fixtures: any[]): any[] {
    if (!fixtures || fixtures.length === 0) return [];

    const EXCLUDE_KEYWORDS = [
        'U19', 'U20', 'U21', 'U23', 'U17', 
        'Reserve', 'Reserves', 'Amateur', 
        'Regional', 'Oberliga', 'Landesliga', 
        'Youth', 'Juniors', 'Universiade',
        'Copa Sao Paulo de Juniores',
        'women', 'feminin', 'femenino', 'ladies', 'mulheres', 'woman', 'wnba', 'wta'
    ];
    
    // Whitelist specific leagues to ensure they are NOT filtered even if they match keywords
    const KEEP_LEAGUES = [
       'Top 10', 'top10', 'Elite 1', 'elite1', 'Premier 15s', 'premiership', 'championship',
       'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Brasileirão', 'Copa do Brasil', 'Champions League', 'Libertadores', 'Sudamericana',
       'U20', 'Concacaf', 'concacaf'
    ];

    return fixtures.filter(f => {
         const leagueObj = f.league_obj || f.league;
         const name = (leagueObj?.name || '').trim();
         
         // Check keep list
         if (KEEP_LEAGUES.some(k => name.toLowerCase().includes(k.toLowerCase()))) return true;
         
         // Check exclude list
         if (EXCLUDE_KEYWORDS.some(k => name.toLowerCase().includes(k.toLowerCase()))) return false;
         
         return true;
     });
}

// ================= NORMALIZAÇÃO =================

const DEFAULT_LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDIyczgtNC41IDgtMTJWMzUwbC04LTVsLTggNVYxMHw4IDQuNSA4IDEyeiIvPjwvc3ZnPg==";

function ensureHttps(url: string): string {
    if (!url) return DEFAULT_LOGO;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    return url;
}

function normalizeApiSportsMatch(item: any, sport: string) {
  const isFixture = API_SPORTS_CONFIG[sport]?.type === 'fixture';
  const mainObj = isFixture ? item.fixture : item;

  const rawId = isFixture ? item.fixture?.id : item.id;
  // PREFIX ID to avoid collision between sports (e.g. soccer_100 vs basketball_100)
  // const id = `${sport}_${rawId}`; // MOVED BELOW to allow sport override

  const date = isFixture ? item.fixture?.date : (item.date || item.timestamp);
  const status = isFixture ? item.fixture?.status : item.status;
  
  let teamsObj = item.teams;
  if (!teamsObj) {
      if (item.competitors) {
          teamsObj = {
              home: item.competitors.find((c:any) => c.qualifier === 'home' || c.home),
              away: item.competitors.find((c:any) => c.qualifier === 'away' || c.away)
          };
      } else {
          teamsObj = { home: null, away: null };
      }
  }

  const homeRaw = teamsObj.home?.name || teamsObj.home;
  const awayRaw = teamsObj.away?.name || teamsObj.away;

  const hRawLower = (homeRaw || '').toLowerCase().trim();
  const aRawLower = (awayRaw || '').toLowerCase().trim();
    
  if (!homeRaw || !awayRaw || hRawLower === '' || aRawLower === '') {
       return null;
  }
    
  if (hRawLower.includes('home team') || hRawLower === 'home' || aRawLower.includes('away team') || aRawLower === 'away') {
       return null; 
   }

  const homeCanonical = getCanonicalName(homeRaw || '');
  const awayCanonical = getCanonicalName(awayRaw || '');

  // FIX: Detect Kazakh Hockey misclassified as Soccer
  const leagueNameRaw = isFixture ? (item.league ? item.league.name : undefined) : (item.league ? item.league.name : undefined) || sport;
  const lNameLower = String(leagueNameRaw || '').toLowerCase();
  if (sport === 'soccer' && (lNameLower.includes('kazakhstan') || lNameLower === 'championship')) {
       const kazakhTeams = ['torpedo', 'aktobe', 'karaganda', 'kokshetau', 'pavlodar', 'almaty', 'gornyak', 'nomad', 'beibarys', 'kulager', 'saryarka', 'arlan', 'irtysh', 'rudny', 'astana'];
       if (kazakhTeams.some(t => hRawLower.includes(t) || aRawLower.includes(t))) {
            sport = 'hockey'; // Override sport to correct one
       }
  }

  // PREFIX ID to avoid collision between sports (e.g. soccer_100 vs basketball_100)
  // Re-calculate ID if sport changed
  const id = `${sport}_${rawId}`;

  // DEBUG: Check if we are extracting league/season correctly for non-soccer
  if (sport !== 'soccer' && (!isFixture ? !item.league?.id : !item.league?.id)) {
      // console.log(`[RobustDebug] Missing league info for ${sport} event ${id}`);
  }

  return {
    id: id,
    fixture_id: id,
    kickoff: date,
    status: status,
    venue: isFixture ? item.fixture?.venue : { name: 'Unknown' },
    league_obj: {
        name: isFixture ? item.league?.name : item.league?.name || sport,
        country: isFixture ? item.league?.country : item.country?.name || '',
        logo: ensureHttps(isFixture ? item.league?.logo : item.league?.logo || ''),
        flag: ensureHttps(isFixture ? item.league?.flag : item.country?.flag || '')
    },
    league_id: isFixture ? item.league?.id : item.league?.id,
    season: isFixture ? item.league?.season : item.league?.season,
    teams: {
      home: {
        name: homeRaw,
        canonical: homeCanonical,
        logo: ensureHttps(teamsObj.home?.logo || '')
      },
      away: {
        name: awayRaw,
        canonical: awayCanonical,
        logo: ensureHttps(teamsObj.away?.logo || '')
      }
    },
    sport_key: sport
  };
}

function transformBookmakersToMarkets(bookmakers: any[], homeTeamName: string, awayTeamName: string) {
    const markets: any = {};
    if (!bookmakers || !Array.isArray(bookmakers)) return [];

    bookmakers.forEach((b: any) => {
        // Support both API-Sports (bets) and The Odds API (markets)
        const marketsList = b.markets || b.bets || [];
        
        marketsList.forEach((m: any) => {
            // Normalize key
            let key = m.key;
            if (!key && m.name) {
                // Convert API-Sports market name to key
                if (m.name === 'Match Winner' || m.name === '1x2' || m.name === 'Money Line') key = 'h2h';
                else if (m.name.includes('Goals Over/Under') || m.name.includes('Total')) key = 'totals';
                else if (m.name.includes('Handicap')) key = 'spreads';
                else key = 'other'; 
            }

            // Normalize outcomes
            let outcomes = m.outcomes || m.values || [];
            // API-Sports: { value: "Home", odd: "1.50" } -> TOA: { name: "Home", price: 1.50 }
            if (m.values) {
                outcomes = m.values.map((v: any) => ({
                    name: v.value,
                    price: v.odd,
                    ...v
                }));
            }

            if (key === 'h2h') {
                const mappedOutcomes = outcomes.map((o: any) => {
                    let outcomeId = o.name;
                    const nOutcome = normalizeText(o.name);
                    const nHome = normalizeText(homeTeamName || '');
                    const nAway = normalizeText(awayTeamName || '');

                    if (nHome && nOutcome === nHome) outcomeId = '1';
                    else if (nAway && nOutcome === nAway) outcomeId = '2';
                    else if (o.name === 'Draw' || o.name.toLowerCase() === 'draw') outcomeId = 'X';

                    return {
                        id: outcomeId,
                        name: outcomeId,
                        outcome: outcomeId,
                        label: o.name,
                        price: Number(o.price),
                        value: Number(o.price),
                        odd: Number(o.price)
                    };
                });

                // Apply Home Advantage (Mando de Campo)
                try {
                    const home = mappedOutcomes.find((o:any) => o.id === '1' || o.id === 'Home');
                    const draw = mappedOutcomes.find((o:any) => o.id === 'X' || o.id === 'Draw');
                    const away = mappedOutcomes.find((o:any) => o.id === '2' || o.id === 'Away');

                    if (home && away) {
                        const oddsObj: any = { home: home.price, away: away.price };
                        if (draw) oddsObj.draw = draw.price;

                        const newOdds = applyHomeAdvantage(oddsObj);
                        
                        if (home) { home.price = newOdds.home; home.value = newOdds.home; home.odd = newOdds.home; }
                        if (away) { away.price = newOdds.away; away.value = newOdds.away; away.odd = newOdds.away; }
                        if (draw && newOdds.draw) { draw.price = newOdds.draw; draw.value = newOdds.draw; draw.odd = newOdds.draw; }
                    }
                } catch (e) {
                    // ignore error, keep original odds
                }

                markets.h2h = mappedOutcomes;
            } 
            else if (m.key === 'totals') {
                 if (!markets.totals) markets.totals = [];
                 m.outcomes.forEach((o: any) => {
                     markets.totals.push({
                          id: o.name + ' ' + o.point,
                          name: o.name,
                          label: o.name + ' ' + o.point,
                          price: o.price,
                          value: o.point,
                          odd: o.price
                     });
                 });
            }
            else if (m.key === 'spreads') {
                 if (!markets.spreads) markets.spreads = [];
                 m.outcomes.forEach((o: any) => {
                     markets.spreads.push({
                          id: o.name + ' ' + o.point,
                          name: o.name,
                          label: o.name + ' ' + o.point,
                          price: o.price,
                          value: o.point,
                          odd: o.price
                     });
                 });
            }
        });
    });

    // Convert object to array for Frontend: [{ key: 'h2h', outcomes: [...] }, ...]
    return Object.keys(markets).map(k => ({
        key: k,
        outcomes: markets[k]
    }));
}

function canonicalApiSportsMarketKey(rawName: string, sport: string) {
    const s = String(rawName || '').toLowerCase().trim();
    if (!s) return 'other';
    if (s === '1x2' || s === 'match result') return 'h2h';
    if (s.includes('winner') || s.includes('moneyline') || s.includes('money line') || s.includes('home/away')) return 'h2h';
    if (s.includes('both teams') && s.includes('score')) return 'btts';
    if (s.includes('draw no bet') || s === 'dnb' || s.includes('no draw')) return 'dnb';
    if (s.includes('double chance')) return 'double_chance';
    if (s.includes('correct score')) return 'correct_score';
    if (s.includes('handicap')) return 'spreads';
    if (s.includes('race to')) return 'race_to';
    if (s.includes('next goal') || s.includes('first goal') || s.includes('last goal')) return 'next_goal';
    if (s.includes('corners')) return 'corners_total';
    if (s.includes('cards')) return 'cards_total';
    if (s.includes('total') || s.includes('over/under') || s.includes('over under') || s.includes('totals')) return 'totals';
    if (s.includes('player') && s.includes('points')) return 'player_points';
    if (s.includes('player') && s.includes('rebounds')) return 'player_rebounds';
    if (s.includes('player') && s.includes('assists')) return 'player_assists';
    if (s.includes('pra') || s.includes('points + rebounds + assists')) return 'player_pra';
    if (s.includes('double double')) return 'double_double';
    if (s.includes('triple double')) return 'triple_double';
    if (s.includes('team total')) return 'team_totals';
    if (s.includes('first half') || s.includes('1st half') || s.includes('half time')) return 'period_result_1h';
    if (s.includes('second half') || s.includes('2nd half')) return 'period_result_2h';
    if (s.includes('quarter') || s.includes('q1') || s.includes('q2') || s.includes('q3') || s.includes('q4')) return 'period_result_quarter';
    if (s.includes('sets') || s.includes('set ')) return 'sets_market';
    if (s.includes('innings')) return 'innings_market';
    if (s.includes('top 3') || s.includes('top3')) return 'f1_top3';
    if (s.includes('top 6') || s.includes('top6')) return 'f1_top6';
    if (s.includes('top 10') || s.includes('top10')) return 'f1_top10';
    if (s.includes('fastest lap') || s.includes('fastest')) return 'f1_fastest_lap';
    if (s.includes('safety car')) return 'f1_safety_car';
    return s.replace(/\s+/g, '_');
}

function normalizeOddsMatch(odd: any) {
    return {
        id: odd.id,
        kickoff: odd.commence_time,
        fixture: {
            id: odd.id,
            status: { short: 'NS', long: 'Not Started', elapsed: null },
            date: odd.commence_time,
            timestamp: dayjs(odd.commence_time).unix()
        },
        league: {
            name: odd.sport_title,
            country: '',
            logo: '',
            flag: ''
        },
        teams: {
            home: { name: odd.home_team, id: 0, logo: '' },
            away: { name: odd.away_team, id: 0, logo: '' },
            home_raw: odd.home_team,
            away_raw: odd.away_team
        },
        goals: { home: null, away: null },
        odds: odd.bookmakers,
        markets: transformBookmakersToMarkets(odd.bookmakers, odd.home_team, odd.away_team),
        
        // Flattened
        home_team: odd.home_team,
        away_team: odd.away_team,
        event_date: odd.commence_time,
        sport: odd.sport_key,
        sport_key: odd.sport_key,
        league_name: odd.sport_title,
        
        has_odds: true,
        source: 'odds_api_direct',
        last_updated: new Date().toISOString()
    };
}

// ================= MATCHING =================

function matchOddsToFixture(fixtures: any[], odds: any[], sportKey: string, debugLog?: string[]) {
  const results = [];

  for (const fixture of fixtures) {
    let bestMatch = null;

    for (const odd of odds) {
      // 1. Exact canonical match
      // ... (existing logic) ...
      const sameTeams =
        fixture.teams.home.canonical === odd.teams.home_raw || 
        fixture.teams.home.canonical === getCanonicalName(odd.teams.home_raw);

      const sameTeams2 = 
        fixture.teams.away.canonical === getCanonicalName(odd.teams.away_raw);

      // Relaxed logic: check if name contains
      const hRaw = fixture.teams.home.canonical;
      const oHome = getCanonicalName(odd.teams.home_raw);
      
      const matchHome = hRaw === oHome || hRaw.includes(oHome) || oHome.includes(hRaw);
      
      const aRaw = fixture.teams.away.canonical;
      const oAway = getCanonicalName(odd.teams.away_raw);

      const matchAway = aRaw === oAway || aRaw.includes(oAway) || oAway.includes(aRaw);

              // 3. Last Word Match (US Sports: "Lakers" vs "Los Angeles Lakers")
              // Only apply if the sport is typically US-centric or team names are long
              let matchHomeLazy = false;
              let matchAwayLazy = false;
              
              if (!matchHome) {
                  const hParts = hRaw.split(' ');
                  const oHomeParts = oHome.split(' ');
                  if (hParts.length > 0 && oHomeParts.length > 0) {
                      const hLast = hParts[hParts.length - 1];
                      const oHomeLast = oHomeParts[oHomeParts.length - 1];
                      if (hLast.length > 3 && hLast === oHomeLast) matchHomeLazy = true;
                  }
              }

              if (!matchAway) {
                  const aParts = aRaw.split(' ');
                  const oAwayParts = oAway.split(' ');
                  if (aParts.length > 0 && oAwayParts.length > 0) {
                      const aLast = aParts[aParts.length - 1];
                      const oAwayLast = oAwayParts[oAwayParts.length - 1];
                      if (aLast.length > 3 && aLast === oAwayLast) matchAwayLazy = true;
                  }
              }

              const timeDiff = Math.abs(dayjs(fixture.kickoff).diff(dayjs(odd.kickoff), "minute"));
              const sameTime = timeDiff <= 1440; 

              // Debug specific teams
              if (debugLog && (hRaw.includes('parma') || hRaw.includes('juventus') || aRaw.includes('parma') || aRaw.includes('juventus'))) {
          const hPartial = hRaw === oHome || hRaw.includes(oHome) || oHome.includes(hRaw);
          const aPartial = aRaw === oAway || aRaw.includes(oAway) || oAway.includes(aRaw);
          
          if (hPartial || aPartial) {
              debugLog.push(`[RobustMatchDebug] Partial Match for ${hRaw}/${aRaw} vs ${oHome}/${oAway}`);
              debugLog.push(`[RobustMatchDebug] Result: matchHome=${matchHome} matchAway=${matchAway} sameTime=${sameTime} (diff=${timeDiff})`);
          }
      }
      
      // General Debug for non-matches (if debugLog is present and it's a potential match)
              if (debugLog && sameTime && (matchHome || matchAway || matchHomeLazy || matchAwayLazy)) {
                   // debugLog.push(`[MatchAttempt] ${hRaw} vs ${aRaw} (Fixture) <=> ${oHome} vs ${oAway} (Odd) | H:${matchHome} A:${matchAway} T:${timeDiff}min`);
              }

              if ((matchHome || matchHomeLazy) && (matchAway || matchAwayLazy) && sameTime) {
                bestMatch = odd;
                break; 
              }
    }

    const finalHome = fixture.teams.home.name || (bestMatch ? bestMatch.teams.home_raw : '');
    const finalAway = fixture.teams.away.name || (bestMatch ? bestMatch.teams.away_raw : '');
    
    if (!finalHome || !finalAway || finalHome.trim() === '' || finalAway.trim() === '') {
         continue;
    }
    
    // Merge
    const merged: any = {
        ...fixture,
        home_team: finalHome,
        away_team: finalAway,
        league_name: fixture.league_obj.name,
        sport: sportKey,
        sport_key: sportKey, // Explicitly add sport_key for EventSync
        has_odds: !!bestMatch,
        source: bestMatch ? 'hybrid' : 'api-sports',
        updated_at: new Date().toISOString()
    };
    
    if (bestMatch) {
        // Fix: If bestMatch is from API-Sports, it has 'bookmakers' but no 'markets'.
        // We need to generate markets using the fixture's team names.
        if (!bestMatch.markets && bestMatch.bookmakers) {
             const hName = fixture.teams.home.name;
             const aName = fixture.teams.away.name;
             // transformBookmakersToMarkets applies Home Advantage internally
             bestMatch.markets = transformBookmakersToMarkets(bestMatch.bookmakers, hName, aName);
        }

        merged.markets = bestMatch.markets;
        merged.odds = bestMatch.odds;
        merged.payload = JSON.stringify({ ...merged, ...bestMatch }); // Store full details
    } else {
        merged.markets = [];
        merged.payload = JSON.stringify(merged);
    }
    
    results.push(merged);
  }
  
  return results;
}

function convertOddsToGenericMatch(odd: any, sport: any) {
    // Helper for generic sports
    return {
        ...odd,
        league_name: sport.title,
        sport: sport.key
    };
}

export async function fetchApiSportsOddsForFixtures(apiKey: string, sport: string, fixtures: any[], log: (msg: string) => void = console.log) {
    log(`[RobustDebug] fetchApiSportsOddsForFixtures called for ${sport} with ${fixtures.length} fixtures`);
    if (fixtures.length > 0) {
        log(`[RobustDebug] Sample Fixture 0: ID=${fixtures[0].id} LeagueID=${fixtures[0].league_id} Season=${fixtures[0].season}`);
    }

    const config = API_SPORTS_CONFIG[sport];
    if (!config) {
        log(`[RobustDebug] No config for ${sport}`);
        return [];
    }
    
    const baseUrl = config.url.replace('/games', '/odds').replace('/fixtures', '/odds').replace('/races', '/odds').replace('/fights', '/odds');
    
    let allOdds: any[] = [];
    
    // Strategy: 
    // - Soccer/Boxing/MMA: Fetch odds BY FIXTURE (fixture=ID / game=ID / fight=ID)
    // - Others: Fetch by League/Season (API V1 usually doesn't support date filtering for odds)
    
    if (sport === 'soccer' || sport === 'boxing' || sport === 'mma') {
        let paramName = 'fixture';
        if (config.type === 'game') paramName = 'game';
        if (config.type === 'fight') paramName = 'fight';
        if (config.type === 'race') paramName = 'race';

        // Sort to prioritize LIVE events, then Near Future
        fixtures.sort((a, b) => {
            const aLive = ['1H','2H','HT','ET','P','LIVE','Q1','Q2','Q3','Q4','OT','BT'].includes(a.status?.short) ? 1 : 0;
            const bLive = ['1H','2H','HT','ET','P','LIVE','Q1','Q2','Q3','Q4','OT','BT'].includes(b.status?.short) ? 1 : 0;
            if (aLive !== bLive) return bLive - aLive;
            // Then by date
            return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
        });

        // Limit to 60 to avoid timeouts/limits (User reported "0 pre games", likely due to timeout)
        const MAX_FIXTURES = 60;
        const fixturesToProcess = fixtures.slice(0, MAX_FIXTURES);
        log(`[Robust] Fetching odds for ${fixturesToProcess.length} ${sport} fixtures (Limit: ${MAX_FIXTURES})`);

        // Batch requests to avoid hitting rate limits (3 per batch, 200ms delay)
        const BATCH_SIZE = 3;
        for (let i = 0; i < fixturesToProcess.length; i += BATCH_SIZE) {
            const batch = fixturesToProcess.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (f: any) => {
                let fid = String(f.id);
                if (!fid) return;
                
                // Remove prefix if present
                if (fid.includes('_')) fid = fid.split('_')[1];

                const url = `${baseUrl}?${paramName}=${fid}`;
                // log(`[Robust] Fetching Odds (${sport}): ${url}`);

                try {
                    const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
                    if (!res.ok) {
                        log(`[RobustDebug] Fixture odds fetch failed status=${res.status} url=${url}`);
                        return;
                    }

                    const data: any = await res.json();
                    if (!data.response) {
                        // log(`[RobustDebug] No 'response' field for fixture=${fid}`);
                        return;
                    }

                    if (Array.isArray(data.response)) {
                        allOdds = allOdds.concat(data.response);
                    }
                } catch (e) {
                    console.error(`[Robust] Error fetching odds for ${sport} fixture=${fid}:`, e);
                }
            }));
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        log(`[Robust] Total ${sport} odds fetched: ${allOdds.length}`);

    } else {
        // Group by League + Season
        const groups = new Map<string, {id: number, season: number}>();
        let missingInfoCount = 0;

        fixtures.forEach(f => {
            if (f.league_id && f.season) {
                groups.set(`${f.league_id}_${f.season}`, { id: f.league_id, season: f.season });
            } else {
                missingInfoCount++;
                if (missingInfoCount <= 5) {
                     // log(`[RobustDebug] Fixture missing league/season: ID=${f.id} LeagueID=${f.league_id} Season=${f.season} Payload=${JSON.stringify(f)}`);
                }
            }
        });
        
        log(`[Robust] ${sport}: Fetching odds for ${groups.size} leagues/seasons. (Ignored ${missingInfoCount} fixtures due to missing info)`);
        
        // DEBUG: Dump groups
        if (groups.size > 0) {
             const sampleGroup = groups.values().next().value;
             log(`[RobustDebug] Sample Group: ID=${sampleGroup?.id} Season=${sampleGroup?.season}`);
        } else {
             // log(`[RobustDebug] NO GROUPS FOUND! First fixture sample: ${fixtures.length > 0 ? JSON.stringify(fixtures[0]) : 'Empty'}`);
        }

        // Avoid Worker CPU/Time limits by yielding event loop
        await new Promise(resolve => setTimeout(resolve, 50));

        for (const group of groups.values()) {
            try {
                // FORCE ODDS FETCH BY FIXTURE ID FOR EVERYTHING IN THIS GROUP
                // Reason: Fetching by League+Season often returns empty arrays for future games in API-Sports free/trial tier or specific leagues
                // Batching by ID is safer for guaranteeing odds for displayed games
                
                // Find all fixtures in this group
                const groupFixtures = fixtures.filter(f => f.league_id === group.id && f.season === group.season);
                
                // Limit to next 10 games to avoid rate limits
                const targetFixtures = groupFixtures.slice(0, 10);
                
                log(`[Robust] Fetching Odds by ID for ${targetFixtures.length} games in League ${group.id} (Fallback Strategy)`);

                const BATCH_SIZE = 3;
                for (let i = 0; i < targetFixtures.length; i += BATCH_SIZE) {
                    const batch = targetFixtures.slice(i, i + BATCH_SIZE);
                    await Promise.all(batch.map(async (f: any) => {
                        let fid = String(f.id).split('_')[1] || String(f.id);
                        const url = `${baseUrl}?${sport === 'soccer' ? 'fixture' : 'game'}=${fid}`;
                        
                        try {
                            const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
                            if (res.ok) {
                                const data: any = await res.json();
                                if (Array.isArray(data.response)) {
                                    allOdds = allOdds.concat(data.response);
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }));
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (e) {
                console.error(`[Robust] Error fetching odds for ${sport} league ${group.id}:`, e);
            }
        }
    }
    
    return allOdds;
}

function mapApiSportsOddsToUnified(apiOdds: any[], sport: string) {
            const oddsMap = new Map();
            
            apiOdds.forEach(item => {
                // Handle different ID fields (fixture.id for soccer, game.id for volleyball/handball/etc)
                const id = item.fixture?.id || item.game?.id;
                if (!id) return;

                const fixtureId = `${sport}_${id}`;
                
                // Try to find Bet365, otherwise fallback to the first available bookmaker
                const bookmaker = item.bookmakers.find((b: any) => b.name === 'Bet365') || item.bookmakers[0];
                
                if (!bookmaker) return;
                
                const markets = bookmaker.bets.map((bet: any) => {
                    const key = canonicalApiSportsMarketKey(bet.name, sport);
                    const outcomes = bet.values.map((val: any) => ({
                            name: val.value,
                            price: parseFloat(val.odd),
                            point: val.value, // Store original value as point/handicap if needed
                            value: val.value,
                            label: val.value
                        }));

                    if (key === 'h2h') {
                         try {
                             // Identify Home/Draw/Away
                             // API-Sports values for Match Winner are typically "Home", "Away", "Draw" OR "1", "2", "X"
                             const findOutcome = (keywords: string[]) => outcomes.find((o:any) => keywords.includes(String(o.name).toLowerCase()));
                             
                             const home = findOutcome(['home', '1', 'casa']);
                             const draw = findOutcome(['draw', 'x', 'empate']);
                             const away = findOutcome(['away', '2', 'fora']);
                             
                             if (home && away) {
                                 const oddsObj: any = { home: home.price, away: away.price };
                                 if (draw) oddsObj.draw = draw.price;
                                 
                                 const newOdds = applyHomeAdvantage(oddsObj);
                                 
                                 home.price = newOdds.home;
                                 away.price = newOdds.away;
                                 if (draw && newOdds.draw) draw.price = newOdds.draw;
                             }
                         } catch (e) {
                             // ignore
                         }
                    }

                    return {
                        key: key,
                        outcomes: outcomes
                    };
                });
                
                oddsMap.set(fixtureId, {
                    markets: markets,
                    source: 'api-sports-odds',
                    bookmaker: bookmaker.name
                });
            });
            
            return oddsMap;
        }

// ================= FETCH =================

async function fetchActiveSports(apiKey: string): Promise<any[]> {
    try {
        const url = `${ODDS_API_BASE}?apiKey=${apiKey}`;
        console.log(`[Robust] Fetching Active Sports: ${url.replace(apiKey, 'HIDDEN')}`);
        const response = await fetch(url);
        if (!response.ok) return [];
        const data: any = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("[Robust] Error fetching sports list:", e);
        return [];
    }
}

async function fetchApiSportsSchedule(apiKey: string, sport: string, options: { days?: number, targetDate?: string } = {}) {
    const config = API_SPORTS_CONFIG[sport];
    if (!config) {
        console.log(`[Robust] No API-Sports config for ${sport}`);
        return [];
    }

    try {
        // Use targetDate as base if provided, otherwise use today
        const baseDate = options.targetDate ? dayjs(options.targetDate) : dayjs();
        // Default to 3 days if not specified (API limit is high)
        const daysToFetch = options.days ? Math.min(options.days, 14) : 3;

        if (sport === 'soccer') {
             const promises = [];
             
             // Loop for soccer fetching
             for (let i = 0; i < daysToFetch; i++) {
                 // Clone baseDate to avoid mutation issues in loop
                 const d = dayjs(baseDate).add(i, 'day');
                 const dateStr = d.format("YYYY-MM-DD");
                 
                 const url = `${config.url}?date=${dateStr}&timezone=Europe/Lisbon`;
                 // console.log(`[Robust] Fetching API-Sports (${sport}) for ${dateStr}: ${url}`);
                 
                 promises.push(
                     fetch(url, {
                        method: 'GET',
                        headers: { 
                            "x-apisports-key": apiKey,
                            "x-rapidapi-host": "v3.football.api-sports.io"
                        }
                     }).then(async (res) => {
                         if (!res.ok) {
                             const txt = await res.text();
                             console.error(`[Robust] API-Sports Error ${res.status}: ${txt}`);
                             return [];
                         }
                         const json: any = await res.json();
                         // Validate response structure
                         if (!json || !json.response || !Array.isArray(json.response)) {
                             console.warn(`[Robust] Invalid API-Sports response for ${dateStr}`);
                             return [];
                         }
                         return json.response;
                     }).catch(err => {
                         console.error(`[Robust] Network Error fetching date ${dateStr}:`, err);
                         return [];
                     })
                 );
             }
             
             const results = await Promise.all(promises);
             // Flatten array of arrays
             const flatResults = results.reduce((acc, val) => acc.concat(val), []);
             
             console.log(`[Robust] Total soccer fixtures fetched (raw): ${flatResults.length}`);
             
             const normalized = flatResults.map((item: any) => normalizeApiSportsMatch(item, sport)).filter((item: any) => item !== null);
             return normalized;
        }

        // Updated: Allow up to 14 days for all sports since we have high API limits (1.5M/day)
        const promises = [];
        
        for (let i = 0; i < daysToFetch; i++) {
             const d = baseDate.add(i, 'day');
             const dateStr = d.format("YYYY-MM-DD");

             const url = `${config.url}?date=${dateStr}`;
             console.log(`[Robust] Fetching API-Sports (${sport}) for ${dateStr}: ${url}`);
             
             promises.push(
                 fetch(url, {
                    headers: { "x-apisports-key": apiKey }
                 }).then(async (res) => {
                     if (!res.ok) return [];
                     const d: any = await res.json();
                     if (!d || !d.response) return [];
                     // Filter valid responses
                     if (d.results === 0) return [];
                     return d.response;
                 }).catch(err => {
                     console.error(`[Robust] Error fetching date ${dateStr} for ${sport}:`, err);
                     return [];
                 })
             );
        }

        const results = await Promise.all(promises);
        const flatResults = results.flat();
        
        console.log(`[Robust] Total ${sport} fixtures fetched: ${flatResults.length}`);
        
        return flatResults.map((item: any) => normalizeApiSportsMatch(item, sport)).filter((item: any) => item !== null);

    } catch (error: any) {
        console.error(`[Robust] API-Sports (${sport}) Exception:`, error.message);
        return [];
    }
}

async function fetchOdds(apiKey: string, sportKey: string) {
  try {
      const isWinner = sportKey.includes('_winner');
      const markets = isWinner ? 'outrights' : 'h2h,totals,spreads';
      const url = `${ODDS_API_BASE}/${sportKey}/odds?apiKey=${apiKey}&regions=eu&markets=${markets}&oddsFormat=decimal`;
      console.log(`[Robust] Fetching Odds API (${sportKey}): ${url.replace(apiKey, 'HIDDEN')}`);

      const response = await fetch(url);
      if (!response.ok) return [];

      const data: any = await response.json();

      if (!Array.isArray(data)) return [];
      
      return data.map((m: any) => {
          if (!m.home_team || !m.away_team) return null;
          const norm: any = normalizeOddsMatch(m);
          norm.sport_key = sportKey;
          return norm;
      }).filter((m: any) => m !== null);
  } catch (error: any) {
      console.error("[Robust] Odds API Exception:", error.message);
      return [];
  }
}

async function saveMatchesToDB(env: Env, matches: any[]) {
    if (matches.length === 0) return 0;

    const stmt = env.DB.prepare(`
        INSERT INTO imported_odds (
            id, sport, league_name, home_team, away_team, event_date, status, payload, is_live, publish_status, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT(id) DO UPDATE SET
            payload = excluded.payload,
            status = excluded.status,
            updated_at = excluded.updated_at,
            is_live = excluded.is_live,
            publish_status = excluded.publish_status,
            sport = excluded.sport
    `);

        const batch = matches.map(m => {
        let broadSport = 'other';
        const sportLower = (m.sport_key || m.sport || '').toLowerCase();
        
        if (sportLower.includes('soccer')) broadSport = 'soccer';
        else if (sportLower.includes('basketball')) broadSport = 'basketball';
        else if (sportLower.includes('baseball')) broadSport = 'baseball';
        else if (sportLower.includes('tennis')) broadSport = 'tennis';
        else if (sportLower.includes('american') || sportLower.includes('nfl')) broadSport = 'american-football';
        else if (sportLower.includes('hockey')) broadSport = 'hockey';
        else if (sportLower.includes('mma') || sportLower.includes('ufc') || sportLower.includes('fight')) broadSport = 'mma';
        else if (sportLower.includes('rugby')) broadSport = 'rugby';
        else if (sportLower.includes('volleyball')) broadSport = 'volleyball';
        else if (sportLower.includes('handball')) broadSport = 'handball';
        else if (sportLower.includes('futsal')) broadSport = 'futsal';
        else if (sportLower.includes('boxing')) broadSport = 'boxing';
        else if (sportLower.includes('formula') || sportLower.includes('motor')) broadSport = 'formula1';
        else if (sportLower.includes('aussie') || sportLower.includes('afl')) broadSport = 'aussie-rules';

        const status = m.status?.short || m.status || 'NS';
        const isLive = ['1H','2H','HT','ET','P','LIVE','Q1','Q2','Q3','Q4','OT','BT'].includes(status) ? 1 : 0;
        
        // Ensure ID is string
        const id = String(m.id || m.fixture_id);

        return stmt.bind(
            id,
            broadSport, 
            m.league_name || m.league_obj?.name || 'Unknown League',
            m.home_team || m.teams?.home?.name || 'Home',
            m.away_team || m.teams?.away?.name || 'Away',
            m.event_date || m.kickoff || new Date().toISOString(),
            status,
            JSON.stringify(m),
            isLive,
            'published',
            new Date().toISOString()
        );
    });

    const chunkSize = 50;
    let saved = 0;
    for (let i = 0; i < batch.length; i += chunkSize) {
        const chunk = batch.slice(i, i + chunkSize);
        try {
            const result = await env.DB.batch(chunk);
            saved += result.length;
        } catch(e) { console.error("Batch save error", e); }
    }
    
    console.log(`[Robust] Saved ${saved} events`);
    return saved;
}

export async function fetchOddsForSingleFixture(env: Env, sport: string, fixtureId: string): Promise<any | null> {
    const config = API_SPORTS_CONFIG[sport];
    if (!config || !env.API_SPORTS_KEY) return null;
    
    // Handle URL: /fixtures -> /odds
    // Note: Some sports (V1) use /games -> /odds
    const baseUrl = config.url.replace('/games', '/odds').replace('/fixtures', '/odds').replace('/races', '/odds').replace('/fights', '/odds');
    
    let paramName = 'fixture';
    if (config.type === 'game') paramName = 'game';
    if (config.type === 'fight') paramName = 'fight'; // MMA
    if (config.type === 'race') paramName = 'race'; // F1
    
    const url = `${baseUrl}?${paramName}=${fixtureId}`;
    
    try {
        const res = await fetch(url, { headers: { "x-apisports-key": env.API_SPORTS_KEY } });
        if (!res.ok) return null;
        const data: any = await res.json();
        if (!data.response || data.response.length === 0) return null;
        
        const item = data.response[0];
        // Normalize
        const homeName = item.teams?.home?.name || item.home_team; 
        const awayName = item.teams?.away?.name || item.away_team;
        
        if (!homeName || !awayName) return null;
        
        const markets = transformBookmakersToMarkets(item.bookmakers, homeName, awayName);
        return { markets, homeName, awayName };
    } catch (e) {
        console.error(`[Robust] Single odds fetch failed for ${fixtureId}`, e);
        return null;
    }
}

// ================= MAIN EXPORT =================

export async function fetchLiveFixtures(apiKey: string, sport: string, log: (msg: string) => void = console.log) {
    const config = API_SPORTS_CONFIG[sport];
    // Only fetch live for supported sports (Soccer supports live=all well)
    if (!config || sport !== 'soccer') return []; 

    try {
        const url = `${config.url}?live=all`;
        log(`[Robust] Fetching LIVE fixtures for ${sport}: ${url}`);
        const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
        if (!res.ok) return [];
        const data: any = await res.json();
        if (!data.response) return [];
        
        log(`[Robust] Found ${data.response.length} LIVE fixtures for ${sport}`);
        return data.response.map((item: any) => normalizeApiSportsMatch(item, sport)).filter((item: any) => item !== null);
    } catch (e) {
        console.error(`[Robust] Error fetching live fixtures for ${sport}:`, e);
        return [];
    }
}

export async function runRobustIntegration(env: Env, options: { days?: number, targetDate?: string, sports?: string[] } = {}) {
  const debugLog: string[] = [];
  const log = (msg: string, ...args: any[]) => {
      const line = msg + (args.length ? ' ' + JSON.stringify(args) : '');
      console.log(line);
      debugLog.push(line);
  };

  try {
    log('[Robust] Starting integration...', options);
    
    // Cleanup bad events
    try {
        await env.DB.prepare(`
            DELETE FROM imported_odds 
            WHERE home_team = '' OR away_team = '' 
               OR home_team IS NULL OR away_team IS NULL
               OR lower(home_team) = 'home team' OR lower(away_team) = 'away team'
               OR lower(home_team) = 'home' OR lower(away_team) = 'away'
        `).run();

        // CLEANUP: Delete old events (Finished > 12h ago)
        await env.DB.prepare(`
            DELETE FROM events 
            WHERE status IN ('FT', 'AOT', 'AP', 'Finished', 'Ended', 'Final')
            AND event_date < datetime('now', '-12 hours')
            AND external_event_id NOT IN (SELECT event_id FROM bets WHERE status = 'pending')
        `).run();
        
        await env.DB.prepare(`
            DELETE FROM events 
            WHERE home_team = '' OR away_team = '' 
               OR home_team IS NULL OR away_team IS NULL
               OR lower(home_team) = 'home team' OR lower(away_team) = 'away team'
               OR lower(home_team) = 'home' OR lower(away_team) = 'away'
        `).run();
    } catch (e) {
        console.warn('[Robust] Cleanup error:', e);
    }

    const apiFootballKey = env.API_SPORTS_KEY || "";

    if (!apiFootballKey) {
        log('[Robust] Missing API_SPORTS_KEY');
        return { error: "Missing API_SPORTS_KEY", success: false, debugLog };
    }

    let totalSaved = 0;

    let sportsToProcess: string[] = [];

    if (options.sports && options.sports.length > 0) {
        const mapped = options.sports
            .map(s => SPORT_PARAM_TO_CONFIG[s] || "")
            .filter(s => s && API_SPORTS_CONFIG[s]);
        sportsToProcess = Array.from(new Set(mapped));
    } else {
        sportsToProcess = ["soccer"];
    }

    log(`[Robust] Processing sports via API-Football: ${sportsToProcess.join(', ')}`);

    for (const sport of sportsToProcess) {
        let rawFixtures = await fetchApiSportsSchedule(apiFootballKey, sport, options);
        
        // Fetch LIVE fixtures for Soccer and merge
        if (sport === 'soccer') {
            const liveFixtures = await fetchLiveFixtures(apiFootballKey, sport, log);
            if (liveFixtures.length > 0) {
                 const existingIds = new Set(rawFixtures.map((f:any) => f.id));
                 for (const f of liveFixtures) {
                     if (!existingIds.has(f.id)) {
                         rawFixtures.push(f);
                         existingIds.add(f.id);
                     }
                 }
                 log(`[Robust] Merged ${liveFixtures.length} LIVE fixtures into schedule.`);
            }
        }

        // STRICT DATE FILTER: Remove any event more than 48h away from target date (or today)
        // This prevents "stale" live events from cluttering the DB
        if (options.targetDate) {
            const target = dayjs(options.targetDate);
            rawFixtures = rawFixtures.filter((f: any) => {
                const fDate = dayjs(f.kickoff);
                const diffHours = Math.abs(fDate.diff(target, 'hour'));
                // Allow generous window (3 days) to include pre-games, but exclude old garbage
                // If we asked for 3 days, we allow +72h. But we definitely exclude -24h (past)
                const isTooOld = fDate.isBefore(target.subtract(12, 'hour'));
                if (isTooOld) return false;
                return true;
            });
            log(`[Robust] Filtered to ${rawFixtures.length} fixtures after strict date check (Target: ${options.targetDate})`);
        }

        const fixtures = filterSmallLeagues(rawFixtures);

        log(`[Robust] ${sport}: Fetched ${fixtures.length} fixtures from API-Sports`);

        if (!fixtures.length) {
            continue;
        }

        const oddsRaw = await fetchApiSportsOddsForFixtures(apiFootballKey, sport, fixtures, log);
        log(`[Robust] ${sport}: Fetched ${oddsRaw.length} odds entries from API-Sports`);

        const unifiedOddsMap = mapApiSportsOddsToUnified(oddsRaw, sport);

        const matches: any[] = [];

        for (const f of fixtures) {
            const oddsData = unifiedOddsMap.get(f.id);
            const hasOdds = !!oddsData;
            const markets = hasOdds ? oddsData.markets : [];

            const merged: any = {
                id: f.id,
                fixture_id: f.id,
                sport,
                league_name: f.league_obj.name,
                home_team: f.teams.home.name,
                away_team: f.teams.away.name,
                event_date: f.kickoff,
                status: f.status,
                markets,
                odds: markets,
                has_odds: hasOdds,
                source: hasOdds ? oddsData.source : 'api-sports-fixture'
            };

            try {
                const basePayload = { ...f };
                if (hasOdds) {
                    merged.payload = JSON.stringify({ ...basePayload, ...oddsData, has_odds: true });
                } else {
                    merged.payload = JSON.stringify({ ...basePayload, has_odds: false });
                }
            } catch {
                merged.payload = JSON.stringify(f);
            }

            matches.push(merged);
        }

        if (matches.length > 0) {
            const saved = await saveMatchesToDB(env, matches);
            totalSaved += saved;
        }
    }

    return {
        success: true,
        fetched: {
            sports_checked: sportsToProcess.length
        },
        saved_count: totalSaved,
        debugLog
    };

  } catch (error: any) {
    log("[Robust] Critical Error:", error.message);
    return { error: error.message, success: false, debugLog };
  }
}

export async function debugSoccerMatching(env: Env) {
    const apiFootballKey = env.API_SPORTS_KEY || "";
    
    if (!apiFootballKey) return { error: "Missing API_SPORTS_KEY" };

    const debugReport: any = {
        raw_fixtures_count: 0,
        filtered_fixtures_count: 0,
        sample_leagues: [],
        fixtures: [],
        odds: [],
        matches: [],
        mismatches: []
    };

    const rawFixtures = await fetchApiSportsSchedule(apiFootballKey, 'soccer');
    debugReport.raw_fixtures_count = rawFixtures.length;
    debugReport.sample_leagues = rawFixtures.slice(0, 10).map((f: any) => f.league_obj.name);

    const fixtures = filterSmallLeagues(rawFixtures);
    debugReport.filtered_fixtures_count = fixtures.length;
    
    // Filter for Scotland Premiership for debugging
    const targetFixtures = fixtures.filter(f => 
        f.league_obj.name.includes('Premiership') || 
        f.league_obj.name.includes('Elite') ||
        f.league_obj.name.includes('Premier')
    );
    
    debugReport.fixtures = targetFixtures.map(f => ({
        id: f.fixture_id,
        league: f.league_obj.name,
        home: f.teams.home.name,
        away: f.teams.away.name,
        canonical_home: f.teams.home.canonical,
        canonical_away: f.teams.away.canonical,
        date: f.kickoff
    }));

    const oddsRaw = await fetchApiSportsOddsForFixtures(apiFootballKey, 'soccer', fixtures);
    const unifiedOddsMap = mapApiSportsOddsToUnified(oddsRaw, 'soccer');

    debugReport.odds = Array.from(unifiedOddsMap.entries()).map(([id, data]: any) => ({
        id,
        markets: data.markets.map((m: any) => m.key),
        source: data.source,
        bookmaker: data.bookmaker
    }));

    debugReport.matches = targetFixtures.map(f => ({
        id: f.id,
        league: f.league_obj.name,
        home: f.teams.home.name,
        away: f.teams.away.name,
        has_odds: unifiedOddsMap.has(f.id)
    }));

    return debugReport;
}
