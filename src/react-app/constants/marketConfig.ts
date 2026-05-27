// Configuração completa de mercados por esporte
export const MARKET_CONFIG: Record<string, { title: string, grid?: string }> = {
  // Soccer / Generic
  h2h: { title: 'Resultado Final' },
  totals: { title: 'Golos/Pontos Totais' },
  spreads: { title: 'Handicap Asiático' },
  handicap: { title: 'Handicap' }, // Added for consistency with backend
  btts: { title: 'Ambas Marcam' },
  correct_score: { title: 'Resultado Exacto', grid: 'grid-cols-3 md:grid-cols-4' },
  double_chance: { title: 'Dupla Chance' },
  dnb: { title: 'Empate Anula Aposta' },
  result_including_extra_time: { title: 'Resultado Incluindo Prolongamento' },

  // AFL
  player_goals: { title: 'Golos do Jogador' },
  player_points: { title: 'Pontos do Jogador' },
  player_props: { title: 'Props de Jogador' }, // Generic player props
  quarters_h2h: { title: 'Vencedor do Quarto' },
  quarters_totals: { title: 'Total do Quarto' },
  halves_h2h: { title: 'Vencedor do Tempo' },
  halves_totals: { title: 'Total do Tempo' },
  margin: { title: 'Margem de Vitória' },
  first_goal: { title: 'Primeiro Golo' },
  "winning_margin_10+": { title: 'Margem de Vitória 10+' },
  scoring_runs: { title: 'Sequência de Pontuação' },
  match_parlay: { title: 'Parlay da Partida' },

  // Basketball
  player_rebounds: { title: 'Rebotes do Jogador' },
  player_assists: { title: 'Assistências do Jogador' },
  team_totals: { title: 'Total da Equipa' },
  first_to_score: { title: 'Primeiro a Marcar' },
  quarter_point_diff: { title: 'Diferença de Pontos no Quarto' },
  team_parlay: { title: 'Parlay da Equipa' },
  player_double_double: { title: 'Duplo-Duplo do Jogador' },

  // Baseball
  player_runs: { title: 'Corridas do Jogador' },
  player_hits: { title: 'Rebatidas do Jogador' },
  player_home_runs: { title: 'Home Runs do Jogador' },
  inning_h2h: { title: 'Vencedor do Inning' },
  inning_totals: { title: 'Total do Inning' },
  first_inning_h2h: { title: 'Vencedor do 1º Inning' },
  first_inning_totals: { title: 'Total do 1º Inning' },
  player_strikeouts: { title: 'Strikeouts do Jogador' },
  player_rbi: { title: 'Corridas Impulsionadas do Jogador' },
  run_line: { title: 'Linha de Corrida' },
  puck_line: { title: 'Linha de Puck' },

  // F1
  podium: { title: 'Pódio' },
  race_winner: { title: 'Vencedor da Corrida' },
  podium_finish: { title: 'Pódio' },
  top_10_finish: { title: 'Top 10' },
  safety_car: { title: 'Carro de Segurança' },
  pole_position: { title: 'Pole Position' },
  fastest_lap: { title: 'Volta Mais Rápida' },
  constructor_winner: { title: 'Construtor Vencedor' },
  top_3_finish: { title: 'Top 3' },
  head_to_head_drivers: { title: 'H2H Pilotos' },
  top_5_finish: { title: 'Top 5' },
  driver_fastest_sector: { title: 'Piloto com Setor Mais Rápido' },
  first_lap_leader: { title: 'Líder da 1ª Volta' },
  retirement: { title: 'Abandono' },

  // Soccer (Additional)
  corners_team: { title: 'Cantos por Equipa' },
  corners_total: { title: 'Total de Cantos' },
  corners_totals: { title: 'Total de Cantos' },
  cards_total: { title: 'Total de Cartões' },
  cards_totals: { title: 'Total de Cartões' },
  corners_btts: { title: 'Cantos e Ambas Marcam' },
  yellow_cards_player: { title: 'Cartão Amarelo para Jogador' },
  red_cards_player: { title: 'Cartão Vermelho para Jogador' },
  minute_goals: { title: 'Golo no Minuto' },
  score_exact: { title: 'Resultado Exacto' },
  first_goal_scorer: { title: 'Primeiro Marcador' },
  player_goal_scorer_anytime: { title: 'Jogador a Marcar a Qualquer Momento' },
  penalty_scored: { title: 'Penálti Marcado' },
  own_goal: { title: 'Auto-golo' },
  team_clean_sheet: { title: 'Baliza a Zero da Equipa' },
  corner_handicap: { title: 'Handicap de Cantos' },
  total_goal_odd_even: { title: 'Total de Golos (Par/Ímpar)' },
  half_time_full_time: { title: 'Intervalo/Final' },
  winning_margin: { title: 'Margem de Vitória' },
  next_goal: { title: 'Próximo Golo' },
  first_half_h2h: { title: '1º Tempo - Resultado' },
  second_half_h2h: { title: '2º Tempo - Resultado' },
  first_half_totals: { title: '1º Tempo - Totais' },
  second_half_totals: { title: '2º Tempo - Totais' },
  anytime_goal_scorer: { title: 'Marcador a Qualquer Momento' },
  btts_first_half: { title: 'Ambas Marcam no 1º Tempo' },

  // American Football
  player_touchdowns: { title: 'Touchdowns do Jogador' },
  player_yards: { title: 'Jardas do Jogador' },
  first_score_type: { title: 'Tipo de Primeira Pontuação' },
  team_to_score_first: { title: 'Equipa a Marcar Primeiro' },
  team_to_score_last: { title: 'Equipa a Marcar por Último' },
  player_receptions: { title: 'Recepções do Jogador' },

  // Handball
  quarter_h2h: { title: 'Vencedor do Quarto' },
  quarter_totals: { title: 'Total do Quarto' },
  fastest_goal: { title: 'Gol Mais Rápido' },
  most_goals_half: { title: 'Parte com Mais Gols' },

  // Hockey
  period_h2h: { title: 'Vencedor do Período' },
  period_totals: { title: 'Total do Período' },
  shots_on_goal: { title: 'Remates à Baliza' },
  penalty_minutes: { title: 'Minutos de Penalização' },
  power_play_goals: { title: 'Golos em Power Play' },
  puck_possession: { title: 'Posse do Puck' },

  // MMA
  method: { title: 'Método de Vitória' },
  rounds: { title: 'Rondas' },
  total_rounds: { title: 'Total de Rondas' },
  over_under_rounds: { title: 'Mais/Menos Rondas' },
  finish_method_round: { title: 'Método de Finalização e Ronda' },
  knockout_draw: { title: 'Nocaute ou Empate' },
  first_round_finish: { title: 'Finalização na 1ª Ronda' },
  submission_only: { title: 'Apenas Finalização' },
  decision_type: { title: 'Tipo de Decisão' },
  total_strikes: { title: 'Total de Golpes' },

  // Rugby
  player_tries: { title: 'Tries do Jogador' },
  conversion_success: { title: 'Conversão Bem-sucedida' },
  penalty_goals: { title: 'Golos de Penálti' },
  "winning_margin_15+": { title: 'Margem de Vitória 15+' },

  // Tennis
  sets_handicap: { title: 'Handicap de Sets' },
  player_games: { title: 'Jogos do Jogador' },
  set_winner: { title: 'Vencedor do Set' },
  sets_h2h: { title: 'Vencedor do Set' }, // Mapped from set_winner
  tie_breaks: { title: 'Tie-breaks' },
  tie_break: { title: 'Tie-break' }, // Singular mapped
  match_total_games: { title: 'Total de Jogos na Partida' },
  first_set_winner: { title: 'Vencedor do 1º Set' },
  first_serve_winner: { title: 'Vencedor do 1º Saque' },
  aces_total: { title: 'Total de Ases' },
  double_faults_total: { title: 'Total de Duplas Faltas' },
  break_points: { title: 'Pontos de Break' },

  // Volleyball
  sets_winner: { title: 'Vencedor do Set' },
  set_total_points: { title: 'Total de Pontos no Set' },
  total_aces: { title: 'Total de Ases' },
  total_blocks: { title: 'Total de Bloqueios' },
  set_point_diff: { title: 'Diferença de Pontos no Set' }
};

