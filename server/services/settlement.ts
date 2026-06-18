// server/services/settlement.ts
// Robust bet settlement engine — handles all markets and sports.
// Uses SportsApiPro V1 (1s latency) for schedule/results + events cache.

import type pg from 'pg';
import { randomId } from '../lib/crypto.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchResult {
  eventId: string;
  sport: string;
  status: 'finished' | 'cancelled' | 'postponed' | 'abandoned';
  homeScore: number;
  awayScore: number;
  htHomeScore: number | null;
  htAwayScore: number | null;
  totalCorners: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  totalCards: number | null;
  homeCards: number | null;
  awayCards: number | null;
  homeName: string;
  awayName: string;
  score?: {
    sets?: {
      s1?: { home: number | null; away: number | null };
      s2?: { home: number | null; away: number | null };
      s3?: { home: number | null; away: number | null };
      s4?: { home: number | null; away: number | null };
      s5?: { home: number | null; away: number | null };
    };
    point?: { home?: any; away?: any };
  };
}

export type SelectionOutcome = 'won' | 'lost' | 'void';

export interface SettlementReport {
  totalChecked: number;
  totalSettled: number;
  totalWon: number;
  totalLost: number;
  totalVoid: number;
  totalCredited: number;
  errors: string[];
  eventsProcessed: string[];
}

// ── Score parsing ─────────────────────────────────────────────────────────────

function parseScore(scoreStr: string): { home: number; away: number } | null {
  if (!scoreStr) return null;
  const s = String(scoreStr).trim();
  // Formats: "2-1", "2:1", "2 - 1"
  const m1 = s.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (m1) return { home: Number(m1[1]), away: Number(m1[2]) };
  // Format: "Home 2 - Away 1" or "Team 2 : Team 1"
  const m2 = s.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (m2) return { home: Number(m2[1]), away: Number(m2[2]) };
  return null;
}

function parseHalfTimeScore(htStr: string | undefined | null): { home: number; away: number } | null {
  if (!htStr) return null;
  return parseScore(String(htStr));
}

// ── Selection normalisation ───────────────────────────────────────────────────

