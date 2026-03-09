import { Env } from '../../shared/types';

const API_BASES = [
  "https://22bet.com", 
  "https://22bet.mz",
  "https://22bet.zm",
  "https://22bet.bi",
  "https://22bet.cd",
  "https://22bet.cg",
  "https://22bet.gm",
  "https://22bet.ug",
  "https://22bet.et",
  "https://22bet.ke",
  // Removed failing domains: .ng, .gh, .sn
];

const ENDPOINTS = [
  "/LiveFeed/Get1x2_VZip",
  "/LiveFeed/Get1x2",
];

const SPORTS_MAP: Record<string, number> = {
  soccer: 1,
  basketball: 3,
  tennis: 4,
  'ice-hockey': 2,
  volleyball: 6,
  handball: 8,
  futsal: 9,
  'table-tennis': 10,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

interface Bet22Event {
  I: number;      // Event ID
  O1: string;     // Home
  O2: string;     // Away
  L: string;      // League
  S: number;      // Start time (Unix)
  SC?: {
    FS?: { S1: number; S2: number }; // Full score
    TS?: number;                     // Time in seconds
    CP?: number;                     // Current period
  };
  E?: Array<{
    G: number;   // Market group
    T: number;   // Outcome type
    C: number;   // Coefficient
    P?: number;  // Parameter (e.g. 2.5)
    }>;
  }

export class Scraper22Bet {
  private env: Env;
  private logs: string[] = [];

  constructor(env: Env) {
    this.env = env;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const prefix = `[22Bet ${level.toUpperCase()}] ${timestamp}`;
    console[level](`${prefix} ${msg}`, ...args);
    this.logs.push(`${prefix} ${msg} ${args.map(a => JSON.stringify(a)).join(' ')}`);
  }

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetchLiveEvents(sport: string = 'soccer'): Promise<Bet22Event[]> {
    const sportId = SPORTS_MAP[sport.toLowerCase()] || 1;
    this.log('info', `Buscando eventos ao vivo para sport=${sport} (ID=${sportId})`);

    let attempts = 0;
    const MAX_ATTEMPTS = 50;

    for (const base of API_BASES) {
      for (const endpoint of ENDPOINTS) {
        if (attempts >= MAX_ATTEMPTS) {
          this.log('warn', `Limite de tentativas atingido (${MAX_ATTEMPTS}). Abortando.`);
          return []; // Exit entirely
        }

        attempts++;

        const params = new URLSearchParams({
          sports: sportId.toString(),
          count: '500',
          mode: '4',
          country: '1',
          partner: '151',
          getEmpty: 'true',
          noFilterBlockEvent: 'true',
          lng: 'en',
        });

        const url = `${base}${endpoint}?${params.toString()}`;
        const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

        this.log('info', `Tentativa ${attempts}: ${url} (UA: ${ua.substring(0, 30)}...)`);

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          const res = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': ua,
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': `${base}/live/`,
              'Origin': base,
              'Connection': 'keep-alive',
              'X-Requested-With': 'XMLHttpRequest'
            },
          });

          clearTimeout(timeoutId);

          if (!res.ok) {
            this.log('warn', `Status ${res.status} em ${url}`);
            // If 406 or 403, we might want to try next mirror immediately
            continue;
          }

          const text = await res.text();
          if (!text.trim()) {
            this.log('warn', `Resposta vazia de ${url}`);
            continue;
          }

          let data: { Value?: Bet22Event[] } = {};
          try {
            data = JSON.parse(text);
          } catch {
            this.log('warn', `JSON inválido de ${url}`);
            continue;
          }

          if (Array.isArray(data.Value) && data.Value.length > 0) {
            this.log('info', `SUCESSO: ${data.Value.length} eventos obtidos de ${base}`);
            return data.Value;
          }
        } catch (err: any) {
          this.log('error', `Erro ao tentar ${url}: ${err.message}`);
          // Don't wait too long if it's a network error, just try next mirror
          await this.delay(500); 
        }
      }
    }

    this.log('error', 'Todos os mirrors e endpoints falharam.');
    return [];
  }

  private normalizeTeamName(name: string): string {
    return (name || '')
      .replace(/\./g, '') // Remove dots (e.g. "St. Louis" -> "St Louis", "White." -> "White")
      .replace(/\sFC$|\sCF$|\sSC$|\sEC$/gi, '')
      .replace(/ Atlético /gi, ' Atl ')
      .replace(/ Internacional /gi, ' Inter ')
      .replace(/ Nacional /gi, ' Nac ')
      .replace(/ Sport /gi, ' Sp ')
      .replace(/Los Angeles/gi, 'LA')
      .replace(/United/gi, 'Utd')
      .replace(/Saint/gi, 'St')
      .trim();
  }

  normalizeEvent(raw: Bet22Event, sport: string): any | null {
    try {
      const home = this.normalizeTeamName(raw.O1);
      const away = this.normalizeTeamName(raw.O2);
      if (!home || !away) return null;

      const homeScore = raw.SC?.FS?.S1 ?? 0;
      const awayScore = raw.SC?.FS?.S2 ?? 0;
      const elapsedSeconds = raw.SC?.TS ?? 0;
      const elapsed = Math.floor(elapsedSeconds / 60);

      let homeOdd = 0, drawOdd = 0, awayOdd = 0;
      const totals: any[] = [];
      const handicap: any[] = [];

      if (raw.E) {
        raw.E.forEach(o => {
          if (o.G === 1) { // 1x2
            if (o.T === 1) homeOdd = Number(o.C) || 0;
            if (o.T === 2) drawOdd = Number(o.C) || 0;
            if (o.T === 3) awayOdd = Number(o.C) || 0;
          }
          // Totals (Over/Under) - G=17
                else if (o.G === 17) {
                    const price = Number(o.C) || 0;
                    const point = Number(o.P) || 0;
                    if (price > 1.01) {
                        if (o.T === 9) totals.push({ name: 'Over', outcome: `Over ${point}`, label: `Over ${point}`, value: 'Over', price, point, odd: price });
                        if (o.T === 10) totals.push({ name: 'Under', outcome: `Under ${point}`, label: `Under ${point}`, value: 'Under', price, point, odd: price });
                    }
                }
                // Handicap - G=7
                else if (o.G === 7) {
                    const price = Number(o.C) || 0;
                    const point = Number(o.P) || 0;
                    if (price > 1.01) {
                        if (o.T === 7) handicap.push({ name: 'Home', outcome: `Home ${point}`, label: `Home ${point}`, value: 'Home', price, point, odd: price });
                        if (o.T === 8) handicap.push({ name: 'Away', outcome: `Away ${point}`, label: `Away ${point}`, value: 'Away', price, point, odd: price });
                    }
                }
        });
      }

      // Só aceita evento se tiver odds mínimas válidas
      if (homeOdd <= 1.01 || awayOdd <= 1.01) return null;

      // Handle specific sport statuses if needed
      let statusShort = 'LIVE';
      const statusLong = 'Em andamento';

      // Example: Basketball quarters
      if (sport === 'basketball') {
          const p = raw.SC?.CP; // Current Period
          if (p) statusShort = `Q${p}`;
      }
      // Example: Tennis sets
      else if (sport === 'tennis') {
          const p = raw.SC?.CP;
          if (p) statusShort = `S${p}`;
      }

      // Robust League Name Extraction
      let leagueName = 'Unknown League';
      if (typeof raw.L === 'string') {
          leagueName = raw.L;
      } else if (typeof raw.L === 'object') {
           // Try to find a name property or stringify safely
           const lObj = raw.L as any;
           leagueName = lObj.name || lObj.league_name || lObj.en || 'Unknown League';
      }
      if (leagueName === '[object Object]') leagueName = 'Unknown League';

      return {
        id: `22bet_${raw.I}`,
        sport: sport,
        league_name: leagueName,
        league: leagueName,
        home_team: home,
        away_team: away,
        event_date: new Date(raw.S * 1000).toISOString(),
        is_live: 1,
        status: statusShort,
        goals: { home: homeScore, away: awayScore },
        score: JSON.stringify({ home: homeScore, away: awayScore }), // Add stringified score for compatibility
        elapsed: elapsed,
        fixture: {
          id: `22bet_${raw.I}`,
          status: {
            short: statusShort,
            long: statusLong,
            elapsed,
          },
        },
        odds: {
          h2h: [
            { outcome: '1', value: '1', odd: homeOdd },
            ...(drawOdd > 1.01 ? [{ outcome: 'X', value: 'X', odd: drawOdd }] : []),
            { outcome: '2', value: '2', odd: awayOdd },
          ],
          totals: totals.length > 0 ? totals : undefined,
          handicap: handicap.length > 0 ? handicap : undefined,
        },
        home_odd: homeOdd,
        draw_odd: drawOdd,
        away_odd: awayOdd,
        source: '22bet',
      };
    } catch (err) {
      this.log('error', 'Falha ao normalizar evento:', err);
      return null;
    }
  }

  async syncOdds() {
    this.logs = [];
    this.log('info', 'Iniciando sincronização com 22Bet...');

    const sportsToSync = ['soccer', 'basketball', 'tennis', 'futsal', 'volleyball', 'handball', 'ice-hockey', 'table-tennis'];
    let totalUpdates = 0;
    let totalInserts = 0;

    for (const sport of sportsToSync) {
        this.log('info', `Syncing sport: ${sport}...`);
        
        const rawEvents = await this.fetchLiveEvents(sport);
        this.log('info', `[${sport}] Obtidos ${rawEvents.length} eventos brutos`);

        if (!rawEvents.length) continue;

        // Buscar eventos ativos no banco para este esporte
        const { results } = await this.env.DB.prepare(`
          SELECT id, home_team, away_team, payload 
          FROM imported_odds 
          WHERE is_live = 1 AND sport = ?
        `).bind(sport).all();

        const dbEvents = (results || []).map((r: any) => ({
          id: r.id,
          home: this.normalizeTeamName(r.home_team || ''),
          away: this.normalizeTeamName(r.away_team || ''),
          payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        }));

        this.log('info', `[${sport}] Encontrados ${dbEvents.length} eventos ativos no banco para comparação`);

        for (const raw of rawEvents) {
          const norm = this.normalizeEvent(raw, sport);
          if (!norm) continue;

          const nHome = norm.home_team.toLowerCase();
          const nAway = norm.away_team.toLowerCase();

          // Busca match por nomes normalizados (Token Overlap + Inclusion)
          const match = dbEvents.find((db: { home: string; away: string; id: any; payload: any }) => {
            const dbHome = db.home.toLowerCase();
            const dbAway = db.away.toLowerCase();
            
            // 1. Direct Inclusion (Legacy)
            if ((dbHome.includes(nHome) || nHome.includes(dbHome)) &&
                (dbAway.includes(nAway) || nAway.includes(dbAway))) {
                return true;
            }

            // 2. Token Overlap (Robust)
            const tokenize = (s: string) => s.split(/[\s.-]+/).filter(w => w.length >= 2 && !['fc','sc','ec','cd','ac'].includes(w.toLowerCase()));
            const checkOverlap = (s1: string, s2: string) => {
                const t1 = tokenize(s1);
                const t2 = tokenize(s2);
                if (!t1.length || !t2.length) return false;
                const intersection = t1.filter(w => t2.some(w2 => w2.startsWith(w) || w.startsWith(w2))); // Prefix match
                return intersection.length >= Math.min(t1.length, t2.length) * 0.6; // 60% match
            };

            return checkOverlap(dbHome, nHome) && checkOverlap(dbAway, nAway);
          });

          if (match) {
            // Atualizar evento existente
            const p = match.payload;
            let changed = false;

            // Atualiza placar - DISABLED per user request (Scores must come from API-Football)
            /*
            if (norm.goals) {
              const goalsChanged = !p.goals || p.goals.home !== norm.goals.home || p.goals.away !== norm.goals.away;
              if (goalsChanged || !p.score) {
                p.goals = { ...norm.goals };
                p.score = norm.score; // Update score string as well
                changed = true;
              }
            }
            */

            // Atualiza tempo
            // Always ensure elapsed is present in payload root
            if (norm.elapsed !== undefined) {
                 if (p.elapsed !== norm.elapsed) {
                     p.elapsed = norm.elapsed;
                     changed = true;
                 }
                 // Also update nested if exists
                 if (p.fixture && p.fixture.status) {
                     if (p.fixture.status.elapsed !== norm.elapsed) {
                         p.fixture.status.elapsed = norm.elapsed;
                         changed = true;
                     }
                 }
            }

            // Ensure league name is fixed/updated - DISABLED to prefer API-Football names
            /*
            if (p.league !== norm.league || p.league_name !== norm.league_name) {
                p.league = norm.league;
                p.league_name = norm.league_name;
                changed = true;
            }
            */
            
            // Update Status (Q1, Q2, etc.)
            if (norm.status && p.status !== norm.status) {
                p.status = norm.status;
                if (p.fixture && p.fixture.status) {
                    p.fixture.status.short = norm.status;
                }
                changed = true;
            }

            // Atualiza odds
            // Always update odds structure to include sub-markets
            if (!p.odds) p.odds = {};
            
            // Update H2H if changed
            if (norm.home_odd !== p.home_odd || norm.away_odd !== p.away_odd || norm.draw_odd !== p.draw_odd) {
               p.home_odd = norm.home_odd;
               p.draw_odd = norm.draw_odd;
               p.away_odd = norm.away_odd;
               p.odds.h2h = norm.odds.h2h;
               changed = true;
            }

            // Update Sub-markets (Totals/Handicap)
            // We always overwrite these if they exist in the new data, 
            // as they are highly dynamic and 22Bet is the source of truth for them.
            if (norm.odds.totals) {
                p.odds.totals = norm.odds.totals;
                changed = true;
            }
            if (norm.odds.handicap) {
                p.odds.handicap = norm.odds.handicap;
                changed = true;
            }

            if (changed) {
              // Atualiza DB
              await this.env.DB.prepare(`
                UPDATE imported_odds 
                SET payload = ?, publish_status = 'published', updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
              `).bind(JSON.stringify(p), match.id).run();
              
              totalUpdates++;
            }
          } else {
            // INSERT NEW EVENT
            // If the event is not in imported_odds, we insert it.
            // This is critical for sports like Basketball/Tennis where API-Football might be missing data
            // or 22Bet is the primary source.
            
            // Ensure payload has necessary fields for EventSync compatibility
            // Scraper22Bet.normalizeEvent returns a structure compatible with EventSync.normalizePayload
            
            try {
                await this.env.DB.prepare(`
                    INSERT INTO imported_odds (
                        id, sport, league_name, home_team, away_team, 
                        event_date, status, payload, is_live, publish_status, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'published', CURRENT_TIMESTAMP)
                `).bind(
                    norm.id,
                    norm.sport,
                    norm.league_name,
                    norm.home_team,
                    norm.away_team,
                    norm.event_date,
                    norm.status,
                    JSON.stringify(norm)
                ).run();

                totalInserts++;
                this.log('info', `[${sport}] Novo evento inserido: ${norm.home_team} vs ${norm.away_team} (${norm.id})`);
            } catch (err: any) {
                // Ignore unique constraint violations (race conditions)
                if (!err.message.includes('UNIQUE')) {
                    this.log('error', `[${sport}] Falha ao inserir novo evento ${norm.id}:`, err.message);
                }
            }
          }
        }
    }

    return { updates: totalUpdates, inserts: totalInserts, total: totalUpdates + totalInserts, duration: Date.now() - Date.now(), logs: this.logs };
  }

  getLogs(): string[] {
    return this.logs;
  }
}
