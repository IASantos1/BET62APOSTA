import { Hono } from 'hono';
import { Env } from '../shared/types';
import { verifyAuth } from './middleware/jwtAuth';
import { checkSelfExclusion } from './middleware/selfExclusion';
import { calculateCashout } from './services/cashout';
import { canPlaceBet, updateExposure, initRiskTables, checkUserLimit } from './services/risk';
import { initSharpTables, checkMultiAccount, detectInternalArbitrage } from './services/sharpDetection';
import { balanceMarket, saveBalancedOdds } from './services/bookBalancing';
import { LedgerService } from './services/ledger';
import { AuditService } from './services/audit';
import { AccountStateService } from './services/accountState';

type Variables = {
    user: {
        userId: string;
    }
};

const bets = new Hono<{ Bindings: Env; Variables: Variables }>();

bets.use('*', verifyAuth);

// Get user's bets
// GET /api/bets
bets.get('/', async (c) => {
  const userId = c.get('user').userId;

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT 
        b.*, 
        e.home_team as team_home, 
        e.away_team as team_away, 
        e.league
      FROM bets b
      LEFT JOIN events e ON b.event_id = e.id
      WHERE b.user_id = ? 
      ORDER BY b.created_at DESC
    `).bind(userId).all();
    
    const formatted = (results || []).map((b: any) => ({
        ...b,
        team_match: b.type === 'multi' ? 'Aposta Múltipla' : (b.team_home ? `${b.team_home} vs ${b.team_away}` : 'Evento Indisponível'),
        league: b.league || (b.type === 'multi' ? 'Múltipla' : '')
    }));

    // Fetch selections for multi bets
    const multiBetIds = formatted.filter((b: any) => b.type === 'multi').map((b: any) => b.id);
    const selectionsMap = new Map();
    
    if (multiBetIds.length > 0) {
        const placeholders = multiBetIds.map(() => '?').join(',');
        const { results: selections } = await c.env.DB.prepare(`
            SELECT bs.*, e.home_team, e.away_team, e.league
            FROM bet_selections bs
            LEFT JOIN events e ON bs.event_id = e.id
            WHERE bs.bet_id IN (${placeholders})
        `).bind(...multiBetIds).all();

        (selections || []).forEach((s: any) => {
            if (!selectionsMap.has(s.bet_id)) {
                selectionsMap.set(s.bet_id, []);
            }
            selectionsMap.get(s.bet_id).push({
                ...s,
                team_match: s.home_team ? `${s.home_team} vs ${s.away_team}` : 'Evento Indisponível'
            });
        });
    }

    // Attach selections to bets
    const finalBets = formatted.map((b: any) => {
        if (b.type === 'multi') {
            return {
                ...b,
                selections: selectionsMap.get(b.id) || []
            };
        }
        return b;
    });

    // Cashout Calculation
    const eventIds = [...new Set(formatted.filter((b: any) => b.status === 'pending' && b.type !== 'multi').map((b: any) => b.event_id))];
    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => '?').join(',');
      const { results: oddsResults } = await c.env.DB.prepare(`
          SELECT id as event_id, payload FROM imported_odds WHERE id IN (${placeholders})
      `).bind(...eventIds).all();

      const oddsMap = new Map();
      (oddsResults || []).forEach((r: any) => {
          try {
              oddsMap.set(r.event_id, JSON.parse(r.payload));
          } catch { /* empty */ }
      });

      for (const bet of finalBets) {
          if (bet.status !== 'pending' || !bet.event_id || bet.type === 'multi') continue;
          
          const eventPayload = oddsMap.get(bet.event_id);
          if (!eventPayload || eventPayload.oddsFrozen) continue;

          let currentOdd = 0;
          let suspended = false;

          // Find matching outcome in any market
          if (eventPayload.odds && typeof eventPayload.odds === 'object') {
              for (const marketKey in eventPayload.odds) {
                  const market = eventPayload.odds[marketKey];
                  if (Array.isArray(market.outcomes)) {
                      const match = market.outcomes.find((o: any) => o.outcome === bet.selection);
                      if (match) {
                          currentOdd = Number(match.value);
                          suspended = !!market.suspended;
                          break;
                      }
                  } else if (Array.isArray(market)) {
                      // Legacy array support
                       const match = market.find((o: any) => o.outcome === bet.selection);
                       if (match) {
                           currentOdd = Number(match.value);
                           break;
                       }
                  }
              }
          }

          if (currentOdd > 1 && !suspended) {
             const cashout = calculateCashout({
                 stake: Number(bet.stake),
                 originalOdd: Number(bet.odd),
                 currentOdd,
                 suspended
             });
             if (cashout !== null) {
                 bet.cashoutAvailable = true;
                 bet.cashoutValue = cashout;
             }
          }
      }
    }

    return c.json(finalBets);
  } catch (e: any) {
    console.error('Error fetching bets:', e);
    return c.json({ error: 'Failed to fetch bets' }, 500);
  }
});

// Helper to find market info
function findMarketInfo(payload: any, selection: string) {
    if (!payload || !payload.odds) return null;
    
    for (const marketKey in payload.odds) {
        const market = payload.odds[marketKey];
        let outcomes: any[] = [];
        
        if (Array.isArray(market.outcomes)) {
            outcomes = market.outcomes;
        } else if (Array.isArray(market)) {
            outcomes = market;
        }

        const match = outcomes.find((o: any) => o.outcome === selection || o.label === selection);
        if (match) {
            return { marketKey, outcomes: outcomes.map((o: any) => ({
                label: o.outcome || o.label,
                odd: Number(o.value || o.odd),
                name: o.outcome || o.name
            })) };
        }
    }
    return null;
}

// Place bet(s)
// POST /api/bets
bets.post('/', checkSelfExclusion, async (c) => {
  const userId = c.get('user').userId;

  // Account State Guard
  const stateService = new AccountStateService(c.env.DB);
  const canBet = await stateService.canBet(userId);
  if (!canBet) {
      return c.json({ error: 'Betting not allowed: KYC Verification Required' }, 403);
  }

  try {
    const body = await c.req.json();
    console.log('[Bets] Received body:', JSON.stringify(body));
    let type = body.type || 'single';
    let totalStake = Number(body.stake);
    const useFreebet = body.use_freebet;
    console.log('[Bets] useFreebet:', useFreebet);
    let betItems = body.bets || [];
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const fingerprint = c.req.header('X-Device-Fingerprint') || 'unknown';

    // Legacy format support
    if (!body.bets && body.event_id) {
        type = 'single';
        totalStake = Number(body.stake);
        betItems = [{
            event_id: body.event_id,
            selection: body.selection,
            odd: Number(body.odd),
            stake: totalStake
        }];
    }

    if (totalStake <= 0) return c.json({ error: 'Invalid stake' }, 400);
    if (betItems.length === 0) return c.json({ error: 'No bets selected' }, 400);

    // Initialize Risk Tables (Idempotent)
    await initRiskTables(c.env.DB);
    await initSharpTables(c.env.DB);

    // Fetch Payloads for Validation & Balancing
    const eventPayloads = new Map();
    for (const item of betItems) {
        if (!eventPayloads.has(item.event_id)) {
            const record = await c.env.DB.prepare('SELECT payload FROM imported_odds WHERE id = ?').bind(item.event_id).first();
            if (record && record.payload) {
                try { eventPayloads.set(item.event_id, JSON.parse(record.payload as string)); } catch { /* empty */ }
            }
        }
    }

    // Validate and Check Risk per Item
    for (const item of betItems) {
        const payload = eventPayloads.get(item.event_id);
        const marketInfo = findMarketInfo(payload, item.selection);
        const marketKey = marketInfo ? marketInfo.marketKey : 'main';
        item.market_key = marketKey;
        
        // Risk Check
        const riskCheck = await canPlaceBet({
            db: c.env.DB,
            userId: userId,
            marketId: `${item.event_id}_${marketKey}`,
            stake: item.stake || (totalStake / betItems.length),
            odd: Number(item.odd)
        });

        if (!riskCheck.ok) {
            return c.json({ error: `Aposta recusada (Risco): ${riskCheck.reason}` }, 400);
        }

        // Apply dynamic odd changes if any
        if (riskCheck.ok && riskCheck.modifiedOdd) {
             item.odd = riskCheck.modifiedOdd;
        }
    }

    // Multi-Account & Arbitrage Check
    const isMultiAccount = await checkMultiAccount(c.env.DB, userId, ip, fingerprint);
    if (isMultiAccount.detected) {
         console.warn(`[Risk] Multi-account detected for user ${userId}`);
         // Can auto-suspend here if needed, but for now just warn or block
         return c.json({ error: 'Suspicious activity detected' }, 403);
    }
    
    // Check Limits
    const limitCheck = await checkUserLimit(c.env.DB, userId, totalStake);
    if (!limitCheck.ok) {
        return c.json({ error: `Stake limit exceeded. Max stake: ${limitCheck.maxStake}` }, 400);
    }

    if (useFreebet) {
        const now = new Date().toISOString();
        const freebet = await c.env.DB.prepare(`
            SELECT id, amount_eur FROM user_freebets 
            WHERE user_id = ? AND used = 0 AND expires_at > ?
            ORDER BY amount_eur DESC
            LIMIT 1
        `).bind(userId, now).first();

        if (!freebet || (freebet as any).amount_eur < totalStake) {
             return c.json({ error: 'Freebet insuficiente ou expirada' }, 400);
        }

        await c.env.DB.prepare('UPDATE user_freebets SET used = 1 WHERE id = ?').bind((freebet as any).id).run();
    } else {
        // Ledger: Debit Stake
        const w = await c.env.DB.prepare('SELECT id FROM wallets WHERE user_id = ?').bind(userId).first();
        if (!w) return c.json({ error: 'Carteira não encontrada' }, 404);

        const audit = new AuditService(c.env.DB);
        const ledger = new LedgerService(c.env.DB, audit);
        try {
            await ledger.addTransaction(
                (w as any).id,
                'debit',
                totalStake,
                `BET:${type}:${Date.now()}`, 
                'Bet placement',
                { actorId: userId, ip, userAgent: c.req.header('User-Agent') || 'unknown' }
            );
        } catch (e: any) {
            return c.json({ error: 'Saldo insuficiente' }, 400);
        }
    }

    // Place Bets in DB
    const placedBets = [];
    if (type === 'single') {
        for (const item of betItems) {
            const { results } = await c.env.DB.prepare(`
                INSERT INTO bets (user_id, event_id, selection, odd, stake, potential_win, status, type, is_freebet)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', 'single', ?)
                RETURNING *
            `).bind(
                userId, 
                item.event_id, 
                item.selection, 
                item.odd, 
                item.stake || totalStake, 
                (item.stake || totalStake) * item.odd,
                useFreebet ? 1 : 0
            ).run();
            
            const betId = results[0].id;

            // Insert into bet_selections
            await c.env.DB.prepare(`
                INSERT INTO bet_selections (bet_id, event_id, market_key, selection, odd, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            `).bind(
                betId,
                item.event_id,
                item.market_key,
                item.selection,
                item.odd
            ).run();

            // Tier-1: Update Market Exposure & Balance
            const payload = eventPayloads.get(item.event_id);
            const marketInfo = findMarketInfo(payload, item.selection);
            if (marketInfo) {
                 await updateExposure(c.env.DB, `${item.event_id}_${marketInfo.marketKey}`, item.selection, item.stake || totalStake, (item.stake || totalStake) * item.odd);
                 const newOdds = await balanceMarket(c.env.DB, `${item.event_id}_${marketInfo.marketKey}`, marketInfo.outcomes);
                 if (newOdds) {
                     // Update payload with new odds
                     await saveBalancedOdds(c.env.DB, item.event_id, marketInfo.marketKey, newOdds);
                 }
            }

            placedBets.push(results[0]);
        }
    } else {
        // Multiple
        const combinedOdd = betItems.reduce((acc: number, b: any) => acc * Number(b.odd), 1);
        
        // Multi+ Bonus (8% for 6+ games)
        let bonusMultiplier = 1;
        if (betItems.length >= 6) {
            bonusMultiplier = 1.08;
        }
        
        const potentialWin = totalStake * combinedOdd * bonusMultiplier;
        
        const { results } = await c.env.DB.prepare(`
            INSERT INTO bets (user_id, event_id, selection, odd, stake, potential_win, status, type, is_freebet)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', 'multi', ?)
            RETURNING *
        `).bind(
            userId, 
            0, // event_id 0 for multi
            JSON.stringify(betItems.map((b: any) => `${b.selection} @ ${b.odd}`)), 
            combinedOdd, 
            totalStake, 
            potentialWin,
            useFreebet ? 1 : 0
        ).run();

        const betId = results[0].id;

        // Insert selections
        const stmt = c.env.DB.prepare(`
            INSERT INTO bet_selections (bet_id, event_id, market_key, selection, odd, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `);

        const batch = betItems.map((item: any) => stmt.bind(
            betId,
            item.event_id,
            item.market_key,
            item.selection,
            item.odd
        ));

        await c.env.DB.batch(batch);

        placedBets.push(results[0]);
    }

    return c.json({ success: true, bets: placedBets });

  } catch (e: any) {
    console.error('Bet placement error:', e);
    return c.json({ error: e.message || 'Internal error', stack: e.stack }, 500);
  }
});

export default bets;
