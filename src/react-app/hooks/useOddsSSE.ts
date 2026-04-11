import { useEffect, useMemo, useState } from 'react';

type OddsStreamMessage =
  | { type: 'hello'; id: string }
  | { type: 'ping' }
  | { type: 'bye' }
  | { type: 'error'; error: string }
  | { type: 'odds'; id: string; markets?: Record<string, any[]>; home_odd?: number; draw_odd?: number; away_odd?: number; updated_at?: string; provider?: string };

const GROUP_TO_CATEGORY: Record<string, string> = {
  RESULT: 'Mercados de Resultado',
  GOALS: 'Mercados de Gols',
  TIME: 'Mercados Temporais',
  STATS: 'Mercados Estatísticos',
  SPECIAL: 'Mercados Especiais',
};

const MARKET_META_BY_KEY: Record<string, { type: string; group: keyof typeof GROUP_TO_CATEGORY; label: string }> = {
  h2h: { type: '1X2', group: 'RESULT', label: 'Resultado Final' },
  double_chance: { type: 'DOUBLE_CHANCE', group: 'RESULT', label: 'Dupla Chance' },
  dnb: { type: 'DNB', group: 'RESULT', label: 'Empate Anula' },
  to_qualify: { type: 'TO_QUALIFY', group: 'RESULT', label: 'Qualificar-se' },
  half_time_result: { type: 'HT_RESULT', group: 'TIME', label: 'Resultado 1ª Parte' },
  second_half_result: { type: '2H_RESULT', group: 'TIME', label: 'Resultado 2ª Parte' },
  totals: { type: 'OVER_UNDER', group: 'GOALS', label: 'Mais/Menos' },
  team_totals: { type: 'TEAM_TOTALS', group: 'GOALS', label: 'Total por Equipa' },
  btts: { type: 'BTTS', group: 'GOALS', label: 'Ambas Marcam' },
  both_teams_to_score_both_halves: { type: 'BTTS_BOTH_HALVES', group: 'GOALS', label: 'Ambas Marcam (Ambas Partes)' },
  first_goal: { type: 'FIRST_GOAL', group: 'GOALS', label: 'Primeiro a Marcar' },
  last_goal: { type: 'LAST_GOAL', group: 'GOALS', label: 'Último a Marcar' },
  exact_total_goals: { type: 'EXACT_GOALS', group: 'GOALS', label: 'Número Exato de Gols' },
  goals_interval: { type: 'GOALS_INTERVAL', group: 'GOALS', label: 'Intervalo de Gols' },
  result_btts: { type: 'RESULT_BTTS', group: 'SPECIAL', label: 'Resultado & Ambas Marcam' },
  totals_btts: { type: 'TOTALS_BTTS', group: 'SPECIAL', label: 'Mais/Menos & Ambas Marcam' },
  spreads: { type: 'HANDICAP', group: 'GOALS', label: 'Handicap Asiático' },
  half_time_full_time: { type: 'HT_FT', group: 'TIME', label: 'Intervalo/Final' },
  correct_score: { type: 'CORRECT_SCORE', group: 'SPECIAL', label: 'Placar Exato' },
  total_goal_odd_even: { type: 'ODD_EVEN', group: 'SPECIAL', label: 'Ímpar/Par' },
  corners_totals: { type: 'CORNERS', group: 'STATS', label: 'Escanteios (Over/Under)' },
  corners_exact: { type: 'CORNERS_EXACT', group: 'STATS', label: 'Escanteios (Exato)' },
  corners_range: { type: 'CORNERS_RANGE', group: 'STATS', label: 'Escanteios (Intervalo)' },
  corners_handicap: { type: 'CORNERS_HCP', group: 'STATS', label: 'Escanteios Handicap' },
  first_to_x_corners: { type: 'FIRST_TO_X_CORNERS', group: 'STATS', label: 'Primeiro a bater X cantos' },
  cards_totals: { type: 'CARDS', group: 'STATS', label: 'Cartões' },
  red_card_yes_no: { type: 'RED_CARD', group: 'STATS', label: 'Cartão Vermelho' },
  shots_totals: { type: 'SHOTS', group: 'STATS', label: 'Total de Chutes' },
  shots_on_target: { type: 'SHOTS_ON_TARGET', group: 'STATS', label: 'Chutes no Alvo' },
  fouls_totals: { type: 'FOULS', group: 'STATS', label: 'Faltas' },
  possession: { type: 'POSSESSION', group: 'STATS', label: 'Posse de Bola' },
  player_to_score_anytime: { type: 'PLAYER_SCORE_ANYTIME', group: 'SPECIAL', label: 'Marcar a Qualquer Momento' },
  player_first_goal: { type: 'PLAYER_FIRST_GOAL', group: 'SPECIAL', label: 'Primeiro a Marcar' },
  player_last_goal: { type: 'PLAYER_LAST_GOAL', group: 'SPECIAL', label: 'Último a Marcar' },
};

