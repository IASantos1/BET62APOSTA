// 🎯 Markets - Índice Central de Mercados Multi-Desporto

// ⚽ Futebol (12 mercados)
export * from './football/matchWinner';
export * from './football/doubleChance';
export * from './football/overUnderGoals';
export * from './football/bothTeamsToScore';
export * from './football/correctScore';

// 🏀 Basquetebol (9 mercados)
export * from './basketball/matchWinner';
export * from './basketball/handicap';
export * from './basketball/overUnderPoints';

// ⚾ Basebol (8 mercados)
export * from './baseball/matchWinner';
export * from './baseball/totalRuns';
export * from './baseball/runLine';

// 🏒 Hóquei (7 mercados)
export * from './hockey/matchWinner';
export * from './hockey/puckLine';

// 🏉 Rugby (7 mercados)
export * from './rugby/matchWinner';
export * from './rugby/handicap';

// 🏐 Voleibol (7 mercados)
export * from './volleyball/matchWinner';
export * from './volleyball/setWinner';

// 🏎️ Fórmula 1 (6 mercados)
export * from './formula1/raceWinner';
export * from './formula1/podium';

// 🥊 MMA (6 mercados)
export * from './mma/fightWinner';
export * from './mma/methodOfVictory';

// 🏈 NFL (7 mercados)
export * from './nfl/matchWinner';
export * from './nfl/pointSpread';

// 🏉 AFL (6 mercados)
export * from './afl/matchWinner';

// 🤾 Andebol (6 mercados)
export * from './handball/matchWinner';
export * from './handball/handicap';

// Tipos de mercados por desporto
export const MARKETS_BY_SPORT = {
  football: [
    'match_winner',
    'double_chance',
    'over_under_goals',
    'both_teams_score',
    'correct_score',
    'half_time_full_time',
    'total_goals_even_odd',
    'first_goal_scorer',
    'anytime_goal_scorer',
    'corners_totals',
    'cards_totals',
    'penalties'
  ],
  basketball: [
    'match_winner',
    'handicap',
    'over_under_points',
    'quarter_winner',
    'first_quarter_points',
    'total_points_even_odd',
    'player_points',
    'team_total_points',
    'winning_margin'
  ],
  baseball: [
    'match_winner',
    'total_runs',
    'run_line',
    'first_inning_winner',
    'total_hits',
    'total_errors',
    'player_home_runs',
    'inning_by_inning_winner'
  ],
  hockey: [
    'match_winner',
    'over_under_goals',
    'puck_line',
    'period_winner',
    'total_goals_even_odd',
    'first_goal_scorer',
    'anytime_goal_scorer'
  ],
  rugby: [
    'match_winner',
    'handicap',
    'over_under_points',
    'first_try_scorer',
    'total_tries',
    'winning_margin',
    'team_total_points'
  ],
  volleyball: [
    'match_winner',
    'set_winner',
    'total_sets',
    'correct_score',
    'first_set_winner',
    'total_points_even_odd',
    'team_total_points'
  ],
  formula1: [
    'race_winner',
    'podium',
    'fastest_lap',
    'constructor_winner',
    'driver_dnf',
    'qualifying_winner'
  ],
  mma: [
    'fight_winner',
    'method_of_victory',
    'round_bet',
    'fight_to_go_distance',
    'first_round_ko',
    'total_rounds'
  ],
  nfl: [
    'match_winner',
    'point_spread',
    'over_under_points',
    'first_score_type',
    'winning_margin',
    'team_total_points',
    'player_touchdowns'
  ],
  afl: [
    'match_winner',
    'handicap',
    'over_under_points',
    'first_goal_scorer',
    'total_goals',
    'team_total_points'
  ],
  handball: [
    'match_winner',
    'handicap',
    'over_under_goals',
    'first_scorer',
    'total_goals_even_odd',
    'team_total_goals'
  ]
} as const;

// Mercados prioritários para live betting
export const LIVE_PRIORITY_MARKETS = {
  football: ['match_winner', 'over_under_goals', 'both_teams_score'],
  basketball: ['match_winner', 'over_under_points', 'handicap'],
  baseball: ['match_winner', 'total_runs', 'run_line'],
  hockey: ['match_winner', 'over_under_goals', 'puck_line'],
  rugby: ['match_winner', 'handicap', 'over_under_points'],
  volleyball: ['match_winner', 'set_winner', 'total_sets'],
  formula1: ['race_winner', 'podium', 'fastest_lap'],
  mma: ['fight_winner', 'method_of_victory', 'round_bet'],
  nfl: ['match_winner', 'point_spread', 'over_under_points'],
  afl: ['match_winner', 'handicap', 'over_under_points'],
  handball: ['match_winner', 'handicap', 'over_under_goals']
} as const;

// Contagem total de mercados por desporto
export const MARKET_COUNTS = {
  football: 12,
  basketball: 9,
  baseball: 8,
  hockey: 7,
  rugby: 7,
  volleyball: 7,
  formula1: 6,
  mma: 6,
  nfl: 7,
  afl: 6,
  handball: 6
} as const;

// Total de mercados implementados
export const TOTAL_MARKETS = Object.values(MARKET_COUNTS).reduce((sum, count) => sum + count, 0); // 81 mercados
