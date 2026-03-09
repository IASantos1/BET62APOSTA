import { isPreMatch } from './oddsGuard';

export function normalizeOdds(rawOdds: any, fixture: any) { 
  const hasRaw = rawOdds && typeof rawOdds === 'object';

  const markets: any = {}; 

  if (hasRaw) {
    const canonical = (k: string) => {
      const s = String(k || '').toLowerCase().trim();
      if (s === 'h2h' || s === '1x2' || s === 'match winner' || s === 'fulltime result' || s === 'moneyline' || s === 'main') return 'h2h';
      if (s === 'handicap' || s === 'spreads' || s === 'spread' || s.includes('asian handicap')) return 'handicap';
      if (s === 'totals' || s === 'over_under' || s === 'over/under' || s === 'ou' || s === 'goals over/under') return 'totals';
      if (s === 'double chance' || s === 'double_chance' || s === 'dc') return 'double_chance';
      if (s === 'btts' || s === 'both_teams_to_score' || s === 'both teams to score') return 'btts';
      if (s === 'draw_no_bet' || s === 'dnb' || s === 'draw no bet') return 'dnb';
      if (s === 'correct_score' || s === 'correct score') return 'correct_score';
      if (s === 'ht/ft' || s === 'half-time/full-time' || s === 'halftime/fulltime' || s === 'half_time_full_time') return 'half_time_full_time';
      if (s === 'corners' || s === 'corners_total' || s.includes('corners')) return 'corners_total';
      if (s === 'cards' || s.includes('cards')) return 'cards_total';
      
      // Additional mappings for common API-Football names
      if (s.includes('first half') && s.includes('winner')) return 'halves_h2h';
      if (s.includes('second half') && s.includes('winner')) return 'halves_h2h';
      
      return s.replace(/\s+/g, '_');
    };

    const processMarket = (key: string, outcomes: any[]) => {
      if (!outcomes || !Array.isArray(outcomes)) return;
      const canonKey = canonical(key);
      
      // Initialize if not exists, or append if exists (merge logic)
      if (!markets[canonKey]) markets[canonKey] = [];

      const mapped = outcomes.map((o: any) => {
        // Handle API-Football structure (value=label, odd=price) vs Internal/TheOddsApi (outcome=label, value=price)
        const label = String(o?.outcome ?? o?.name ?? o?.label ?? o?.value ?? '');
        let priceRaw = o?.odd ?? o?.price ?? o?.value ?? 0;
        
        // If priceRaw is the same as label (because value was used for both), and it's not a number, try to find another field
        if (priceRaw === label && isNaN(Number(priceRaw))) {
             // If structure is { value: "Home", odd: "1.50" }, priceRaw might have picked 'value'.
             // We should have picked 'odd'.
             if (o.odd !== undefined) priceRaw = o.odd;
        }

        const priceStr = typeof priceRaw === 'string' ? priceRaw.replace(',', '.') : priceRaw;
        const price = Number(priceStr);

        return {
          label,
          odd: Number.isFinite(price) ? price : 0,
          name: label,
          trend: 'stable'
        };
      });
      
      markets[canonKey] = mapped; 
    };

    // Handle Array (External Provider) or Object (Internal)
    if (Array.isArray(rawOdds)) {
      for (const market of rawOdds) {
        if (!market) continue;
        const outcomes = market.outcomes || market.values; // Support both
        const name = market.name || market.key || market.id; // Use name as key
        processMarket(String(name), outcomes);
      }
    } else {
      for (const [marketKey, market] of Object.entries(rawOdds)) { 
        if (!market) continue;
        let outcomes = (market as any).outcomes || (market as any).values;

        if (!outcomes && Array.isArray(market)) {
          outcomes = market as any[];
        }
        
        // Flat format support: if no outcomes array, treat the object itself as outcome map
        if (!outcomes && typeof market === 'object' && !Array.isArray(market)) {
            const entries = Object.entries(market as any);
            // Verify at least one value looks like a price/number
            if (entries.length > 0 && entries.some(([_, v]) => !isNaN(Number(v)))) {
                outcomes = entries.map(([k, v]) => ({ 
                    label: k,
                    price: v,
                    name: k
                }));
            }
        }

        processMarket(marketKey, outcomes);
      } 
    }
  }

  return { 
    oddsFrozen: !isPreMatch(fixture), 
    markets 
  }; 
}

/**
 * Applies Home Advantage (Mando de Campo)
 * Boosts Home team probability and penalizes Away team.
 */
export function applyHomeAdvantage(odds: { home?: number; draw?: number; away?: number }, boost: number = 0.10) {
    if (!odds.home || !odds.away) return odds;

    let pH = 1 / odds.home;
    let pA = 1 / odds.away;
    let pD = odds.draw ? (1 / odds.draw) : 0;
    
    // Normalize to 100% first
    const baseSum = pH + pA + pD;
    pH = pH / baseSum;
    pA = pA / baseSum;
    pD = pD / baseSum;

    // Sanity Check: If Draw > 40%, market is broken. Reconstruct.
    if (pD > 0.40) {
        const forcedDraw = 0.26;
        const ratio = pH / (pH + pA);
        pD = forcedDraw;
        const remaining = 1 - pD;
        pH = remaining * ratio;
        pA = remaining * (1 - ratio);
    }

    // Apply Boost
    const awayDisadvantage = 0.05; // 5%
    
    pH += boost;
    pA = Math.max(0.01, pA - awayDisadvantage);
    // Draw absorbs remaining or we re-normalize
    
    // Re-normalize to 100%
    const newSum = pH + pA + pD;
    pH = pH / newSum;
    pA = pA / newSum;
    pD = pD / newSum;
    
    // Re-calculate
    const newOdds: any = { ...odds };
    newOdds.home = parseFloat((1 / pH).toFixed(2));
    newOdds.away = parseFloat((1 / pA).toFixed(2));
    if (odds.draw) newOdds.draw = parseFloat((1 / pD).toFixed(2));
    
    return newOdds;
}

/**
 * Applies Safe Limits (Sanity Checks)
 */
export function applySafeLimits(odds: { home?: number; draw?: number; away?: number }) {
     const result: any = { ...odds };
     
     if (result.home && result.home < 2.0 && result.home > 1.60) {
         // Logic to be implemented if needed
     }
     
     if (result.away && result.away > 100) result.away = 100; // Cap max
     
     return result;
}
