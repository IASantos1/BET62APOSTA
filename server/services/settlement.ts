// server/services/settlement.ts
// Robust bet settlement engine — handles all markets and sports.
// Uses SportsApiPro V1 (1s latency) for schedule/results + events cache.

import type pg from 'pg';
import { randomId } from '../lib/crypto';

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

  // ── 1st_half_goal_odd_even ───────────────────────────────────────────────────
  if (mkKey === '1st_half_goal_odd_even') {
    if (htTotal === null) return 'void';
    const isOdd = htTotal % 2 !== 0;
    if (sel === 'impar' || sel === 'odd') return isOdd ? 'won' : 'lost';
    if (sel === 'par' || sel === 'even') return isOdd ? 'lost' : 'won';
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

  // ── tennis: set winner / match winner ────────────────────────────────────────
  if (mkKey === 'set_winner' || mkKey === 'set_betting') {
    // Sets are not tracked in our current data → void
    return 'void';
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
  const sub = sport === 'tennis' ? 'tennis' : 'football';
  const base = `https://v1.${sub}.sportsapipro.com`;

  // Try to fetch by event ID directly
  try {
    const url = `${base}/api/match/${encodeURIComponent(eventId)}`;
    const r = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data = await r.json();
      const ev = data?.event ?? data?.match ?? data?.data?.event ?? data?.data?.match ?? data;
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