// Configuração de Ordem e Mercados por Esporte
export const MARKET_GROUPS = [
  {
    title: "Mercado Base",
    keys: ["h2h", "totals", "btts", "handicap", "spreads"]
  },
  {
    title: "Mercados de Resultado",
    keys: ["double_chance", "dnb", "draw_no_bet", "correct_score", "half_time_full_time", "winning_margin", "result_including_extra_time", "halves_h2h", "winning_margin_10+", "margin"]
  },
  {
    title: "Mercados de Golos",
    keys: ["btts", "btts_first_half", "team_totals", "first_goal_scorer", "anytime_goal_scorer", "score_exact", "first_to_score", "team_to_score_first", "team_to_score_last", "goal_range", "exact_goals", "minute_goals", "first_goal", "last_goal", "next_goal", "total_goal_odd_even", "both_teams_to_score_both_halves"]
  },
  {
    title: "Mercados Temporais",
    keys: ["first_half_h2h", "second_half_h2h", "first_half_totals", "second_half_totals", "halves_totals", "quarters_h2h", "quarters_totals", "sets_winner", "sets_handicap", "sets_h2h", "first_set_winner", "period_h2h", "period_totals", "inning_h2h", "inning_totals"]
  },
  {
    title: "Mercados Estatísticos",
    keys: ["corners_total", "cards_total", "corners_team", "corners_totals", "corner_handicap", "corners_h2h", "corners_btts", "cards_totals", "cards_h2h", "cards_handicap", "total_aces", "total_double_faults", "shots_on_goal", "total_strikes", "puck_possession", "run_line", "puck_line"]
  },
  {
    title: "Mercados de Jogadores",
    keys: ["first_goal_scorer", "anytime_goal_scorer", "player_goal_scorer_anytime", "player_goals", "player_points", "player_rebounds", "player_assists", "player_props", "yellow_cards_player", "red_cards_player", "player_touchdowns", "player_yards", "player_receptions", "player_tries", "player_games", "player_runs", "player_hits", "player_home_runs", "player_strikeouts", "player_rbi"]
  },
  {
    title: "Mercados Especiais",
    keys: ["penalty_scored", "own_goal", "team_clean_sheet", "match_parlay", "qualification", "to_qualify", "method", "rounds", "total_rounds", "over_under_rounds"]
  }
];

