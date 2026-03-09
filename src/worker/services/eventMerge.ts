
export function mergeEvent(base: any, incoming: any) {
  // Ensure odds object exists
  const baseOdds = base.odds || {};
  const incomingOdds = incoming.odds || {};
  
  // Merge odds: Incoming odds overwrite base odds for the same market
  // But we want to preserve other markets if they exist in base but not in incoming?
  // User says: odds: incoming.odds ?? base.odds ?? {}
  // This implies if incoming has odds, use them. If not, keep base.
  // But if incoming has *some* odds (e.g. only H2H) and base has others?
  // The user's code: odds: incoming.odds ?? base.odds ?? {}
  // This is a coarse merge (all or nothing). 
  // Ideally we should merge deep, but I will stick to the user's "Regra de Ouro" code first.
  // "odds: incoming.odds ?? base.odds ?? {}"
  
  // However, often we want to update specific markets. 
  // If incoming has keys, we might want to merge.
  // But for now, let's follow the user's exact snippet logic to be safe, 
  // as it prevents stale odds from lingering if the source sends a full update.
  
  return {
    ...base,
    ...incoming,
    odds: incoming.odds ?? base.odds ?? {},
    home: incoming.home ?? base.home,
    away: incoming.away ?? base.away,
    league: incoming.league ?? base.league,
    date: incoming.date ?? base.date,
    sport: incoming.sport ?? base.sport,
    // Preserve IDs if they exist in base and not in incoming
    id: base.id ?? incoming.id, 
    external_event_id: base.external_event_id ?? incoming.external_event_id,
    updated_at: new Date().toISOString(),
  };
}