function normSel(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseLineFromLabel(label: string): number | null {
  const m = label.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

// ── Core evaluator ────────────────────────────────────────────────────────────
// Returns 'won', 'lost', or 'void'.
// `market` is the canonical market key (h2h, totals, btts, etc.)
// `selection` is the stored label string.

export function evaluateSelection(
  market: string,
  selection: string,
  result: MatchResult,
): SelectionOutcome {
  const { homeScore, awayScore, htHomeScore, htAwayScore } = result;
  const totalGoals = homeScore + awayScore;
  const htTotal = htHomeScore !== null && htAwayScore !== null ? htHomeScore + htAwayScore : null;
  const sel = normSel(selection);
  const mkKey = String(market || '').toLowerCase().trim();

  // ── Cancelled / Postponed → void all ───────────────────────────────────────
  if (result.status === 'cancelled' || result.status === 'postponed' || result.status === 'abandoned') {
    return 'void';
  }

  // ── h2h / 1x2 / match_winner / moneyline ───────────────────────────────────
  if (
    mkKey === 'h2h' || mkKey === '1x2' || mkKey === 'match_winner' ||
    mkKey === 'moneyline' || mkKey === 'resultado_final' || mkKey === '' ||
    mkKey === 'winner'
  ) {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    if (sel === '1' || sel === 'home' || sel === 'casa' || sel === 'mandante') return homeWins ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return draw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora' || sel === 'visitante') return awayWins ? 'won' : 'lost';
    // Fallback: check if selection contains home/away team name
    if (result.homeName && sel.includes(normSel(result.homeName))) return homeWins ? 'won' : 'lost';
    if (result.awayName && sel.includes(normSel(result.awayName))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── double_chance ───────────────────────────────────────────────────────────
  if (mkKey === 'double_chance' || mkKey === 'dupla_hipotese') {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    if (sel === '1x' || sel === '1 x') return (homeWins || draw) ? 'won' : 'lost';
    if (sel === 'x2' || sel === 'x 2') return (awayWins || draw) ? 'won' : 'lost';
    if (sel === '12' || sel === '1 2') return (homeWins || awayWins) ? 'won' : 'lost';
    return 'void';
  }

  // ── dnb / draw_no_bet ───────────────────────────────────────────────────────
  if (mkKey === 'dnb' || mkKey === 'draw_no_bet' || mkKey === 'empate_anula') {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    if (draw) return 'void';
    if (sel === 'home' || sel === 'casa' || sel === '1') return homeWins ? 'won' : 'lost';
    if (sel === 'away' || sel === 'fora' || sel === '2') return awayWins ? 'won' : 'lost';
    if (result.homeName && sel.includes(normSel(result.homeName))) return homeWins ? 'won' : 'lost';
    if (result.awayName && sel.includes(normSel(result.awayName))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── btts / both_teams_to_score ──────────────────────────────────────────────
  if (
    mkKey === 'btts' || mkKey === 'both_teams_to_score' ||
    mkKey === 'ambas_marcam' || mkKey === 'gg_ng'
  ) {
    const bothScored = homeScore > 0 && awayScore > 0;
    const yes = sel === 'sim' || sel === 'yes' || sel === 's' || sel === 'gg' || sel.includes('sim') || sel.includes('ambas');
    const no = sel === 'nao' || sel === 'no' || sel === 'n' || sel === 'ng' || sel.includes('nao') || sel.includes('nenhuma');
    if (yes) return bothScored ? 'won' : 'lost';
    if (no) return bothScored ? 'lost' : 'won';
    return 'void';
  }

  // ── btts_first_half ─────────────────────────────────────────────────────────
  if (mkKey === 'btts_first_half' || mkKey === 'btts_1st_half') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const both = htHomeScore > 0 && htAwayScore > 0;
    const yes = sel === 'sim' || sel === 'yes' || sel.includes('sim');
    const no = sel === 'nao' || sel === 'no' || sel.includes('nao');
    if (yes) return both ? 'won' : 'lost';
    if (no) return both ? 'lost' : 'won';
    return 'void';
  }

  // ── btts_second_half ────────────────────────────────────────────────────────
  if (mkKey === 'btts_second_half' || mkKey === 'btts_2nd_half') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shHome = homeScore - htHomeScore;
    const shAway = awayScore - htAwayScore;
    const both = shHome > 0 && shAway > 0;
    const yes = sel === 'sim' || sel === 'yes' || sel.includes('sim');
    const no = sel === 'nao' || sel === 'no' || sel.includes('nao');
    if (yes) return both ? 'won' : 'lost';
    if (no) return both ? 'lost' : 'won';
    return 'void';
  }

  // ── totals / over_under / goals ─────────────────────────────────────────────
  if (
    mkKey === 'totals' || mkKey === 'over_under' || mkKey === 'goals' ||
    mkKey === 'match_goals' || mkKey.startsWith('totals_')
  ) {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver =
      sel.includes('mais') || sel.includes('over') || sel.startsWith('o') ||
      sel.includes('+') || (sel.match(/^\d/) && !sel.includes('menos') && !sel.includes('under'));
    const isUnder =
      sel.includes('menos') || sel.includes('under') || sel.startsWith('u');
    if (!isOver && !isUnder) return 'void';
    // Half-line: result is clear (no push)
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalGoals > line ? 'won' : 'lost';
      return totalGoals < line ? 'won' : 'lost';
    } else {
      // Whole number line: push if exact
      if (isOver) return totalGoals > line ? 'won' : totalGoals === line ? 'void' : 'lost';
      return totalGoals < line ? 'won' : totalGoals === line ? 'void' : 'lost';
    }
  }

  // ── 1st_half_totals ─────────────────────────────────────────────────────────
  if (mkKey === '1st_half_totals' || mkKey === 'totals_ht' || mkKey === 'ht_totals') {
    if (htTotal === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return htTotal > line ? 'won' : 'lost';
      return htTotal < line ? 'won' : 'lost';
    } else {
      if (isOver) return htTotal > line ? 'won' : htTotal === line ? 'void' : 'lost';
      return htTotal < line ? 'won' : htTotal === line ? 'void' : 'lost';
    }
  }

  // ── 2nd_half_totals ─────────────────────────────────────────────────────────
  if (mkKey === '2nd_half_totals' || mkKey === 'sh_totals') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shTotal = totalGoals - (htHomeScore + htAwayScore);
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return shTotal > line ? 'won' : 'lost';
      return shTotal < line ? 'won' : 'lost';
    } else {
      if (isOver) return shTotal > line ? 'won' : shTotal === line ? 'void' : 'lost';
      return shTotal < line ? 'won' : shTotal === line ? 'void' : 'lost';
    }
  }

  // ── handicap / asian_handicap ────────────────────────────────────────────────
  if (mkKey === 'handicap' || mkKey === 'asian_handicap' || mkKey === 'ah') {
    // Selection format: "Casa -1.5", "Fora +1.5", "Home -2", "Away +2"
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome =
      sel.includes('casa') || sel.includes('home') || sel.includes('mandante') ||
      sel.startsWith('1') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway =
      sel.includes('fora') || sel.includes('away') || sel.includes('visitante') ||
      sel.startsWith('2') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adjustedMargin = isHome
      ? homeScore + handicap - awayScore
      : awayScore + handicap - homeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adjustedMargin > 0 ? 'won' : 'lost';
    return adjustedMargin > 0 ? 'won' : adjustedMargin === 0 ? 'void' : 'lost';
  }

  // ── correct_score / exact_score ─────────────────────────────────────────────
  if (mkKey === 'correct_score' || mkKey === 'exact_score' || mkKey === 'placar_correto') {
    if (sel === 'outro' || sel === 'other' || sel === 'any other') {
      // "Outro" wins if none of the listed scores
      // We just check if the actual score matches common listed scores
      const listed = [
        '0-0','1-0','0-1','1-1','2-0','0-2','2-1','1-2','3-0','0-3',
        '2-2','3-1','1-3','3-2','2-3','3-3','4-0','0-4','4-1','1-4',
      ];
      const actualStr = `${homeScore}-${awayScore}`;
      return !listed.includes(actualStr) ? 'won' : 'lost';
    }
    const parsed = parseScore(selection);
    if (!parsed) return 'void';
    return parsed.home === homeScore && parsed.away === awayScore ? 'won' : 'lost';
  }

  // ── 1st_half / half_time_result ─────────────────────────────────────────────
  if (
    mkKey === '1st_half' || mkKey === 'half_time' || mkKey === 'ht_result' ||
    mkKey === 'primeiro_tempo'
  ) {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const htHome = htHomeScore > htAwayScore;
    const htDraw = htHomeScore === htAwayScore;
    const htAway = htAwayScore > htHomeScore;
    if (sel === '1' || sel === 'home' || sel === 'casa') return htHome ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return htDraw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora') return htAway ? 'won' : 'lost';
    return 'void';
  }

  // ── 2nd_half ─────────────────────────────────────────────────────────────────
  if (mkKey === '2nd_half' || mkKey === 'second_half' || mkKey === 'segundo_tempo') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shHome = homeScore - htHomeScore;
    const shAway = awayScore - htAwayScore;
    const shHomeWin = shHome > shAway;
    const shDraw = shHome === shAway;
    const shAwayWin = shAway > shHome;
    if (sel === '1' || sel === 'home' || sel === 'casa') return shHomeWin ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return shDraw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora') return shAwayWin ? 'won' : 'lost';
    return 'void';
  }

  // ── half_time_full_time / htft ───────────────────────────────────────────────
  if (mkKey === 'half_time_full_time' || mkKey === 'htft' || mkKey === 'ht_ft') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const htKey =
      htHomeScore > htAwayScore ? '1' :
      htHomeScore === htAwayScore ? 'x' : '2';
    const ftKey =
      homeScore > awayScore ? '1' :
      homeScore === awayScore ? 'x' : '2';
    const combo = `${htKey}/${ftKey}`;
    const selClean = sel.replace(/\s/g, '');
    return selClean === combo ? 'won' : 'lost';
  }

  // ── winning_margin ───────────────────────────────────────────────────────────
  if (mkKey === 'winning_margin' || mkKey === 'margem_vitoria') {
    const margin = Math.abs(homeScore - awayScore);
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    if (sel.includes('empate') || sel === 'draw') return draw ? 'won' : 'lost';
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    const lineMatch = sel.match(/\+?(\d+)/);
    if (!lineMatch) return 'void';
    const requiredMargin = parseInt(lineMatch[1]);
    const isPlusOrMore = sel.includes('ou mais') || sel.includes('or more') || sel.includes('+');
    if (isHome) {
      if (!homeWins) return 'lost';
      if (isPlusOrMore) return margin >= requiredMargin ? 'won' : 'lost';
      return margin === requiredMargin ? 'won' : 'lost';
    }
    if (isAway) {
      if (!awayWins) return 'lost';
      if (isPlusOrMore) return margin >= requiredMargin ? 'won' : 'lost';
      return margin === requiredMargin ? 'won' : 'lost';
    }
    return 'void';
  }

  // ── goals_range / total_goals_range ─────────────────────────────────────────
  if (mkKey === 'goals_range' || mkKey === 'total_goals_range') {
    if (sel.includes('ou mais') || sel.includes('or more') || sel.includes('+')) {
      const line = parseLineFromLabel(selection);
      if (line === null) return 'void';
      return totalGoals >= line ? 'won' : 'lost';
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    if (sel.includes('0') && sel.includes('gol')) return totalGoals === 0 ? 'won' : 'lost';
    return totalGoals === line ? 'won' : 'lost';
  }

  // ── total_goal_odd_even ──────────────────────────────────────────────────────
  if (mkKey === 'total_goal_odd_even' || mkKey === 'odd_even' || mkKey === 'par_impar') {
    const isOdd = totalGoals % 2 !== 0;
    if (sel === 'impar' || sel === 'odd') return isOdd ? 'won' : 'lost';
    if (sel === 'par' || sel === 'even') return isOdd ? 'lost' : 'won';
    return 'void';
  }

  // ── Tennis: Set 1 Winner ─────────────────────────────────────────────────────
  if (mkKey === 'set_1_h2h' || mkKey === '1st_set_winner') {
    const s1 = result.score?.sets?.s1;
    if (!s1 || s1.home === null || s1.away === null) return 'void';
    if (s1.home > s1.away) return sel.includes('home') || sel === '1' ? 'won' : 'lost';
    if (s1.away > s1.home) return sel.includes('away') || sel === '2' ? 'won' : 'lost';
    return 'void';
  }

  // ── Tennis: Set 2 Winner ─────────────────────────────────────────────────────
  if (mkKey === 'set_2_h2h' || mkKey === '2nd_set_winner') {
    const s2 = result.score?.sets?.s2;
    if (!s2 || s2.home === null || s2.away === null) return 'void';
    if (s2.home > s2.away) return sel.includes('home') || sel === '1' ? 'won' : 'lost';
    if (s2.away > s2.home) return sel.includes('away') || sel === '2' ? 'won' : 'lost';
    return 'void';
  }

  // ── Tennis: Set 3 Winner ─────────────────────────────────────────────────────
  if (mkKey === 'set_3_h2h' || mkKey === '3rd_set_winner') {
    const s3 = result.score?.sets?.s3;
    if (!s3 || s3.home === null || s3.away === null) return 'void';
    if (s3.home > s3.away) return sel.includes('home') || sel === '1' ? 'won' : 'lost';
    if (s3.away > s3.home) return sel.includes('away') || sel === '2' ? 'won' : 'lost';
    return 'void';
  }

  // ── Tennis: Set 1 Total Games ────────────────────────────────────────────────
  if (mkKey === 'set_1_totals' || mkKey === '1st_set_total_games') {
    const s1 = result.score?.sets?.s1;
    if (!s1 || s1.home === null || s1.away === null) return 'void';
    const total = s1.home + s1.away;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('over') || sel.includes('acima');
    const isUnder = sel.includes('under') || sel.includes('abaixo');
    if (!isOver && !isUnder) return 'void';
    const isHalf = line !== Math.floor(line);
    if (isHalf) {
      if (isOver) return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    } else {
      if (isOver) return total > line ? 'won' : total === line ? 'void' : 'lost';
      return total < line ? 'won' : total === line ? 'void' : 'lost';
    }
  }

  // ── Tennis: Set 2 Total Games ────────────────────────────────────────────────
  if (mkKey === 'set_2_totals' || mkKey === '2nd_set_total_games') {
    const s2 = result.score?.sets?.s2;
    if (!s2 || s2.home === null || s2.away === null) return 'void';
    const total = s2.home + s2.away;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('over') || sel.includes('acima');
    const isUnder = sel.includes('under') || sel.includes('abaixo');
    if (!isOver && !isUnder) return 'void';
    const isHalf = line !== Math.floor(line);
    if (isHalf) {
      if (isOver) return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    } else {
      if (isOver) return total > line ? 'won' : total === line ? 'void' : 'lost';
      return total < line ? 'won' : total === line ? 'void' : 'lost';
    }
  }

  // ── Tennis: Set 3 Total Games ────────────────────────────────────────────────
  if (mkKey === 'set_3_totals' || mkKey === '3rd_set_total_games') {
    const s3 = result.score?.sets?.s3;
    if (!s3 || s3.home === null || s3.away === null) return 'void';
    const total = s3.home + s3.away;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('over') || sel.includes('acima');
    const isUnder = sel.includes('under') || sel.includes('abaixo');
    if (!isOver && !isUnder) return 'void';
    const isHalf = line !== Math.floor(line);
    if (isHalf) {
      if (isOver) return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    } else {
      if (isOver) return total > line ? 'won' : total === line ? 'void' : 'lost';
      return total < line ? 'won' : total === line ? 'void' : 'lost';
    }
  }

  // ── Tennis: Total Sets ───────────────────────────────────────────────────────
  if (mkKey === 'total_sets') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let total = 0;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (s && s.home !== null && s.away !== null && (s.home > 0 || s.away > 0)) total++;
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('over') || sel.includes('acima');
    const isUnder = sel.includes('under') || sel.includes('abaixo');
    if (!isOver && !isUnder) return 'void';
    const isHalf = line !== Math.floor(line);
    if (isHalf) {
      if (isOver) return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    } else {
      if (isOver) return total > line ? 'won' : total === line ? 'void' : 'lost';
      return total < line ? 'won' : total === line ? 'void' : 'lost';
    }
  }

  // ── Tennis: Sets Handicap ─────────────────────────────────────────────────────
  if (mkKey === 'sets_handicap' || mkKey === 'handicap_sets') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let hSets = 0, aSets = 0;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (!s || s.home === null || s.away === null) continue;
      if (s.home > s.away) hSets++;
      if (s.away > s.home) aSets++;
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    let adjustedHome = hSets, adjustedAway = aSets;
    if (sel.includes('home') || sel === '1') adjustedHome += line;
    else if (sel.includes('away') || sel === '2') adjustedAway += line;
    if (adjustedHome > adjustedAway) return sel.includes('home') || sel === '1' ? 'won' : 'lost';
    if (adjustedAway > adjustedHome) return sel.includes('away') || sel === '2' ? 'won' : 'lost';
    return 'void';
  }

  // ── Tennis: Total Games in Match ──────────────────────────────────────────────
  if (mkKey === 'match_total_games' || mkKey === 'total_games') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let total = 0;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (s && s.home !== null && s.away !== null) total += s.home + s.away;
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('over') || sel.includes('acima');
    const isUnder = sel.includes('under') || sel.includes('abaixo');
    if (!isOver && !isUnder) return 'void';
    const isHalf = line !== Math.floor(line);
    if (isHalf) {
      if (isOver) return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    } else {
      if (isOver) return total > line ? 'won' : total === line ? 'void' : 'lost';
      return total < line ? 'won' : total === line ? 'void' : 'lost';
    }
  }

  // ── Tennis: Exact Set Score (Correct Score) ───────────────────────────────────
  if (mkKey === 'tennis_correct_score' || mkKey === 'tennis_exact_sets') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let hSets = 0, aSets = 0;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (!s || s.home === null || s.away === null) continue;
      if (s.home > s.away) hSets++;
      if (s.away > s.home) aSets++;
    }
    const normalized = sel.toLowerCase();
    const mHome = normalized.match(/(\d+)\s*-\s*(\d+)/);
    if (mHome) {
      const expectedH = parseInt(mHome[1], 10);
      const expectedA = parseInt(mHome[2], 10);
      return expectedH === hSets && expectedA === aSets ? 'won' : 'lost';
    }
    return 'void';
  }

  // ── Tennis: Tie-Break in Match ───────────────────────────────────────────────
  if (mkKey === 'tiebreak' || mkKey === 'tie_break') {
    // Note: We don't have tie-break data from the API, return void for now
    return 'void';
  }

  // ── Tennis: Player Wins a Set ─────────────────────────────────────────────────
  if (mkKey === 'player_wins_set' || mkKey === 'player_set_win') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let hWonSet = false, aWonSet = false;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (!s || s.home === null || s.away === null) continue;
      if (s.home > s.away) hWonSet = true;
      if (s.away > s.home) aWonSet = true;
    }
    if (sel.includes('home') || sel === '1') return hWonSet ? 'won' : 'lost';
    if (sel.includes('away') || sel === '2') return aWonSet ? 'won' : 'lost';
    return 'void';
  }

  // ── Tennis: Games Odd/Even ───────────────────────────────────────────────────
  if (mkKey === 'tennis_games_odd_even' || mkKey === 'games_par_impar') {
    const sets = result.score?.sets;
    if (!sets) return 'void';
    let total = 0;
    for (let i = 1; i <= 5; i++) {
      const s = sets[`s${i}`];
      if (s && s.home !== null && s.away !== null) total += s.home + s.away;
    }
    const isOdd = total % 2 !== 0;
    if (sel === 'impar' || sel === 'odd') return isOdd ? 'won' : 'lost';
    if (sel === 'par' || sel === 'even') return isOdd ? 'lost' : 'won';
    return 'void';
  }

  // ── period_with_more_goals / tempo_com_mais_gols ───────────────────────────────
  if (
    mkKey === 'period_with_more_goals' || mkKey === 'tempo_com_mais_gols' || mkKey === 'half_with_more_goals'
  ) {
    if (htTotal === null) return 'void';
    const shTotal = totalGoals - htTotal;
    if (sel === '1' || sel.includes('1st') || sel.includes('primeiro')) return htTotal > shTotal ? 'won' : 'lost';
    if (sel === '2' || sel.includes('2nd') || sel.includes('segundo')) return shTotal > htTotal ? 'won' : 'lost';
    if (sel.includes('igual') || sel.includes('equal') || sel === 'x' || sel.includes('draw')) return htTotal === shTotal ? 'won' : 'lost';
    return 'void';
  }

  // ── comeback / remontada ─────────────────────────────────────────────────────
  if (mkKey === 'comeback' || mkKey === 'remontada') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const homeComeback = htHomeScore < htAwayScore && homeScore > awayScore;
    const awayComeback = htAwayScore < htHomeScore && awayScore > homeScore;
    const noComeback = !homeComeback && !awayComeback;
    if (sel.includes('casa') || sel.includes('home')) return homeComeback ? 'won' : 'lost';
    if (sel.includes('fora') || sel.includes('away')) return awayComeback ? 'won' : 'lost';
    if (sel.includes('nao') || sel.includes('no')) return noComeback ? 'won' : 'lost';
    return 'void';
  }

  // ── win_both_halves / vence_os_dois_tempos ───────────────────────────────────
  if (mkKey === 'win_both_halves' || mkKey === 'vence_os_dois_tempos') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shHome = homeScore - htHomeScore;
    const shAway = awayScore - htAwayScore;
    const homeBothHalves = htHomeScore > htAwayScore && shHome > shAway;
    const awayBothHalves = htAwayScore > htHomeScore && shAway > shHome;
    const homeNo = !homeBothHalves;
    const awayNo = !awayBothHalves;
    if ((sel.includes('casa') || sel.includes('home')) && sel.includes('sim') || sel.includes('yes')) return homeBothHalves ? 'won' : 'lost';
    if ((sel.includes('casa') || sel.includes('home')) && (sel.includes('nao') || sel.includes('no'))) return homeNo ? 'won' : 'lost';
    if ((sel.includes('fora') || sel.includes('away')) && (sel.includes('sim') || sel.includes('yes'))) return awayBothHalves ? 'won' : 'lost';
    if ((sel.includes('fora') || sel.includes('away')) && (sel.includes('nao') || sel.includes('no'))) return awayNo ? 'won' : 'lost';
    return 'void';
  }

  // ── goal_in_each_half / gol_em_cada_tempo ───────────────────────────────────
  if (mkKey === 'goal_in_each_half' || mkKey === 'gol_em_cada_tempo') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shHome = homeScore - htHomeScore;
    const shAway = awayScore - htAwayScore;
    const firstHasGoal = (htHomeScore > 0 || htAwayScore > 0);
    const secondHasGoal = (shHome > 0 || shAway > 0);
    const yes = firstHasGoal && secondHasGoal;
    const no = !yes;
    if (sel.includes('sim') || sel.includes('yes')) return yes ? 'won' : 'lost';
    if (sel.includes('nao') || sel.includes('no')) return no ? 'won' : 'lost';
    return 'void';
  }

  // ── european_handicap / handicap_europeu ──────────────────────────────────────
  if (mkKey === 'european_handicap' || mkKey === 'handicap_europeu') {
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') || sel.startsWith('1') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') || sel.startsWith('2') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    const isDraw = sel === 'x' || sel.includes('draw') || sel.includes('empate');
    if (!isHome && !isAway && !isDraw) return 'void';

    const adjustedHome = homeScore + (isHome ? handicap : 0);
    const adjustedAway = awayScore + (isAway ? handicap : 0);
    if (isHome) return adjustedHome > adjustedAway ? 'won' : 'lost';
    if (isAway) return adjustedAway > adjustedHome ? 'won' : 'lost';
    if (isDraw) return adjustedHome === adjustedAway ? 'won' : 'lost';
    return 'void';
  }

  // ── 1st_half_goals_range / intervalo_gols_1t ───────────────────────────────
  if (mkKey === '1st_half_goals_range' || mkKey === 'intervalo_gols_1t') {
    if (htTotal === null) return 'void';
    if (sel.includes('ou mais') || sel.includes('or more') || sel.includes('+')) {
      const line = parseLineFromLabel(selection);
      if (line === null) return 'void';
      return htTotal >= line ? 'won' : 'lost';
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    if (sel.includes('0') && sel.includes('gol')) return htTotal === 0 ? 'won' : 'lost';
    return htTotal === line ? 'won' : 'lost';
  }

  // ── 2nd_half_goals_range / intervalo_gols_2t ───────────────────────────────
  if (mkKey === '2nd_half_goals_range' || mkKey === 'intervalo_gols_2t') {
    if (htTotal === null) return 'void';
    const shTotal = totalGoals - htTotal;
    if (sel.includes('ou mais') || sel.includes('or more') || sel.includes('+')) {
      const line = parseLineFromLabel(selection);
      if (line === null) return 'void';
      return shTotal >= line ? 'won' : 'lost';
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    if (sel.includes('0') && sel.includes('gol')) return shTotal === 0 ? 'won' : 'lost';
    return shTotal === line ? 'won' : 'lost';
  }

  // ── 2nd_half_correct_score / placar_correto_2t ───────────────────────────
  if (mkKey === '2nd_half_correct_score' || mkKey === 'placar_correto_2t') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const shHome = homeScore - htHomeScore;
    const shAway = awayScore - htAwayScore;
    if (sel === 'outro' || sel === 'other') {
      const listed = ['0-0','1-0','0-1','1-1','2-0','0-2','2-1','1-2'];
      const actualStr = `${shHome}-${shAway}`;
      return !listed.includes(actualStr) ? 'won' : 'lost';
    }
    const parsed = parseScore(selection);
    if (!parsed) return 'void';
    return parsed.home === shHome && parsed.away === shAway ? 'won' : 'lost';
  }

  // ── home_corners / cantos_casa ───────────────────────────────────────────────
  if (mkKey === 'home_corners' || mkKey === 'cantos_casa') {
    if (result.homeCorners === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.homeCorners > line ? 'won' : 'lost';
      return result.homeCorners < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.homeCorners > line ? 'won' : result.homeCorners === line ? 'void' : 'lost';
      return result.homeCorners < line ? 'won' : result.homeCorners === line ? 'void' : 'lost';
    }
  }

  // ── away_corners / cantos_fora ─────────────────────────────────────────────
  if (mkKey === 'away_corners' || mkKey === 'cantos_fora') {
    if (result.awayCorners === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.awayCorners > line ? 'won' : 'lost';
      return result.awayCorners < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.awayCorners > line ? 'won' : result.awayCorners === line ? 'void' : 'lost';
      return result.awayCorners < line ? 'won' : result.awayCorners === line ? 'void' : 'lost';
    }
  }

  // ── 1st_half_corners / cantos_1t ───────────────────────────────────────────
  if (mkKey === '1st_half_corners' || mkKey === 'cantos_1t') {
    if (htTotal === null) return 'void'; // Using htTotal as a proxy if we don't have first‑half corners specifically
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    // We don't have specific first‑half corners data in our result, so void for now
    return 'void';
  }

  // ── 2nd_half_corners / cantos_2t ─────────────────────────────────────────
  if (mkKey === '2nd_half_corners' || mkKey === 'cantos_2t') {
    if (htTotal === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    return 'void';
  }

  // ── home_corners_1st_half / cantos_casa_1t ──────────────────────────────
  if (mkKey === 'home_corners_1st_half' || mkKey === 'cantos_casa_1t') {
    return 'void';
  }

  // ── home_corners_2nd_half / cantos_casa_2t ──────────────────────────────
  if (mkKey === 'home_corners_2nd_half' || mkKey === 'cantos_casa_2t') {
    return 'void';
  }

  // ── away_corners_1st_half / cantos_fora_1t ──────────────────────────────
  if (mkKey === 'away_corners_1st_half' || mkKey === 'cantos_fora_1t') {
    return 'void';
  }

  // ── away_corners_2nd_half / cantos_fora_2t ──────────────────────────────
  if (mkKey === 'away_corners_2nd_half' || mkKey === 'cantos_fora_2t') {
    return 'void';
  }

  // ── penalty_scored / penalti_marcado ───────────────────────────────────────────
  if (mkKey === 'penalty_scored' || mkKey === 'penalti_marcado') {
    // We don't have penalty data, so void
    return 'void';
  }

  // ── 1st_half_cards / cartoes_1t ───────────────────────────────────────────
  if (mkKey === '1st_half_cards' || mkKey === 'cartoes_1t') {
    if (result.totalCards === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    return 'void';
  }

  // ── 2nd_half_cards / cartoes_2t ───────────────────────────────────────────
  if (mkKey === '2nd_half_cards' || mkKey === 'cartoes_2t') {
    if (result.totalCards === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    return 'void';
  }

  // ── home_cards / cartoes_casa ───────────────────────────────────────────────
  if (mkKey === 'home_cards' || mkKey === 'cartoes_casa') {
    if (result.homeCards === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.homeCards > line ? 'won' : 'lost';
      return result.homeCards < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.homeCards > line ? 'won' : result.homeCards === line ? 'void' : 'lost';
      return result.homeCards < line ? 'won' : result.homeCards === line ? 'void' : 'lost';
    }
  }

  // ── away_cards / cartoes_fora ─────────────────────────────────────────────
  if (mkKey === 'away_cards' || mkKey === 'cartoes_fora') {
    if (result.awayCards === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.awayCards > line ? 'won' : 'lost';
      return result.awayCards < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.awayCards > line ? 'won' : result.awayCards === line ? 'void' : 'lost';
      return result.awayCards < line ? 'won' : result.awayCards === line ? 'void' : 'lost';
    }
  }

  // ── home_cards_1st_half / cartoes_casa_1t ───────────────────────────────
  if (mkKey === 'home_cards_1st_half' || mkKey === 'cartoes_casa_1t') {
    return 'void';
  }

  // ── home_cards_2nd_half / cartoes_casa_2t ───────────────────────────────
  if (mkKey === 'home_cards_2nd_half' || mkKey === 'cartoes_casa_2t') {
    return 'void';
  }

  // ── away_cards_1st_half / cartoes_fora_1t ───────────────────────────────
  if (mkKey === 'away_cards_1st_half' || mkKey === 'cartoes_fora_1t') {
    return 'void';
  }

  // ── away_cards_2nd_half / cartoes_fora_2t ───────────────────────────────
  if (mkKey === 'away_cards_2nd_half' || mkKey === 'cartoes_fora_2t') {
    return 'void';
  }

  // ── corners_total / corner_count ─────────────────────────────────────────────
  if (mkKey === 'corners_total' || mkKey === 'corner_count' || mkKey === 'corners' || mkKey === 'cantos') {
    if (result.totalCorners === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.totalCorners > line ? 'won' : 'lost';
      return result.totalCorners < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.totalCorners > line ? 'won' : result.totalCorners === line ? 'void' : 'lost';
      return result.totalCorners < line ? 'won' : result.totalCorners === line ? 'void' : 'lost';
    }
  }

  // ── cards_total / card_count ─────────────────────────────────────────────────
  if (mkKey === 'cards_total' || mkKey === 'card_count' || mkKey === 'cartoes') {
    if (result.totalCards === null) return 'void';
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return result.totalCards > line ? 'won' : 'lost';
      return result.totalCards < line ? 'won' : 'lost';
    } else {
      if (isOver) return result.totalCards > line ? 'won' : result.totalCards === line ? 'void' : 'lost';
      return result.totalCards < line ? 'won' : result.totalCards === line ? 'void' : 'lost';
    }
  }

  // ── team_clean_sheet ─────────────────────────────────────────────────────────
  if (mkKey === 'team_clean_sheet' || mkKey === 'baliza_zero') {
    const homeCS = awayScore === 0;
    const awayCS = homeScore === 0;
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    const isCleanSheet = sel.includes('baliza a zero') || sel.includes('clean sheet') || sel.includes('nao sofre');
    const isNotCleanSheet = sel.includes('sofre') || sel.includes('conceded');
    if (isHome) {
      if (isCleanSheet) return homeCS ? 'won' : 'lost';
      if (isNotCleanSheet && !isCleanSheet) return homeCS ? 'lost' : 'won';
    }
    if (isAway) {
      if (isCleanSheet) return awayCS ? 'won' : 'lost';
      if (isNotCleanSheet && !isCleanSheet) return awayCS ? 'lost' : 'won';
    }
    return 'void';
  }

  // ── win_to_nil ───────────────────────────────────────────────────────────────
  if (mkKey === 'win_to_nil' || mkKey === 'vence_sem_sofrer') {
    const homeWinNil = homeScore > awayScore && awayScore === 0;
    const awayWinNil = awayScore > homeScore && homeScore === 0;
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    const isPositive = sel.includes('vence sem sofrer') || sel.includes('win to nil');
    const isNegative = sel.includes('nao') || sel.includes('not');
    if (isHome) {
      if (isPositive) return homeWinNil ? 'won' : 'lost';
      if (isNegative) return homeWinNil ? 'lost' : 'won';
    }
    if (isAway) {
      if (isPositive) return awayWinNil ? 'won' : 'lost';
      if (isNegative) return awayWinNil ? 'lost' : 'won';
    }
    return 'void';
  }

  // ── btts_and_result ──────────────────────────────────────────────────────────
  if (mkKey === 'btts_and_result') {
    const bothScored = homeScore > 0 && awayScore > 0;
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    const wantsBTTS = sel.includes('ambas marcam') || sel.includes('btts') || sel.includes('sim');
    const wantsNoBTTS = sel.includes('nao') && !sel.includes('sim');
    const wantsHome = sel.includes('casa') || sel.includes('home') || sel.startsWith('1 ') || sel.startsWith('1+');
    const wantsAway = sel.includes('fora') || sel.includes('away') || sel.startsWith('2 ') || sel.startsWith('2+');
    const wantsDraw = sel.includes('empate') || sel.includes('draw') || sel.startsWith('x ');
    if (wantsBTTS) {
      if (!bothScored) return 'lost';
      if (wantsHome) return homeWins ? 'won' : 'lost';
      if (wantsAway) return awayWins ? 'won' : 'lost';
      if (wantsDraw) return draw ? 'won' : 'lost';
    }
    if (wantsNoBTTS) {
      if (bothScored) return 'lost';
      if (wantsHome) return homeWins ? 'won' : 'lost';
      if (wantsAway) return awayWins ? 'won' : 'lost';
    }
    return 'void';
  }

  // ── first_team_to_score / team_to_score_last ─────────────────────────────────
  if (mkKey === 'first_team_to_score' || mkKey === 'last_team_to_score' || mkKey === 'team_to_score_last') {
    // "Nenhuma" → 0-0 draw
    if (sel === 'nenhuma' || sel === 'none' || sel === 'no goal') {
      return totalGoals === 0 ? 'won' : 'lost';
    }
    // Can't determine first/last scorer without detailed event timeline → void
    return 'void';
  }

  // ── home_team_totals / away_team_totals ─────────────────────────────────────
  if (mkKey === 'home_team_totals' || mkKey === 'home_goals') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return homeScore > line ? 'won' : 'lost';
      return homeScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return homeScore > line ? 'won' : homeScore === line ? 'void' : 'lost';
      return homeScore < line ? 'won' : homeScore === line ? 'void' : 'lost';
    }
  }

  if (mkKey === 'away_team_totals' || mkKey === 'away_goals') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return awayScore > line ? 'won' : 'lost';
      return awayScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return awayScore > line ? 'won' : awayScore === line ? 'void' : 'lost';
      return awayScore < line ? 'won' : awayScore === line ? 'void' : 'lost';
    }
  }

  // ── exact_home_goals / exact_away_goals ─────────────────────────────────────
  if (mkKey === 'exact_home_goals') {
    if (sel.includes('ou mais') || sel.includes('or more')) {
      const line = parseLineFromLabel(selection);
      if (line === null) return 'void';
      return homeScore >= line ? 'won' : 'lost';
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    return homeScore === line ? 'won' : 'lost';
  }

  if (mkKey === 'exact_away_goals') {
    if (sel.includes('ou mais') || sel.includes('or more')) {
      const line = parseLineFromLabel(selection);
      if (line === null) return 'void';
      return awayScore >= line ? 'won' : 'lost';
    }
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    return awayScore === line ? 'won' : 'lost';
  }

  // ── double_chance_1st_half ───────────────────────────────────────────────────
  if (mkKey === 'double_chance_1st_half') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const htHome = htHomeScore > htAwayScore;
    const htDraw = htHomeScore === htAwayScore;
    const htAway = htAwayScore > htHomeScore;
    if (sel === '1x') return (htHome || htDraw) ? 'won' : 'lost';
    if (sel === 'x2') return (htDraw || htAway) ? 'won' : 'lost';
    if (sel === '12') return (htHome || htAway) ? 'won' : 'lost';
    return 'void';
  }

  // ── draw_no_bet_1st_half ─────────────────────────────────────────────────────
  if (mkKey === 'draw_no_bet_1st_half') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    const htHome = htHomeScore > htAwayScore;
    const htDraw = htHomeScore === htAwayScore;
    const htAway = htAwayScore > htHomeScore;
    if (htDraw) return 'void';
    if (sel === 'home' || sel === 'casa') return htHome ? 'won' : 'lost';
    if (sel === 'away' || sel === 'fora') return htAway ? 'won' : 'lost';
    return 'void';
  }

  // ── 1st_half_correct_score ───────────────────────────────────────────────────
  if (mkKey === '1st_half_correct_score' || mkKey === 'ht_correct_score') {
    if (htHomeScore === null || htAwayScore === null) return 'void';
    if (sel === 'outro' || sel === 'other') {
      const listed = ['0-0','1-0','0-1','1-1','2-0','0-2','2-1','1-2'];
      const actualStr = `${htHomeScore}-${htAwayScore}`;
      return !listed.includes(actualStr) ? 'won' : 'lost';
    }
    const parsed = parseScore(selection);
    if (!parsed) return 'void';
    return parsed.home === htHomeScore && parsed.away === htAwayScore ? 'won' : 'lost';
  }

  // ── run_line / puck_line (baseball, hockey) ─────────────────────────────────
  if (mkKey === 'run_line' || mkKey === 'puck_line' || mkKey === 'spread') {
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adj = isHome
      ? homeScore + handicap - awayScore
      : awayScore + handicap - homeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adj > 0 ? 'won' : 'lost';
    return adj > 0 ? 'won' : adj === 0 ? 'void' : 'lost';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TENNIS MARKETS
  // In tennis: homeScore/awayScore = sets won; htHomeScore/htAwayScore = games
  // ═══════════════════════════════════════════════════════════════════════════

  // ── set_winner / set_betting (Tennis) ────────────────────────────────────────
  if (mkKey === 'set_winner' || mkKey === 'set_betting' || mkKey === 'set_result') {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    if (sel === 'home' || sel === 'casa' || sel === '1' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return homeWins ? 'won' : 'lost';
    if (sel === 'away' || sel === 'fora' || sel === '2' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── total_sets (Tennis) ──────────────────────────────────────────────────────
  if (mkKey === 'total_sets' || mkKey === 'sets_total' || mkKey === 'number_of_sets') {
    const totalSets = homeScore + awayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalSets > line ? 'won' : 'lost';
      return totalSets < line ? 'won' : 'lost';
    } else {
      if (isOver) return totalSets > line ? 'won' : totalSets === line ? 'void' : 'lost';
      return totalSets < line ? 'won' : totalSets === line ? 'void' : 'lost';
    }
  }

  // ── total_games (Tennis) ──────────────────────────────────────────────────────
  if (mkKey === 'total_games' || mkKey === 'games_total' || mkKey === 'number_of_games') {
    // htHomeScore + htAwayScore stores total games when available; fallback to homeScore + awayScore
    const totalGames = (result.htHomeScore !== null && result.htAwayScore !== null)
      ? result.htHomeScore + result.htAwayScore
      : homeScore + awayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalGames > line ? 'won' : 'lost';
      return totalGames < line ? 'won' : 'lost';
    } else {
      if (isOver) return totalGames > line ? 'won' : totalGames === line ? 'void' : 'lost';
      return totalGames < line ? 'won' : totalGames === line ? 'void' : 'lost';
    }
  }

  // ── set_handicap / sets_handicap (Tennis) ────────────────────────────────────
  if (mkKey === 'set_handicap' || mkKey === 'sets_handicap' || mkKey === 'set_spread') {
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adj = isHome
      ? homeScore + handicap - awayScore
      : awayScore + handicap - homeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adj > 0 ? 'won' : 'lost';
    return adj > 0 ? 'won' : adj === 0 ? 'void' : 'lost';
  }

  // ── games_handicap (Tennis) ───────────────────────────────────────────────────
  if (mkKey === 'games_handicap' || mkKey === 'game_spread') {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adj = isHome
      ? result.htHomeScore + handicap - result.htAwayScore
      : result.htAwayScore + handicap - result.htHomeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adj > 0 ? 'won' : 'lost';
    return adj > 0 ? 'won' : adj === 0 ? 'void' : 'lost';
  }

  // ── match_tiebreak / super_tiebreak (Tennis) ──────────────────────────────────
  if (mkKey === 'match_tiebreak' || mkKey === 'super_tiebreak' || mkKey === 'championship_tiebreak') {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    if (sel === 'home' || sel === 'casa' || sel === '1' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return homeWins ? 'won' : 'lost';
    if (sel === 'away' || sel === 'fora' || sel === '2' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BASKETBALL MARKETS
  // homeScore/awayScore = total points; htHomeScore/htAwayScore = 1st-half pts
  // ═══════════════════════════════════════════════════════════════════════════

  // ── total_points (Basketball) ────────────────────────────────────────────────
  if (mkKey === 'total_points' || mkKey === 'points_total' || mkKey === 'basketball_totals') {
    const totalPts = homeScore + awayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over') || sel.includes('+');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalPts > line ? 'won' : 'lost';
      return totalPts < line ? 'won' : 'lost';
    } else {
      if (isOver) return totalPts > line ? 'won' : totalPts === line ? 'void' : 'lost';
      return totalPts < line ? 'won' : totalPts === line ? 'void' : 'lost';
    }
  }

  // ── quarter_result / quarter_winner / period_result (Basketball) ─────────────
  if (
    mkKey === 'quarter_result' || mkKey === 'quarter_winner' ||
    mkKey === 'period_result' || mkKey === 'period_winner'
  ) {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const pHome = result.htHomeScore;
    const pAway = result.htAwayScore;
    const homeWins = pHome > pAway;
    const awayWins = pAway > pHome;
    const draw = pHome === pAway;
    if (sel === '1' || sel === 'home' || sel === 'casa' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return homeWins ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return draw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── quarter_totals / period_totals (Basketball / Hockey) ────────────────────
  if (
    mkKey === 'quarter_totals' || mkKey === 'period_totals' ||
    mkKey === 'half_totals_basketball' || mkKey === 'quarter_ou'
  ) {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const periodTotal = result.htHomeScore + result.htAwayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return periodTotal > line ? 'won' : 'lost';
      return periodTotal < line ? 'won' : 'lost';
    } else {
      if (isOver) return periodTotal > line ? 'won' : periodTotal === line ? 'void' : 'lost';
      return periodTotal < line ? 'won' : periodTotal === line ? 'void' : 'lost';
    }
  }

  // ── point_spread / basketball_spread (Basketball) ────────────────────────────
  if (mkKey === 'point_spread' || mkKey === 'basketball_spread' || mkKey === 'pts_spread') {
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adj = isHome
      ? homeScore + handicap - awayScore
      : awayScore + handicap - homeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adj > 0 ? 'won' : 'lost';
    return adj > 0 ? 'won' : adj === 0 ? 'void' : 'lost';
  }

  // ── home_team_points / away_team_points (Basketball) ────────────────────────
  if (mkKey === 'home_team_points' || mkKey === 'team_points_home') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return homeScore > line ? 'won' : 'lost';
      return homeScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return homeScore > line ? 'won' : homeScore === line ? 'void' : 'lost';
      return homeScore < line ? 'won' : homeScore === line ? 'void' : 'lost';
    }
  }

  if (mkKey === 'away_team_points' || mkKey === 'team_points_away') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return awayScore > line ? 'won' : 'lost';
      return awayScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return awayScore > line ? 'won' : awayScore === line ? 'void' : 'lost';
      return awayScore < line ? 'won' : awayScore === line ? 'void' : 'lost';
    }
  }

  // ── highest_scoring_quarter (Basketball) ────────────────────────────────────
  if (mkKey === 'highest_scoring_quarter' || mkKey === 'race_to_points') {
    // Without granular quarter data this cannot be resolved
    return 'void';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ICE HOCKEY MARKETS
  // homeScore/awayScore = total goals; htHomeScore/htAwayScore = 1st period
  // ═══════════════════════════════════════════════════════════════════════════

  // ── overtime_result / shootout_result (Hockey) ───────────────────────────────
  if (
    mkKey === 'overtime_result' || mkKey === 'shootout_result' ||
    mkKey === 'ot_result' || mkKey === 'resultado_prorrogacao' || mkKey === 'resultado_shootout'
  ) {
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    if (sel === 'home' || sel === 'casa' || sel === '1' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return homeWins ? 'won' : 'lost';
    if (sel === 'away' || sel === 'fora' || sel === '2' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── period1_result / period2_result / period3_result (Hockey) ────────────────
  if (
    mkKey === 'period1_result' || mkKey === '1st_period' || mkKey === 'period_1_winner' ||
    mkKey === 'period2_result' || mkKey === '2nd_period' || mkKey === 'period_2_winner' ||
    mkKey === 'period3_result' || mkKey === '3rd_period' || mkKey === 'period_3_winner'
  ) {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const pHome = result.htHomeScore;
    const pAway = result.htAwayScore;
    const pDraw = pHome === pAway;
    if (sel === '1' || sel === 'home' || sel === 'casa' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return pHome > pAway ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return pDraw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return pAway > pHome ? 'won' : 'lost';
    return 'void';
  }

  // ── hockey_60min_result (3-way result after 60 min, before OT) ───────────────
  if (mkKey === 'hockey_60min' || mkKey === 'result_60min' || mkKey === 'regulation_result') {
    // 60-minute result: home win, draw (goes to OT), or away win
    // We use the final result as a proxy (correct if game didn't go to OT)
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const draw = homeScore === awayScore;
    if (sel === '1' || sel === 'home' || sel === 'casa') return homeWins ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return draw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora') return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── total_goals_hockey (Hockey) ───────────────────────────────────────────────
  if (mkKey === 'total_goals_hockey' || mkKey === 'hockey_ou' || mkKey === 'hockey_totals') {
    const totalGoalsHockey = homeScore + awayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalGoalsHockey > line ? 'won' : 'lost';
      return totalGoalsHockey < line ? 'won' : 'lost';
    } else {
      if (isOver) return totalGoalsHockey > line ? 'won' : totalGoalsHockey === line ? 'void' : 'lost';
      return totalGoalsHockey < line ? 'won' : totalGoalsHockey === line ? 'void' : 'lost';
    }
  }

  // ── game_went_to_ot / game_went_to_shootout (Hockey) ────────────────────────
  if (mkKey === 'game_went_to_ot' || mkKey === 'overtime_yn' || mkKey === 'will_there_be_ot') {
    // Cannot determine without OT flag in result data → void
    return 'void';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BASEBALL MARKETS
  // homeScore/awayScore = total runs; htHomeScore/htAwayScore = first 5 innings
  // ═══════════════════════════════════════════════════════════════════════════

  // ── total_runs (Baseball) ────────────────────────────────────────────────────
  if (mkKey === 'total_runs' || mkKey === 'runs_total' || mkKey === 'baseball_ou') {
    const totalRuns = homeScore + awayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return totalRuns > line ? 'won' : 'lost';
      return totalRuns < line ? 'won' : 'lost';
    } else {
      if (isOver) return totalRuns > line ? 'won' : totalRuns === line ? 'void' : 'lost';
      return totalRuns < line ? 'won' : totalRuns === line ? 'void' : 'lost';
    }
  }

  // ── first_5_innings / f5_innings (Baseball) ───────────────────────────────────
  if (
    mkKey === 'first_5_innings' || mkKey === 'f5_innings' ||
    mkKey === '5_innings_result' || mkKey === 'first_5_result'
  ) {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const f5Home = result.htHomeScore;
    const f5Away = result.htAwayScore;
    const homeWins = f5Home > f5Away;
    const awayWins = f5Away > f5Home;
    const draw = f5Home === f5Away;
    if (sel === '1' || sel === 'home' || sel === 'casa' ||
      (result.homeName && sel.includes(normSel(result.homeName)))) return homeWins ? 'won' : 'lost';
    if (sel === 'x' || sel === 'draw' || sel === 'empate') return draw ? 'won' : 'lost';
    if (sel === '2' || sel === 'away' || sel === 'fora' ||
      (result.awayName && sel.includes(normSel(result.awayName)))) return awayWins ? 'won' : 'lost';
    return 'void';
  }

  // ── first_5_innings_totals / f5_totals (Baseball) ────────────────────────────
  if (
    mkKey === 'first_5_innings_totals' || mkKey === 'f5_totals' ||
    mkKey === '5_innings_totals' || mkKey === 'f5_ou'
  ) {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const f5Total = result.htHomeScore + result.htAwayScore;
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return f5Total > line ? 'won' : 'lost';
      return f5Total < line ? 'won' : 'lost';
    } else {
      if (isOver) return f5Total > line ? 'won' : f5Total === line ? 'void' : 'lost';
      return f5Total < line ? 'won' : f5Total === line ? 'void' : 'lost';
    }
  }

  // ── innings_run_line (Baseball) ───────────────────────────────────────────────
  if (mkKey === 'innings_run_line' || mkKey === 'f5_run_line') {
    if (result.htHomeScore === null || result.htAwayScore === null) return 'void';
    const lineMatch = selection.match(/([+-]?\d+(?:[.,]\d+)?)\s*$/);
    if (!lineMatch) return 'void';
    const handicap = parseFloat(lineMatch[1].replace(',', '.'));
    const isHome = sel.includes('casa') || sel.includes('home') ||
      (result.homeName && sel.includes(normSel(result.homeName)));
    const isAway = sel.includes('fora') || sel.includes('away') ||
      (result.awayName && sel.includes(normSel(result.awayName)));
    if (!isHome && !isAway) return 'void';
    const adj = isHome
      ? result.htHomeScore + handicap - result.htAwayScore
      : result.htAwayScore + handicap - result.htHomeScore;
    const isHalfLine = handicap !== Math.floor(handicap);
    if (isHalfLine) return adj > 0 ? 'won' : 'lost';
    return adj > 0 ? 'won' : adj === 0 ? 'void' : 'lost';
  }

  // ── team_runs_home / team_runs_away (Baseball) ────────────────────────────────
  if (mkKey === 'team_runs_home' || mkKey === 'home_runs_total') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return homeScore > line ? 'won' : 'lost';
      return homeScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return homeScore > line ? 'won' : homeScore === line ? 'void' : 'lost';
      return homeScore < line ? 'won' : homeScore === line ? 'void' : 'lost';
    }
  }

  if (mkKey === 'team_runs_away' || mkKey === 'away_runs_total') {
    const line = parseLineFromLabel(selection);
    if (line === null) return 'void';
    const isOver = sel.includes('mais') || sel.includes('over');
    const isUnder = sel.includes('menos') || sel.includes('under');
    if (!isOver && !isUnder) return 'void';
    const isHalfLine = line !== Math.floor(line);
    if (isHalfLine) {
      if (isOver) return awayScore > line ? 'won' : 'lost';
      return awayScore < line ? 'won' : 'lost';
    } else {
      if (isOver) return awayScore > line ? 'won' : awayScore === line ? 'void' : 'lost';
      return awayScore < line ? 'won' : awayScore === line ? 'void' : 'lost';
    }
  }

  // Unknown market → void (safe default)
  console.warn(`[settlement] Unknown market key: "${mkKey}" — voiding selection`);
  return 'void';
}

// ── Multi-bet outcome logic ───────────────────────────────────────────────────
// Standard accumulator rules:
//   - Any LOST selection → whole bet LOST
//   - All VOID → whole bet VOID
//   - Mix of VOID + WON → WON (void legs treated as 1.0 odds, reducing payout)
//   - All WON → WON

export function evaluateMultiBet(
  outcomes: SelectionOutcome[],
): 'won' | 'lost' | 'void' {
  if (outcomes.length === 0) return 'void';
  if (outcomes.some((o) => o === 'lost')) return 'lost';
  if (outcomes.every((o) => o === 'void')) return 'void';
  return 'won';
}

// Recalculate winnings for multi-bet when some selections are void
export function recalculateMultiOdds(
  selections: Array<{ odd: number }>,
  outcomes: SelectionOutcome[],
): number {
  let combinedOdds = 1;
  for (let i = 0; i < selections.length; i++) {
    const outcome = outcomes[i] ?? 'void';
    if (outcome === 'won') combinedOdds *= Math.max(1, selections[i].odd);
    // void legs treated as 1.0 (no multiplication)
  }
  return combinedOdds;
}

// ── Fetch match result from SportsApiPro ─────────────────────────────────────

async function fetchMatchResult(
  apiKey: string,
  eventId: string,
  sport: string,
): Promise<MatchResult | null> {
  if (!apiKey) return null;
  
  // Map sport to the correct SportsAPI Pro subdomain
  const sportLower = String(sport || '').toLowerCase().trim();
  let sub: string;
  if (sportLower === 'tennis') {
    sub = 'tennis';
  } else if (sportLower === 'basketball') {
    sub = 'basketball';
  } else if (sportLower === 'ice-hockey' || sportLower === 'hockey') {
    sub = 'hockey';
  } else if (sportLower === 'baseball') {
    sub = 'baseball';
  } else {
    sub = 'football'; // soccer/football default
  }
  
  const base = `https://v2.${sub}.sportsapipro.com`;

  // Try to fetch by event ID directly
  try {
    const url = `${base}/api/match/${encodeURIComponent(eventId)}`;
    const r = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data: any = await r.json();
      const ev: any = data?.event ?? data?.match ?? data?.data?.event ?? data?.data?.match ?? data;
      const result = extractResultFromEvent(ev, eventId, sport);
      if (result) return result;
    }
  } catch { /* will try schedule fallback */ }

  // Fallback: search today's schedule
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${base}/api/events/schedule?date=${today}`;
    const r = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const events = extractEventsArray(data);
    const ev = events.find((e: any) => {
      const id = String(e?.id ?? e?.fixture?.id ?? e?.match_id ?? '');
      return id === String(eventId);
    });
    if (ev) return extractResultFromEvent(ev, eventId, sport);
  } catch { /* pass */ }

  return null;
}

function extractEventsArray(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.data?.events)) return payload.data.events;
  if (Array.isArray(payload.response)) return payload.response;
  if (Array.isArray(payload.data?.response)) return payload.data.response;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.matches)) return payload.matches;
  const tournaments = payload.data?.tournaments ?? payload.tournaments;
  if (Array.isArray(tournaments)) {
    const out: any[] = [];
    for (const t of tournaments) out.push(...(t?.events ?? t?.matches ?? []));
    return out;
  }
  return [];
}

function extractTennisSetsFromEvent(ev: any): MatchResult['score']['sets'] | undefined {
  const sets: MatchResult['score']['sets'] = {};
  for (let i = 1; i <= 5; i++) {
    const home = pickNumOrNull(
      ev?.homeScore?.[`period${i}`] ?? ev?.score?.periods?.[i - 1]?.home ??
      ev?.periodScores?.[i - 1]?.home ?? ev?.score?.[`set${i}`]?.home ??
      ev?.[`homeSet${i}`]
    );
    const away = pickNumOrNull(
      ev?.awayScore?.[`period${i}`] ?? ev?.score?.periods?.[i - 1]?.away ??
      ev?.periodScores?.[i - 1]?.away ?? ev?.score?.[`set${i}`]?.away ??
      ev?.[`awaySet${i}`]
    );
    if (home !== null || away !== null) {
      sets[`s${i}`] = { home, away };
    }
  }
  if (Object.keys(sets).length > 0) {
    return sets;
  }
  return undefined;
}

function extractResultFromEvent(ev: any, eventId: string, sport: string): MatchResult | null {
  if (!ev) return null;
  const statusRaw = String(
    ev?.status?.description ?? ev?.status?.type ?? ev?.status ?? ev?.statusCode ?? ''
  ).toUpperCase().trim();

  const isCancelled = /CANCEL|POSTPON|ABANDON/.test(statusRaw);
  const isFinished = /FT|FINAL|FINISH|ENDED|END|FULL_TIME|COMPLETED|WALKOVER|WO/.test(statusRaw)
    || (statusRaw === '');

  if (!isFinished && !isCancelled) return null;

  const status: MatchResult['status'] =
    /CANCEL/.test(statusRaw) ? 'cancelled' :
    /POSTPON/.test(statusRaw) ? 'postponed' :
    /ABANDON/.test(statusRaw) ? 'abandoned' : 'finished';

  const homeScore = pickNum(ev?.goals?.home ?? ev?.score?.home ?? ev?.homeScore ?? ev?.home_score ?? 0);
  const awayScore = pickNum(ev?.goals?.away ?? ev?.score?.away ?? ev?.awayScore ?? ev?.away_score ?? 0);

  const htHome = pickNumOrNull(
    ev?.score?.halftime?.home ?? ev?.halftime?.home ?? ev?.ht_home ?? ev?.half_time_score?.home
  );
  const htAway = pickNumOrNull(
    ev?.score?.halftime?.away ?? ev?.halftime?.away ?? ev?.ht_away ?? ev?.half_time_score?.away
  );

  const totalCorners = pickNumOrNull(
    ev?.statistics?.corners?.total ?? ev?.corners?.total ?? ev?.total_corners
  );
  const homeCorners = pickNumOrNull(ev?.statistics?.corners?.home ?? ev?.corners?.home);
  const awayCorners = pickNumOrNull(ev?.statistics?.corners?.away ?? ev?.corners?.away);
  const homeCards = pickNumOrNull(ev?.statistics?.cards?.home ?? ev?.cards?.home);
  const awayCards = pickNumOrNull(ev?.statistics?.cards?.away ?? ev?.cards?.away);
  const totalCards =
    homeCards !== null && awayCards !== null ? homeCards + awayCards : null;

  const homeName = String(ev?.teams?.home?.name ?? ev?.home_team ?? ev?.homeName ?? '');
  const awayName = String(ev?.teams?.away?.name ?? ev?.away_team ?? ev?.awayName ?? '');

  const scoreObj: MatchResult['score'] = {};
  if (sport.toLowerCase().includes('tennis')) {
    scoreObj.sets = extractTennisSetsFromEvent(ev);
    const pointHome = ev?.homeScore?.point ?? ev?.homeScore?.currentPoint ?? ev?.point?.home ?? null;
    const pointAway = ev?.awayScore?.point ?? ev?.awayScore?.currentPoint ?? ev?.point?.away ?? null;
    if (pointHome !== null || pointAway !== null) {
      scoreObj.point = { home: pointHome, away: pointAway };
    }
  }
  // For other sports, you could add other score properties here (quarters, innings, etc.)

  return {
    eventId,
    sport,
    status,
    homeScore,
    awayScore,
    htHomeScore: htHome,
    htAwayScore: htAway,
    totalCorners,
    homeCorners,
    awayCorners,
    totalCards,
    homeCards,
    awayCards,
    homeName,
    awayName,
    score: Object.keys(scoreObj).length > 0 ? scoreObj : undefined,
  };
}

function pickNum(v: any): number {
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function pickNumOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Build MatchResult from cached event data ──────────────────────────────────

export function resultFromCachedEvent(ev: any): MatchResult | null {
  if (!ev) return null;
  const statusRaw = String(ev.status ?? ev.status_short ?? '').toUpperCase();
  const isCancelled = /CANCEL|POSTPON|ABANDON/.test(statusRaw);
  const isFinished = /FT|FINAL|FINISH|ENDED|END|FULL_TIME|AET|PEN/.test(statusRaw);
  if (!isFinished && !isCancelled) return null;

  const scoreStr = String(ev.score ?? '');
  const parsed = scoreStr ? (() => {
    const m = scoreStr.match(/(\d+)\s*[-:]\s*(\d+)/);
    return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
  })() : null;

  const status: MatchResult['status'] =
    /CANCEL/.test(statusRaw) ? 'cancelled' :
    /POSTPON/.test(statusRaw) ? 'postponed' :
    /ABANDON/.test(statusRaw) ? 'abandoned' : 'finished';

  return {
    eventId: String(ev.external_event_id ?? ev.id ?? ''),
    sport: String(ev.sport ?? 'soccer'),
    status,
    homeScore: parsed?.home ?? 0,
    awayScore: parsed?.away ?? 0,
    htHomeScore: null,
    htAwayScore: null,
    totalCorners: null,
    homeCorners: null,
    awayCorners: null,
    totalCards: null,
    homeCards: null,
    awayCards: null,
    homeName: String(ev.home_team ?? ''),
    awayName: String(ev.away_team ?? ''),
  };
}

// ── Settle a single bet ───────────────────────────────────────────────────────

async function settleBet(
  pool: pg.Pool,
  bet: any,
  result: MatchResult,
): Promise<{ outcome: 'won' | 'lost' | 'void'; winnings: number; note: string }> {
  const selections: any[] = Array.isArray(bet.selections) ? bet.selections : [];
  const betType = String(bet.bet_type || 'single');
  const stake = Number(bet.stake) || 0;
  const isFreebet = Boolean(bet.is_free_bet);

  const outcomes: SelectionOutcome[] = [];
  const notes: string[] = [];

  for (const sel of selections) {
    const market = String(sel.market || sel.market_key || '').toLowerCase();
    const selectionLabel = String(sel.selection || '');
    const outcome = evaluateSelection(market, selectionLabel, result);
    outcomes.push(outcome);
    notes.push(`[${market || '?'}] "${selectionLabel}" → ${outcome}`);
  }

  let finalOutcome: 'won' | 'lost' | 'void';
  let finalOdds = Number(bet.total_odds) || 1;

  if (betType === 'multi') {
    finalOutcome = evaluateMultiBet(outcomes);
    if (finalOutcome === 'won') {
      finalOdds = recalculateMultiOdds(selections, outcomes);
    }
  } else {
    finalOutcome = outcomes[0] ?? 'void';
    if (finalOutcome !== 'won') finalOdds = 0;
  }

  let winnings = 0;
  if (finalOutcome === 'won') {
    winnings = isFreebet
      ? Math.round((stake * finalOdds - stake) * 100) / 100
      : Math.round(stake * finalOdds * 100) / 100;
  } else if (finalOutcome === 'void') {
    // Return stake
    winnings = stake;
  }

  const note = notes.join(' | ');
  return { outcome: finalOutcome, winnings, note };
}

// ── Credit winnings to user balance ──────────────────────────────────────────

async function creditWinnings(
  pool: pg.Pool,
  userId: string,
  betId: string,
  winnings: number,
  outcome: 'won' | 'lost' | 'void',
  eventId: string,
): Promise<void> {
  if (winnings <= 0) return;
  const txId = randomId(16);
  const txType = outcome === 'void' ? 'bet_refund' : 'bet_win';
  const description =
    outcome === 'void'
      ? `Aposta ${betId} anulada — reembolso`
      : `Ganhos da aposta ${betId} (evento ${eventId})`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE profiles SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1`,
      [userId, winnings],
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, description, completed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'completed', $5, NOW(), NOW(), NOW())`,
      [txId, userId, txType, winnings, description],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Main: settle all pending bets for one event ───────────────────────────────

export async function settleEventBets(
  pool: pg.Pool,
  result: MatchResult,
): Promise<{ settled: number; credited: number; errors: string[] }> {
  let settled = 0;
  let credited = 0;
  const errors: string[] = [];

  const r = await pool.query(
    `SELECT id, user_id, bet_type, stake, potential_win, total_odds, is_free_bet, selections
     FROM bets
     WHERE status = 'pending'
       AND selections::text LIKE $1`,
    [`%${result.eventId}%`],
  ).catch((e: any) => { errors.push(`DB query: ${e?.message}`); return { rows: [] }; });

  for (const bet of r.rows) {
    try {
      const { outcome, winnings, note } = await settleBet(pool, bet, result);

      await pool.query(
        `UPDATE bets
         SET status = $2, winnings = $3, settled_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [bet.id, outcome, winnings],
      );

      await creditWinnings(pool, bet.user_id, bet.id, winnings, outcome, result.eventId);

      settled++;
      credited += winnings;
      console.log(`[settlement] bet ${bet.id} → ${outcome} (winnings: ${winnings}) | ${note}`);
    } catch (e: any) {
      errors.push(`bet ${bet.id}: ${e?.message || e}`);
    }
  }

  return { settled, credited, errors };
}