export const BASKETBALL_GROUPS = [
  { title: "Todos", keys: ["h2h","totals","team_totals","spreads","handicap","quarters_h2h","quarters_totals","quarter_point_diff","halves_h2h","halves_totals","race_to","first_to_score","player_points","player_rebounds","player_assists","player_threes","player_double_double","player_props","match_parlay","team_parlay"] },
  { title: "Vencedor", keys: ["h2h"] },
  { title: "Totais", keys: ["totals","team_totals"] },
  { title: "Spread", keys: ["spreads","handicap"] },
  { title: "Quartos", keys: ["quarters_h2h","quarters_totals","quarter_point_diff"] },
  { title: "Times", keys: ["team_totals","race_to","first_to_score","team_parlay","match_parlay"] }
];

export const TENNIS_GROUPS = [
  { title: "Todos", keys: ["h2h","set_winner","first_set_winner","second_set_winner","third_set_winner","sets_winner","sets_h2h","total_sets","over_under_sets","player_to_win_a_set","to_win_a_set","spreads","handicap","sets_handicap","totals","match_total_games","set_total_games","player_games","correct_score","score_exact","tie_break","tie_breaks","total_aces","aces_total","double_faults_total","break_points","to_qualify"] },
  { title: "Vencedor", keys: ["h2h"] },
  { title: "Sets", keys: ["set_winner","first_set_winner","second_set_winner","third_set_winner","sets_winner","sets_h2h","total_sets","over_under_sets","player_to_win_a_set","to_win_a_set"] },
  { title: "Handicap", keys: ["sets_handicap","spreads","handicap"] },
  { title: "Jogos", keys: ["totals","match_total_games","set_total_games","player_games"] },
  { title: "Placar Exato", keys: ["correct_score","score_exact"] },
  { title: "Especiais", keys: ["tie_break","tie_breaks","total_aces","aces_total","double_faults_total","break_points","to_qualify"] }
];

export const VOLLEYBALL_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "spreads", "handicap", "totals"]
    },
    {
        title: "Escada de Sets",
        keys: ["total_sets", "over_under_sets"]
    },
    {
        title: "Mercados de Placares em Sets",
        keys: ["correct_score", "sets_h2h", "sets_winner", "sets_handicap"]
    },
    {
        title: "Mercados de Pontos",
        keys: ["total_points", "set_total_points", "first_set_total", "second_set_total", "third_set_total", "fourth_set_total", "fifth_set_total", "point_handicap"]
    },
    {
        title: "Mercados Temporais",
        keys: ["first_set_winner", "second_set_winner", "third_set_winner", "fourth_set_winner", "fifth_set_winner", "to_win_a_set"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["sets_handicap", "point_handicap", "winning_margin"]
    }
];

