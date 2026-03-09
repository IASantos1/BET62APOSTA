
export interface MarketMetadata {
    category: string;
    sub_category: string;
    name: string; // Display name
}

export function categorizeMarket(key: string, sport: string = 'soccer'): MarketMetadata {
    const k = key.toLowerCase();

    // 1. Mercado Raiz (Root) - The Odds API Source
    if (k === 'h2h' || k === 'match_winner' || k === 'moneyline' || k === '1x2') {
        return { category: 'Mercado Raiz', sub_category: 'Vencedor da partida', name: 'Vencedor da Partida' };
    }
    if (k === 'double_chance' || k === 'doublechance') {
        return { category: 'Mercado Raiz', sub_category: 'Dupla Chance', name: 'Dupla Chance' };
    }
    if (k === 'draw_no_bet' || k === 'dnb') {
        return { category: 'Mercado Raiz', sub_category: 'Empate Anula', name: 'Empate Anula Aposta' };
    }

    // 2. Mercados de Totais (Total Markets)
    if (k === 'totals' || k.includes('over_under') || k === 'goals_over_under' || k === 'exact_goals' || k === 'total_goals') {
        const s = sport.toLowerCase();
        let label = 'Total de Gols';
        if (s.includes('basket') || s.includes('nba') || s.includes('nfl') || s.includes('american')) label = 'Total de Pontos';
        if (s.includes('tennis')) label = 'Total de Games';
        if (s.includes('baseball') || s.includes('mlb')) label = 'Total de Corridas';
        
        return { category: 'Mercados de Totais', sub_category: 'Total do Jogo', name: label };
    }
    if (k === 'btts' || k === 'both_teams_to_score') {
        return { category: 'Mercados de Totais', sub_category: 'Ambas Marcam', name: 'Ambas Marcam' };
    }
    if (k === 'odd_even' || k === 'goals_odd_even') {
        return { category: 'Mercados de Totais', sub_category: 'Ímpar / Par', name: 'Gols Ímpar/Par' };
    }
    if (k.includes('team_total')) {
         return { category: 'Mercados de Totais', sub_category: 'Total por Time', name: 'Total do Time' };
    }

    // 3. Mercados de Pontos (Points/Handicap)
    if (k === 'spreads' || k.includes('handicap') || k.includes('point_spread')) {
        return { category: 'Mercados de Pontos', sub_category: 'Handicap', name: 'Handicap' };
    }

    // 4. Mercados Temporais (Time based)
    if (k.includes('1st_half') || k.includes('first_half') || k.includes('half_time')) {
        if (k.includes('h2h') || k.includes('winner')) return { category: 'Mercados Temporais', sub_category: '1º Tempo', name: 'Vencedor 1º Tempo' };
        if (k.includes('goals') || k.includes('totals')) return { category: 'Mercados Temporais', sub_category: '1º Tempo', name: 'Gols 1º Tempo' };
        return { category: 'Mercados Temporais', sub_category: '1º Tempo', name: '1º Tempo' };
    }
    if (k.includes('2nd_half') || k.includes('second_half')) {
        return { category: 'Mercados Temporais', sub_category: '2º Tempo', name: '2º Tempo' };
    }
    if (k.includes('quarter') || k.includes('period')) {
        return { category: 'Mercados Temporais', sub_category: 'Períodos', name: 'Por Período' };
    }
    if (k === 'ht_ft' || k === 'half_time_full_time') {
        return { category: 'Mercados Temporais', sub_category: 'Intervalo/Final', name: 'Intervalo / Final' };
    }

    // 5. Mercados de Ritmo (Pace/Flow)
    if (k.includes('race_to') || k.includes('first_to_score') || k.includes('next_goal') || k.includes('to_qualify')) {
        return { category: 'Mercados de Ritmo', sub_category: 'Corrida/Próximo', name: 'Ritmo de Jogo' };
    }

    // 6. Mercados de Jogadores (Player Props)
    if (k.includes('player') || k.includes('scorer') || k.includes('anytime') || k.includes('touchdown') || k.includes('assist') || k.includes('rebound')) {
        return { category: 'Mercados de Jogadores', sub_category: 'Jogadores', name: 'Estatísticas de Jogadores' };
    }

    // 7. Mercados Especiais (Specials)
    if (k.includes('corner')) {
        return { category: 'Mercados Especiais', sub_category: 'Escanteios', name: 'Escanteios' };
    }
    if (k.includes('card') || k.includes('booking')) {
        return { category: 'Mercados Especiais', sub_category: 'Cartões', name: 'Cartões' };
    }
    if (k.includes('penalty') || k.includes('method') || k.includes('outright') || k.includes('special')) {
         return { category: 'Mercados Especiais', sub_category: 'Especiais', name: 'Apostas Especiais' };
    }
    if (k === 'correct_score' || k === 'score_exact') {
        return { category: 'Mercados Especiais', sub_category: 'Placar Exato', name: 'Placar Exato' };
    }

    // Default / Outros
    return { category: 'Outros Mercados', sub_category: 'Geral', name: key.replace(/_/g, ' ').toUpperCase() };
}