// ── Admin: settle by provided result ────────────────────────────────────────

export async function settleByResult(
  pool: pg.Pool,
  result: MatchResult,
): Promise<{ settled: number; credited: number; errors: string[] }> {
  return settleEventBets(pool, result);
}

// ── Auto-settlement: scan finished events in cache ────────────────────────────

export async function autoSettleFromCache(
  pool: pg.Pool,
  apiKey: string,
  eventsCache: Map<string, any>,
): Promise<SettlementReport> {
  const report: SettlementReport = {
    totalChecked: 0,
    totalSettled: 0,
    totalWon: 0,
    totalLost: 0,
    totalVoid: 0,
    totalCredited: 0,
    errors: [],
    eventsProcessed: [],
  };

  // 1. Find all unique event IDs in pending bets
  let pendingEventIds: string[] = [];
  try {
    const r = await pool.query(
      `SELECT DISTINCT jsonb_array_elements(selections)->>'event_id' AS eid
       FROM bets WHERE status = 'pending'`
    );
    pendingEventIds = (r.rows || [])
      .map((row: any) => String(row.eid || '').trim())
      .filter(Boolean);
  } catch (e: any) {
    report.errors.push(`Failed to query pending bets: ${e?.message}`);
    return report;
  }

  report.totalChecked = pendingEventIds.length;

  for (const eventId of pendingEventIds) {
    try {
      // Try events cache first
      let matchResult: MatchResult | null = null;
      const cached = eventsCache.get(eventId);
      if (cached) {
        matchResult = resultFromCachedEvent(cached);
      }

      // Fallback: fetch from API
      if (!matchResult && apiKey) {
        const sport = cached?.sport || 'soccer';
        matchResult = await fetchMatchResult(apiKey, eventId, sport);
      }

      if (!matchResult) continue;

      const { settled, credited, errors } = await settleEventBets(pool, matchResult);
      if (settled > 0 || errors.length > 0) {
        report.totalSettled += settled;
        report.totalCredited += credited;
        report.errors.push(...errors);
        report.eventsProcessed.push(eventId);
      }
    } catch (e: any) {
      report.errors.push(`Event ${eventId}: ${e?.message}`);
    }
  }

  return report;
}

// ── Manual trigger: settle event by ID, fetching result from API ─────────────

export async function settleEventById(
  pool: pg.Pool,
  apiKey: string,
  eventId: string,
  sport = 'soccer',
  eventsCache?: Map<string, any>,
): Promise<{ ok: boolean; result: MatchResult | null; settled: number; credited: number; errors: string[] }> {
  let matchResult: MatchResult | null = null;

  if (eventsCache) {
    const cached = eventsCache.get(eventId);
    if (cached) matchResult = resultFromCachedEvent(cached);
  }

  if (!matchResult && apiKey) {
    matchResult = await fetchMatchResult(apiKey, eventId, sport);
  }

  if (!matchResult) {
    return { ok: false, result: null, settled: 0, credited: 0, errors: [`No result found for event ${eventId}`] };
  }

  const { settled, credited, errors } = await settleEventBets(pool, matchResult);
  return { ok: true, result: matchResult, settled, credited, errors };
}
