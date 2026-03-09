

const oddsCache = new Map<string, number>();

function getTrend(key: string, newOdd: number): 'up' | 'down' | 'stable' {
  const oldOdd = oddsCache.get(key);
  oddsCache.set(key, newOdd);

  if (!oldOdd) return 'stable';
  if (newOdd > oldOdd) return 'up';
  if (newOdd < oldOdd) return 'down';
  return 'stable';
}

export function generateLiveOdds(fixture: any) { 
  const elapsed = fixture.elapsed ?? 0; 
  const homeGoals = fixture.goals?.home ?? 0; 
  const awayGoals = fixture.goals?.away ?? 0; 
  const sport = (fixture.sport || '').toLowerCase();

  const isHighScoringSport = ['basketball', 'nba', 'american-football', 'nfl', 'rugby'].some(s => sport.includes(s));
  const isTwoWaySport = ['basketball', 'nba', 'american-football', 'nfl', 'baseball', 'tennis', 'mma'].some(s => sport.includes(s));

  const diff = homeGoals - awayGoals; 

  // --- 1. Base Odds (Use Pre-Match if available) ---
  // Default neutral if no pre-match odds: 2.50 (approx 40% win chance for each in soccer?) or 2.0/3.0/2.0
  let baseHome = Number(fixture.home_odd) || 2.50;
  let baseDraw = Number(fixture.draw_odd) || 3.20;
  let baseAway = Number(fixture.away_odd) || 2.50;

  if (isTwoWaySport) {
      baseHome = Number(fixture.home_odd) || 1.90;
      baseAway = Number(fixture.away_odd) || 1.90;
      baseDraw = 0; // Ignore
  }

  // --- 2. Home Advantage (Mando de Campo) ---
  // User Rule: "Home Advantage Factor" / "Home Boost"
  // Example: Boost Home Prob by +5% to +10%, Reduce Away by -5%
  // We apply this to Probabilities
  const HOME_ADVANTAGE_BOOST = 0.10; // 10% boost for Home (User requested +8% to +12%)
  const AWAY_DISADVANTAGE = 0.05;    // 5% penalty for Away (playing away)

  let pH = 1 / baseHome;
  let pD = isTwoWaySport ? 0 : (1 / baseDraw);
  let pA = 1 / baseAway;

  // Apply Boost (only if not already baked in? Assuming pre-match odds MIGHT have it, but user wants to FORCE it)
  // If we rely on scraped pre-match odds, they usually have it.
  // But if we are generating from scratch (2.50), we definitely need it.
  // User says: "Muitos painéis erram porque tratam jogos como neutros."
  // So we apply it especially if we are using defaults or if user explicitly wants "Vantagem de Mando".
  
  // Normalize probabilities to 100% first to ensure base is correct
  const baseSum = pH + pD + pA;
  pH = pH / baseSum;
  pD = pD / baseSum;
  pA = pA / baseSum;

  // Apply Home Advantage Shift
  pH = pH + HOME_ADVANTAGE_BOOST; 
  pA = Math.max(0.01, pA - AWAY_DISADVANTAGE);
  // Re-normalize to 100% after shift (Draw absorbs the rest or we just normalize all)
  const shiftedSum = pH + pD + pA;
  pH = pH / shiftedSum;
  pD = pD / shiftedSum;
  pA = pA / shiftedSum;
  
  // Re-calculate Odds from Adjusted Probabilities (Base for Live Calc)
  let home = 1 / pH;
  let away = 1 / pA;
  let draw = isTwoWaySport ? 0 : (1 / pD);

  // --- 3. Live Game State Adjustment (Score & Time) ---
  // Adjust sensitivity for high scoring sports
  const factor = isHighScoringSport ? 0.05 : 0.6;

  if (diff > 0) { 
    // Home leading: Home odd drops, Away rises
    home = Math.max(1.01, home - diff * factor); 
    away = Math.min(25, away + diff * (factor * 2)); 
    if (!isTwoWaySport) draw = Math.min(15, draw + diff * 0.2);
  } else if (diff < 0) { 
    // Away leading: Away odd drops, Home rises
    away = Math.max(1.01, away - Math.abs(diff) * factor); 
    home = Math.min(25, home + Math.abs(diff) * (factor * 2)); 
    if (!isTwoWaySport) draw = Math.min(15, draw + Math.abs(diff) * 0.2);
  } 

  // Time Decay (Decay draw if draw is likely? No, usually Draw drops as time passes in Soccer)
  // In Soccer: As time passes, Draw drops (prob increases), 1 and 2 rise (prob decreases) UNLESS one team is leading.
  if (!isTwoWaySport && diff === 0) {
      if (elapsed > 60) {
          draw = Math.max(1.01, draw * 0.9); // Draw becomes more likely
          home = home * 1.1;
          away = away * 1.1;
      }
      if (elapsed > 80) {
          draw = Math.max(1.01, draw * 0.8);
          home = home * 1.2;
          away = away * 1.2;
      }
  } else {
     // If someone is leading, the leading team odd drops further as time passes
     if (elapsed > 70) {
         if (diff > 0) home = home * 0.8;
         else if (diff < 0) away = away * 0.8;
     }
  }
  
  // --- 4. Safety Limits (Failsafe) ---
  // "Favorito claro em casa NUNCA pode ter odd maior que 1.60" (if pre-game was favorite)
  // "Azarão fora NUNCA menor que 4.50"
  // We use baseHome (pre-match) to identify favorite
  const isHomeFavoritePre = baseHome < 1.80;
  
  if (isHomeFavoritePre && diff >= 0) {
      // If home was favorite and is winning or drawing, cap the odd
      home = Math.min(home, 1.60); 
  }
  
  const isAwayUnderdogPre = baseAway > 4.0;
  if (isAwayUnderdogPre && diff <= 0) {
      // If away was underdog and is losing or drawing, floor the odd
      away = Math.max(away, 4.50);
  }


  // --- 5. Normalization (Overround/Margin) ---
  // User Rule: "Total = 107% ... Odds invertidas se mal definido"
  const TARGET_OVERROUND = 1.07; // 7% Margin

  const currentProbSum = (1/home) + (1/away) + (isTwoWaySport ? 0 : (1/draw));
  
  // Scale probabilities to match Target Overround
  // We want Sum(NewProb) = TargetOverround.
  // Sum(Prob * K) = TargetOverround => K * Sum(Prob) = TargetOverround => K = TargetOverround / Sum(Prob).
  
  const K = TARGET_OVERROUND / currentProbSum;

  home = 1 / ((1/home) * K);
  away = 1 / ((1/away) * K);
  if (!isTwoWaySport) draw = 1 / ((1/draw) * K);

  // Format to 2 decimals
  home = Number(home.toFixed(2));
  draw = Number(draw.toFixed(2));
  away = Number(away.toFixed(2));

  // Generate cache keys
  const homeKey = `${fixture.id}:h2h:home`;
  const drawKey = `${fixture.id}:h2h:draw`;
  const awayKey = `${fixture.id}:h2h:away`;

  const h2h = [
    { label: 'Casa', odd: home, trend: getTrend(homeKey, home) },
    // Only include Draw if NOT a 2-way sport
    ...(!isTwoWaySport ? [{ label: 'Empate', odd: draw, trend: getTrend(drawKey, draw) }] : []),
    { label: 'Fora', odd: away, trend: getTrend(awayKey, away) } 
  ];

  return { 
    oddsFrozen: false, 
    markets: { 
      h2h: h2h
    } 
  }; 
} 
 
