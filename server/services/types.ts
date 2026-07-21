/**
 * Shared types for sports data services (StatPal-only).
 */

export interface NormalizedEvent {
  external_event_id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  home_team_id?: string;
  away_team_id?: string;
  team_match: string;
  event_date: string;
  status: string;
  status_short?: string;
  status_long?: string;
  is_live: number;
  home_odd: number;
  draw_odd: number;
  away_odd: number;
  elapsed: number;
  timer: string;
  score: string;
  markets: string;
  country: string;
  home_team_logo: string;
  away_team_logo: string;
  fixture?: any;
  teams?: any;
  goals?: any;
  provider_status?: any;
}

export interface OddsResult {
  home: number;
  draw: number;
  away: number;
  markets: Record<string, any[]>;
}

export interface V1AllScoresDelta {
  events: NormalizedEvent[];
  lastUpdateId: string | null;
}