export const AFL_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "spreads", "handicap", "totals"]
    },
    {
        title: "Escada de Totais",
        keys: ["totals"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["double_chance", "winning_margin", "winning_margin_5+", "half_time_full_time"]
    },
    {
        title: "Mercados de Pontos",
        keys: ["team_totals", "race_to", "highest_scoring_quarter", "first_to_score"]
    },
    {
        title: "Mercados Temporais",
        keys: ["quarters_h2h", "quarters_totals", "halves_h2h", "halves_totals"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["handicap", "winning_margin", "quarter_handicap"]
    }
];

export const BASEBALL_GROUPS = [
  { title: "Todos", keys: ["h2h","totals","team_totals","run_line","spreads","handicap","innings_h2h","innings_totals","inning_winner","result_1st_inning","race_to","first_to_score","extra_innings","run_range","winning_margin","player_runs","player_hits","player_home_runs","player_strikeouts","player_rbi"] },
  { title: "Resultado", keys: ["h2h","inning_winner","result_1st_inning","winning_margin"] },
  { title: "Corridas", keys: ["totals","team_totals","innings_totals","race_to","run_range"] },
  { title: "Run Line", keys: ["run_line","spreads","handicap"] }
];

export const FORMULA1_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["race_winner", "winner", "h2h", "head_to_head", "top_3_finish", "podium_finish"]
    },
    {
        title: "Escada de Linhas",
        keys: ["top_2_finish", "top_3_finish", "top_5_finish", "top_10_finish", "laps_led", "safety_car"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["race_winner", "podium_finish", "h2h", "double_chance", "winning_margin"]
    },
    {
        title: "Mercados de Voltas e Performance",
        keys: ["fastest_lap", "laps_led", "first_to_lead", "most_laps_led"]
    },
    {
        title: "Mercados de Incidentes e Estratégia",
        keys: ["safety_car", "to_finish", "dnf", "total_pit_stops", "first_pit_stop", "winner_and_pole"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["finishing_position_handicap", "laps_led_handicap", "winning_margin"]
    }
];

export const AMERICAN_FOOTBALL_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "spreads", "handicap", "totals"]
    },
    {
        title: "Escada de Totais",
        keys: ["totals"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["double_chance", "winning_margin", "quarter_winner", "half_time_full_time"]
    },
    {
        title: "Mercados de Pontos",
        keys: ["team_totals", "total_points_range", "first_to_score", "quarters_totals", "halves_totals"]
    },
    {
        title: "Mercados Estatísticos",
        keys: ["player_pass_yards", "player_rush_yards", "player_reception_yards", "player_anytime_td", "player_field_goals", "player_props"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["spreads", "handicap", "quarter_handicap", "winning_margin"]
    }
];

export const HANDBALL_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "spreads", "handicap", "totals"]
    },
    {
        title: "Escada de Totais",
        keys: ["totals"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["h2h", "halves_h2h", "half_time_full_time", "winning_margin"]
    },
    {
        title: "Mercados de Gols",
        keys: ["totals", "team_totals", "goals_range", "race_to", "halves_totals"]
    },
    {
        title: "Mercados Temporais",
        keys: ["halves_h2h", "halves_totals", "race_to", "highest_scoring_half"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["handicap", "spreads", "half_handicap", "winning_margin"]
    }
];

export const ICE_HOCKEY_GROUPS = [
  { title: "Todos", keys: ["h2h","totals","puck_line","spreads","handicap","team_totals","period_h2h","period_totals","period_1_h2h","period_2_h2h","period_3_h2h","period_1_totals","period_2_totals","period_3_totals","double_chance","first_to_score","highest_scoring_period","shots_on_goal","penalty_minutes","power_play_goals","winning_margin"] },
  { title: "Vencedor", keys: ["h2h"] },
  { title: "Totais", keys: ["totals","team_totals","period_totals","period_1_totals","period_2_totals","period_3_totals"] },
  { title: "Puck Line", keys: ["puck_line","spreads","handicap"] },
  { title: "1º Per.", keys: ["period_1_h2h","period_1_totals"] },
  { title: "2º Per.", keys: ["period_2_h2h","period_2_totals"] },
  { title: "3º Per.", keys: ["period_3_h2h","period_3_totals"] },
  { title: "Especiais", keys: ["double_chance","winning_margin","first_to_score","highest_scoring_period","shots_on_goal","penalty_minutes","power_play_goals"] }
];

export const MMA_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "totals", "method_of_victory"]
    },
    {
        title: "Escada de Rounds",
        keys: ["totals", "alternate_totals"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["h2h", "method_of_victory", "double_chance", "winning_round", "round_betting"]
    },
    {
        title: "Mercados de Rounds e Duração",
        keys: ["totals", "exact_winning_round", "first_to_score", "will_fight_go_the_distance", "fight_duration"]
    },
    {
        title: "Mercados de Performance",
        keys: ["method_of_victory", "total_knockdowns", "total_submissions", "fight_duration"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["round_handicap", "point_spread", "handicap"]
    }
];

export const RUGBY_GROUPS = [
    {
        title: "Mercado Raiz",
        keys: ["h2h", "totals", "handicap"]
    },
    {
        title: "Escada de Totais",
        keys: ["totals", "alternate_totals"]
    },
    {
        title: "Mercados de Resultado",
        keys: ["h2h", "winning_margin", "double_chance", "half_time_full_time"]
    },
    {
        title: "Mercados de Pontos",
        keys: ["team_totals", "race_to", "first_to_score"]
    },
    {
        title: "Mercados de Tries e Estatísticas",
        keys: ["player_tries", "total_tries", "first_try_scorer"]
    },
    {
        title: "Handicaps Estruturais",
        keys: ["handicap", "alternative_handicap", "winning_margin"]
    }
];
