
export function scoreEvent(event: any, meta: { is_live: number, event_date: string, league: string, home_team: string, away_team: string, sport: string }) {
    let score = 0;
    
    // 🔴 AO VIVO (Highest Priority)
    if (meta.is_live === 1 || event.status === 'live' || ['1H','2H','HT','ET','P','LIVE'].includes(event.status)) {
        score += 1000;
    }

    // ⏱️ Time Factor (Closer to start = higher score)
    const startTime = new Date(meta.event_date).getTime();
    const minutesUntil = (startTime - Date.now()) / 60000;
    
    // Starting soon (within 1h)
    if (minutesUntil <= 60 && minutesUntil > 0) score += 600; 
    // Today (within 6h)
    else if (minutesUntil <= 360 && minutesUntil > 0) score += 200; 
    
    // 🇧🇷 Region Priority (BR)
    const leagueNorm = (meta.league || '').toLowerCase();
    const homeNorm = (meta.home_team || '').toLowerCase();
    
    if (leagueNorm.includes('brasil') || leagueNorm.includes('brazil') || leagueNorm.includes('série a')) {
         if (meta.sport === 'soccer') score += 400;
    }

    // 🇪🇺 EU Top Leagues
    const topLeagues = [
        'premier league', 'la liga', 'bundesliga', 'serie a', 'ligue 1', 
        'champions league', 'europa league', 'copa libertadores', 'copa sudamericana'
    ];
    if (topLeagues.some(l => leagueNorm.includes(l))) {
        score += 300;
    }
    
    // 🚀 Boost (Simulated or Real)
    if (event.odd_boost) score += 400;

    // Classic "Derby" or Big Team detection (Simulated Volume)
    const bigTeams = ['flamengo', 'corinthians', 'palmeiras', 'real madrid', 'barcelona', 'manchester', 'liverpool', 'bayern', 'psg', 'benfica', 'porto', 'sporting'];
    if (bigTeams.some(t => homeNorm.includes(t) || (meta.away_team || '').toLowerCase().includes(t))) {
        score += 150;
    }

    return score;
}