function decorateMarkets(markets: Record<string, any[]>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, arr] of Object.entries(markets || {})) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const meta = MARKET_META_BY_KEY[key] || null;
    if (!meta) {
      out[key] = { outcomes: arr };
      continue;
    }
    out[key] = {
      type: meta.type,
      group: meta.group,
      label: meta.label,
      category: GROUP_TO_CATEGORY[meta.group] || 'Outros Mercados',
      sub_category: meta.label,
      outcomes: arr,
    };
  }
  return out;
}

export function useOddsSSE(eventId: string, enabled: boolean) {
  const [markets, setMarkets] = useState<Record<string, any[]> | null>(null);
  const [eventOdds, setEventOdds] = useState<Record<string, any> | null>(null);
  const [primaryOdds, setPrimaryOdds] = useState<{ home_odd?: number; draw_odd?: number; away_odd?: number; provider?: string; updated_at?: string } | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(0);
  const [nonce, setNonce] = useState(0);

  const url = useMemo(() => {
    const id = String(eventId || '').trim();
    if (!id) return '';
    return `/api/odds/stream?id=${encodeURIComponent(id)}`;
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    if (!url) return;
    if (typeof window === 'undefined' || !('EventSource' in window)) return;

    let alive = true;
    const es = new EventSource(url);
    setIsConnected(true);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || '{}')) as OddsStreamMessage;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'odds') {
          if (msg.markets && typeof msg.markets === 'object') {
            setMarkets(msg.markets);
            setEventOdds(decorateMarkets(msg.markets));
          }
          if (typeof msg.home_odd === 'number' || typeof msg.draw_odd === 'number' || typeof msg.away_odd === 'number') {
            setPrimaryOdds({
              home_odd: typeof msg.home_odd === 'number' ? msg.home_odd : undefined,
              draw_odd: typeof msg.draw_odd === 'number' ? msg.draw_odd : undefined,
              away_odd: typeof msg.away_odd === 'number' ? msg.away_odd : undefined,
              provider: msg.provider,
              updated_at: msg.updated_at,
            });
          }
          setLastUpdatedAt(Date.now());
        }
        if (msg.type === 'bye') {
          setIsConnected(false);
          try { es.close(); } catch { void 0; }
          setTimeout(() => { if (alive) setNonce((n) => n + 1); }, 150);
        }
        if (msg.type === 'error') {
          setIsConnected(false);
        }
      } catch { void 0; }
    };

    es.onerror = () => {
      setIsConnected(false);
      try { es.close(); } catch { void 0; }
      setTimeout(() => { if (alive) setNonce((n) => n + 1); }, 500);
    };

    return () => {
      alive = false;
      try { es.close(); } catch { void 0; }
    };
  }, [enabled, url, nonce]);

  return { markets, eventOdds, primaryOdds, isConnected, lastUpdatedAt };
}
