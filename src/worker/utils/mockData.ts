
import { Env } from '../../shared/types';

export const generateMockData = async (env: Env) => {
    const now = new Date();
    
    // Helper to format date
    const addHours = (d: Date, h: number) => {
        const newD = new Date(d);
        newD.setHours(newD.getHours() + h);
        return newD.toISOString();
    };

    const mockEvents = [
        // LIVE GAMES
        {
            id: '10001',
            sport: 'soccer',
            is_live: 1,
            event_date: addHours(now, -1), // Started 1 hour ago
            status: '2H',
            league: 'Champions League',
            country: 'Europa',
            home: 'Real Madrid',
            away: 'Barcelona',
            score: '2-1',
            elapsed: 75
        },
        {
            id: '10002',
            sport: 'soccer',
            is_live: 1,
            event_date: addHours(now, -0.5), // Started 30 mins ago
            status: '1H',
            league: 'Premier League',
            country: 'Inglaterra',
            home: 'Manchester City',
            away: 'Liverpool',
            score: '0-0',
            elapsed: 30
        },
        // UPCOMING GAMES (Today)
        {
            id: '20001',
            sport: 'soccer',
            is_live: 0,
            event_date: addHours(now, 2),
            status: 'NS',
            league: 'Ligue 1',
            country: 'França',
            home: 'PSG',
            away: 'Lyon',
            score: null,
            elapsed: null
        },
        {
            id: '20002',
            sport: 'soccer',
            is_live: 0,
            event_date: addHours(now, 5),
            status: 'NS',
            league: 'Serie A',
            country: 'Itália',
            home: 'Juventus',
            away: 'AC Milan',
            score: null,
            elapsed: null
        },
        // UPCOMING GAMES (Tomorrow)
        {
            id: '30001',
            sport: 'soccer',
            is_live: 0,
            event_date: addHours(now, 25),
            status: 'NS',
            league: 'Bundesliga',
            country: 'Alemanha',
            home: 'Bayern Munich',
            away: 'Dortmund',
            score: null,
            elapsed: null
        }
    ];

    // First delete existing mocks to avoid conflicts
    const ids = mockEvents.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM imported_odds WHERE id IN (${placeholders})`).bind(...ids).run();
    await env.DB.prepare(`DELETE FROM events WHERE external_event_id IN (${placeholders})`).bind(...ids).run();

    const stmt = env.DB.prepare(`
        INSERT INTO imported_odds (
            id, sport, is_live, event_date, status, league_name, home_team, away_team, payload, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const eventStmt = env.DB.prepare(`
        INSERT INTO events (
            external_event_id, external_provider, sport, league, home_team, away_team, 
            team_match, event_date, start_time, is_live, score, 
            home_odd, draw_odd, away_odd
        ) VALUES (?, 'mock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batch = [];
    
    for (const evt of mockEvents) {
        const payload = {
            fixture: {
                id: Number(evt.id), // Payload usually has number ID
                date: evt.event_date,
                status: { short: evt.status, elapsed: evt.elapsed },
                league: { name: evt.league, country: evt.country },
                home_team: { name: evt.home, logo: '' },
                away_team: { name: evt.away, logo: '' },
                goals: { 
                    home: evt.score ? Number(evt.score.split('-')[0]) : null, 
                    away: evt.score ? Number(evt.score.split('-')[1]) : null 
                },
                elapsed: evt.elapsed
            },
            league: { name: evt.league, country: 'World' },
            home_team: evt.home,
            away_team: evt.away,
            sport: evt.sport,
            odds: {
                h2h: [
                    { outcome: 'Home', value: 1.85, label: 'Home' },
                    { outcome: 'Draw', value: 3.50, label: 'Draw' },
                    { outcome: 'Away', value: 4.20, label: 'Away' }
                ]
            }
        };

        batch.push(stmt.bind(
            evt.id,
            evt.sport,
            evt.is_live,
            evt.event_date,
            evt.status,
            evt.league,
            evt.home,
            evt.away,
            JSON.stringify(payload),
            new Date().toISOString()
        ));
        
        batch.push(eventStmt.bind(
            evt.id,
            evt.sport,
            evt.league,
            evt.home,
            evt.away,
            `${evt.home} vs ${evt.away}`,
            evt.event_date,
            evt.event_date,
            evt.is_live,
            evt.score || '0-0',
            1.85,
            3.50,
            4.20
        ));
    }

    await env.DB.batch(batch);
    return { count: mockEvents.length };
};
