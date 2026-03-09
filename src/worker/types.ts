
export interface NormalizedEvent {
  id?: number | string; // Can be string in eventSync (externalId)
  external_event_id: string;
  sport: string;
  league: string;
  country: string;
  event_date: string;
  home_team: string;
  away_team: string;
  home_team_id?: number;
  away_team_id?: number;
  home_team_logo?: string;
  away_team_logo?: string;
  home_odd: number;
  draw_odd: number;
  away_odd: number;
  is_live: number;
  status: string;
  score_home?: number | null;
  score_away?: number | null;
  markets?: string; // JSON string
  updated_at?: string;
  
  // Legacy/Optional fields to maintain compatibility if needed elsewhere
  team_match?: string;
  start_time?: string;
  score?: any;
  elapsed?: number;
  external_provider?: string;
  force_suspended?: boolean;
  market_status?: string;
}

export interface ImportedEventPayload {
  // Top-level properties that might exist in some payloads
  goals?: { home: number | null; away: number | null };
  markets?: any; // New normalized markets structure
  is_live?: number | boolean;
  sport?: string;
  game?: any; // API-Basketball support
  
  fixture: {
    id: number | string;
    date?: string;
    timestamp?: number;
    timezone?: string;
    periods?: { first: number | null; second: number | null };
    venue?: { id: number | null; name: string; city: string };
    status?: { long: string; short: string; elapsed: number | null } | string; // Support string status
    
    // Legacy support inside fixture
    home_team?: string | { name: string; logo?: string; id?: number };
    away_team?: string | { name: string; logo?: string; id?: number };
    league_name?: string;
    league?: { name: string; country?: string; logo?: string; flag?: string };
    sport?: string;
    goals?: { home: number | null; away: number | null };
  };
  
  league?: {
    id?: number;
    name: string;
    country?: string;
    logo?: string;
    flag?: string;
    season?: number;
    round?: string;
  };
  
  teams?: {
    home: { id: number; name: string; logo: string; winner?: boolean | null };
    away: { id: number; name: string; logo: string; winner?: boolean | null };
  };
  
  // goals property repeated in original but safe to keep
  
  score?: { halftime: any; fulltime: any; extratime: any; penalty: any };

  odds?: {
    [market: string]: {
      outcomes: {
        outcome: string;
        value: number;
      }[];
      suspended?: boolean;
    };
  } | any; // Relaxed type for odds to support legacy/different structures

  source?: string;
  oddsFrozen?: boolean;
  bookmakers?: any[]; // Legacy support
  
  // Flat Legacy/Fallback properties
  id?: string | number;
  home_team?: string; 
  away_team?: string;
  league_name?: string;
  event_date?: string;
  elapsed?: number;
  status?: string | { short: string; long?: string; elapsed?: number | null };
  country?: string;
  home_odd?: number | string;
  draw_odd?: number | string;
  away_odd?: number | string;
}
