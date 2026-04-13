import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb } from './db.js';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { hashPassword, comparePassword, createAccessToken, createRefreshToken, saveRefreshToken, revokeRefreshToken, getRefreshToken, verifyAccessToken } from './services/auth.js';
import { ledgerService } from './services/ledger.js';
import { normalizeSport, isLeagueAllowed, isBlocked, leagueTier, LIVE_STATUSES, derivedBtts, buildSuspendedMarkets, resolveTeamImage } from './services/sports.js';

const PORT = Number(process.env.API_PORT || 3001);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function json(res, status, body) {
  res.status(status);
  res.header('Content-Type', 'application/json; charset=utf-8');
  return res.body(JSON.stringify(body));
}

function requireAuth(c) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  return { userId: payload.sub, role: payload.role || 'user' };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isAdmin(c) {
  const header = String(c.req.header('Authorization') || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const key = String(c.req.query('key') || c.req.query('token') || '');
  const token = bearer || key;
  if (!token) return false;
  return Boolean(ADMIN_TOKEN) && token === ADMIN_TOKEN;
}

function requireCron(c) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const header = String(c.req.header('Authorization') || '');
  return header === `Bearer ${secret}`;
}

const app = new Hono();
app.use('*', async (c, next) => {
  const start = Date.now();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  try {
    await next();
  } finally {
    const ms = Date.now() - start;
    try {
      console.log(JSON.stringify({ type: 'http', method: c.req.method, path: c.req.path, status: c.res.status, ms }));
    } catch {}
  }
});
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '';
    if (CORS_ORIGINS.length === 0) return '*';
    return CORS_ORIGINS.includes(origin) ? origin : '';
  },
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.get('/api/health', async (c) => {
  const db = getDb();
  const evCount = (await db.prepare('SELECT COUNT(*) as n FROM events').get())?.n || 0;
  const liveCount = (await db.prepare('SELECT COUNT(*) as n FROM events WHERE is_live = 1').get())?.n || 0;
  return json(c, 200, { status: 'ok', events: evCount, liveEvents: liveCount, timestamp: new Date().toISOString() });
});

// ── Sports list ────────────────────────────────────────────────────────── 
app.get('/api/sports', async (c) => { 
  const db = getDb(); 
  try { 
    const rows = await db.prepare(` 
      SELECT sport, COUNT(*) as total, 
        SUM(CASE WHEN is_live = 1 THEN 1 ELSE 0 END) as live_count 
      FROM events 
      WHERE datetime(event_date) BETWEEN datetime('now', '-3 hours') AND datetime('now', '+14 days') 
        AND COALESCE(status,'NS') NOT IN ('FT','AET','PEN','AWD','WO','ABD','FIN','FINAL','Finished','Match Finished','Final','Ended','AOT','AP','POST','FT_PEN') 
      GROUP BY sport 
      ORDER BY live_count DESC, total DESC 
    `).all(); 

    const SPORT_LABELS = { 
      soccer: 'Futebol', basketball: 'Basquetebol', 'ice-hockey': 'Hóquei no Gelo', 
      tennis: 'Ténis', baseball: 'Basebol', handball: 'Andebol', volleyball: 'Voleibol', 
      rugby: 'Rugby', 'american-football': 'Futebol Americano', mma: 'MMA', 
      boxing: 'Boxe', afl: 'AFL', 'formula-1': 'Fórmula 1', 
    }; 

    const sports = rows.map(r => ({ 
      key: r.sport, 
      name: SPORT_LABELS[r.sport] || r.sport, 
      total: r.total, 
      live: r.live_count, 
    })); 
    return json(c, 200, sports); 
  } catch { 
    return json(c, 200, []); 
  } 
}); 

// ── Pricing config ──────────────────────────────────────────────────────── 
app.get('/api/pricing/config', async (c) => { 
  return json(c, 200, { 
    minDeposit: 10, 
    maxDeposit: 50000, 
    minWithdrawal: 10, 
    maxWithdrawal: 50000, 
    minBet: 1, 
    maxBet: 10000, 
    maxOdd: 1000, 
    maxSelections: 20, 
    currency: 'EUR', 
    stripeEnabled: !!process.env.STRIPE_SECRET_KEY, 
    mbWayEnabled: false, 
    multibancoEnabled: false, 
  }); 
}); 

import { streamSSE } from 'hono/streaming';

// ── Live SSE stream (/api/live/stream) ─────────────────────────────────── 
// Pushes live event data (score, odds, status) every 5 seconds to connected clients. 
app.get('/api/live/stream', async (c) => { 
  const rawSport = String(c.req.query('sports') || c.req.query('sport') || 'all').trim(); 
  const sport = rawSport === 'all' ? null : rawSport.split(',')[0].toLowerCase().trim(); 

  return streamSSE(c, async (stream) => {
    const send = async (data) => { 
      try { 
        await stream.writeSSE({ data: JSON.stringify(data) }); 
      } catch { /* client disconnected */ } 
    }; 

    await send({ type: 'hello' }); 

    const pushUpdates = async () => { 
      try { 
        const db = getDb(); 
        const parseScore = (r) => { 
          try { return typeof r.score === 'string' ? JSON.parse(r.score) : (r.score || { home: null, away: null }); } catch { return { home: null, away: null }; } 
        }; 
        const rows = db.prepare(` 
          SELECT id, external_event_id, sport, status, elapsed, score, 
                 home_odd, draw_odd, away_odd, is_live 
          FROM events 
          WHERE is_live = 1 
            ${sport ? "AND sport = ?" : ""} 
          LIMIT 200 
        `);
        const rowsData = await rows.all(...(sport ? [sport] : []));

        const updates = rowsData.map(r => { 
          const score = parseScore(r); 
          return { 
            id: String(r.id), 
            external_event_id: r.external_event_id, 
            sport: r.sport, 
            status: r.status, 
            elapsed: r.elapsed, 
            score, 
            home_odd: Number(r.home_odd || 0), 
            draw_odd: Number(r.draw_odd || 0), 
            away_odd: Number(r.away_odd || 0), 
            is_live: Number(r.is_live), 
          }; 
        }); 

        if (updates.length > 0) await send({ type: 'live', updates }); 
        else await send({ type: 'ping' }); 
      } catch { await send({ type: 'ping' }); } 
    }; 

    await pushUpdates(); 
    const interval = setInterval(pushUpdates, 5000); 

    const heartbeat = setInterval(async () => { 
      try { await stream.writeSSE({ data: ': ping' }); } catch { /* disconnected */ } 
    }, 25000); 

    stream.onAbort(() => {
      clearInterval(interval); 
      clearInterval(heartbeat); 
    });
    
    // Mantém a conexão aberta
    while (true) {
      await stream.sleep(1000);
    }
  });
}); 

app.post('/api/auth/signup', async (c) => {
  try {
    const d = getDb();
    const body = await c.req.json().catch(() => ({}));
    const { firstName, lastName, email, password, dob, country } = body;
    if (!email || !password || !firstName || !lastName || !dob || !country) {
      return json(c, 400, { error: 'Todos os campos são obrigatórios' });
    }
    if (String(password).length < 8) return json(c, 400, { error: 'Senha deve ter no mínimo 8 caracteres' });

    const existing = await d.prepare('SELECT id FROM users WHERE username = ?').get(email);
    if (existing) return json(c, 400, { error: 'Email já registado' });

    const userId = randomUUID();
    const hashed = await hashPassword(password);

    await d.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, email);
    await d.prepare('INSERT INTO user_credentials (id, user_id, hashed_password) VALUES (?, ?, ?)').run(randomUUID(), userId, hashed);
    await d.prepare(`INSERT INTO user_profile (user_id, email, first_name, last_name, full_name, birth_date, country, kyc_status, terms_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified', datetime('now'), datetime('now'), datetime('now'))`).run(userId, email, firstName, lastName, `${firstName} ${lastName}`, dob, country);
    await d.prepare('INSERT INTO wallets (user_id, currency) VALUES (?, ?)').run(userId, 'EUR');

    const accessToken = createAccessToken(userId);
    const refreshToken = createRefreshToken();
    await saveRefreshToken(userId, refreshToken);

    return json(c, 200, { success: true, token: accessToken, refreshToken, user: { id: userId, username: email } });
  } catch (err) {
    console.error('[Auth] signup error:', err);
    return json(c, 500, { error: 'Erro interno' });
  }
});

app.post('/api/auth/signin', async (c) => {
  try {
    const d = getDb();
    const body = await c.req.json().catch(() => ({}));
    const { username, password } = body;
    if (!username || !password) return json(c, 400, { error: 'Email e senha são obrigatórios' });

    const user = await d.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return json(c, 401, { error: 'Credenciais inválidas' });

    const creds = await d.prepare('SELECT hashed_password FROM user_credentials WHERE user_id = ?').get(user.id);
    if (!creds) return json(c, 401, { error: 'Credenciais inválidas' });

    const valid = await comparePassword(password, creds.hashed_password);
    if (!valid) return json(c, 401, { error: 'Credenciais inválidas' });

    const profile = await d.prepare('SELECT self_exclude, self_exclude_until FROM user_profile WHERE user_id = ?').get(user.id);
    if (profile?.self_exclude) {
      const until = profile.self_exclude_until ? new Date(profile.self_exclude_until) : null;
      if (!until || until > new Date()) {
        return json(c, 403, { error: 'Conta autoexcluída', until: until?.toISOString() || 'PERMANENT' });
      }
    }

    const accessToken = createAccessToken(user.id, user.role || 'user');
    const refreshToken = createRefreshToken();
    await saveRefreshToken(user.id, refreshToken);

    return json(c, 200, { success: true, token: accessToken, refreshToken, user: { id: user.id, username: user.username, twofa_enabled: user.twofa_enabled || 0 } });
  } catch (err) {
    console.error('[Auth] signin error:', err);
    return json(c, 500, { error: 'Erro interno' });
  }
});

app.post('/api/auth/refresh', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { refreshToken } = body;
    if (!refreshToken) return json(c, 400, { error: 'refreshToken obrigatório' });

    const stored = await getRefreshToken(refreshToken);
    if (!stored) return json(c, 401, { error: 'Refresh token inválido ou expirado' });

    const d = getDb();
    const user = await d.prepare('SELECT * FROM users WHERE id = ?').get(stored.user_id);
    if (!user) return json(c, 401, { error: 'Utilizador não encontrado' });

    await revokeRefreshToken(refreshToken);
    const newAccessToken = createAccessToken(user.id, user.role || 'user');
    const newRefreshToken = createRefreshToken();
    await saveRefreshToken(user.id, newRefreshToken);

    return json(c, 200, { token: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return json(c, 500, { error: 'Erro interno' });
  }
});

app.post('/api/auth/logout', async (c) => {
  const user = requireAuth(c);
  if (!user) return json(c, 401, { error: 'Não autenticado' });
  const body = await c.req.json().catch(() => ({}));
  if (body.refreshToken) await revokeRefreshToken(body.refreshToken);
  return json(c, 200, { success: true });
});

app.get('/api/auth/me', async (c) => {
  try {
    const auth = requireAuth(c);
    if (!auth) return json(c, 401, { error: 'Não autenticado' });

    const d = getDb();
    const user = await d.prepare('SELECT id, username, role, twofa_enabled FROM users WHERE id = ?').get(auth.userId);
    if (!user) return json(c, 404, { error: 'Utilizador não encontrado' });

    const profile = await d.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(auth.userId);
    const wallet = await d.prepare('SELECT id FROM wallets WHERE user_id = ?').get(auth.userId);

    return json(c, 200, {
      id: user.id,
      username: user.username,
      role: user.role || profile?.is_operator ? 'admin' : 'user',
      twofa_enabled: user.twofa_enabled || 0,
      profile: profile || {},
      walletId: wallet?.id,
    });
  } catch (err) {
    return json(c, 500, { error: 'Erro interno' });
  }
});

app.post('/api/auth/heartbeat', (c) => {
  if (!requireAuth(c)) return json(c, 401, { error: 'Não autenticado' });
  return json(c, 200, { ok: true });
});
app.get('/api/auth/heartbeat', (c) => {
  if (!requireAuth(c)) return json(c, 401, { error: 'Não autenticado' });
  return json(c, 200, { ok: true });
});

app.get('/api/wallet/balances', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  const bal = await ledgerService.getBalance(auth.userId);
  const wId = await ledgerService.getWalletId(auth.userId);
  return json(c, 200, [{ currency: 'EUR', balance: bal, available: bal }]);
});

app.get('/api/wallet/transactions', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const rows = await ledgerService.getTransactions(auth.userId, limit);
  return json(c, 200, rows);
});

app.post('/api/wallet/payment-intent', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return json(c, 503, { error: 'Pagamentos via cartão temporariamente indisponíveis. Use Transferência Bancária.' });
  }

  try {
    const stripe = new Stripe(stripeKey);
    const body = await c.req.json().catch(() => ({}));
    const { amount, method } = body;
    if (!amount || amount <= 0) return json(c, 400, { error: 'Montante inválido' });
    const m = String(method || 'card').trim();
    const allowed = new Set(['card', 'mb_way', 'multibanco']);
    if (!allowed.has(m)) return json(c, 400, { error: 'Método inválido' });

    const pi = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: 'eur',
      payment_method_types: [m],
      metadata: { userId: auth.userId, purpose: 'deposit' },
    });
    return json(c, 200, { clientSecret: pi.client_secret });
  } catch (err) {
    return json(c, 500, { error: err.message });
  }
});

app.post('/api/wallet/confirm-deposit', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(c, 503, { error: 'Stripe não configurado' });

  try {
    const stripe = new Stripe(stripeKey);
    const body = await c.req.json().catch(() => ({}));
    const { paymentIntentId } = body;
    if (!paymentIntentId) return json(c, 400, { error: 'paymentIntentId obrigatório' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.userId !== auth.userId) return json(c, 403, { error: 'Não autorizado' });
    if (pi.status !== 'succeeded') return json(c, 400, { error: `Pagamento não confirmado: ${pi.status}` });

    const amount = (pi.amount_received || pi.amount || 0) / 100;
    const ref = `DEPOSIT:stripe:${pi.id}`;
    ledgerService.credit(auth.userId, amount, ref, 'Depósito via Stripe');
    return json(c, 200, { success: true, amount, balance: ledgerService.getBalance(auth.userId) });
  } catch (err) {
    return json(c, 500, { error: err.message });
  }
});

app.post('/api/wallet/webhook/stripe', async (c) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey) return json(c, 200, { received: true });

  try {
    const stripe = new Stripe(stripeKey);
    const sig = c.req.header('stripe-signature');
    let event;
    const rawBody = await c.req.text();

    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else {
      event = JSON.parse(rawBody);
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const userId = pi.metadata?.userId;
      const purpose = pi.metadata?.purpose;
      const amount = (pi.amount_received || pi.amount || 0) / 100;
      if (purpose === 'deposit' && userId && amount > 0) {
        try { ledgerService.credit(userId, amount, `DEPOSIT:stripe:${pi.id}`, 'Depósito via Stripe (webhook)'); } catch { /* already credited */ }
      }
    }
    return json(c, 200, { received: true });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

app.post('/api/wallet/withdraw', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });

  try {
    const body = await c.req.json().catch(() => ({}));
    const { amount, method, destination } = body;
    if (!amount || amount < 10) return json(c, 400, { error: 'Montante mínimo de levantamento é €10' });
    if (!method || !destination) return json(c, 400, { error: 'Método e destino são obrigatórios' });

    const balance = await ledgerService.getBalance(auth.userId);
    if (balance < amount) return json(c, 400, { error: `Saldo insuficiente. Disponível: €${balance.toFixed(2)}` });

    const d = getDb();
    const id = randomUUID();
    await ledgerService.hold(auth.userId, amount, `WITHDRAW:${id}`, 'Hold para levantamento');
    await d.prepare(`INSERT INTO withdrawals (id, user_id, amount, method, destination, status) VALUES (?, ?, ?, ?, ?, 'pending')`).run(id, auth.userId, amount, method, destination);

    return json(c, 200, { success: true, id, status: 'pending', amount });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

app.post('/api/wallet/admin/credit', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado – token inválido' });
  const body = await c.req.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const amount = Number(body.amount || 0);
  const reference = String(body.reference || '').trim();
  const description = String(body.description || '').trim();
  if (!userId || !(amount > 0) || !reference) return json(c, 400, { error: 'invalid_request' });

  try {
    const result = await ledgerService.credit(userId, amount, reference, description);
    const bal = await ledgerService.getBalance(userId);
    return json(c, 200, { ok: true, reference, balance: bal, id: result.id, skipped: Boolean(result.skipped) });
  } catch (err) {
    return json(c, 500, { error: err.message });
  }
});

app.get('/api/bets', async (c) => {
  try {
    const auth = requireAuth(c);
    if (!auth) return json(c, 401, { error: 'Não autenticado' });
    const d = getDb();
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
    const bets = await d.prepare(`
      SELECT b.*, e.home_team as team_home, e.away_team as team_away, e.league, e.sport
      FROM bets b
      LEFT JOIN events e ON b.event_id = e.external_event_id OR b.event_id = CAST(e.id AS TEXT)
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT ?
    `).all(auth.userId, limit);

    const multiBetIds = bets.filter(b => b.type === 'multi').map(b => b.id);
    const selectionsMap = new Map();

    if (multiBetIds.length > 0) {
      const ph = multiBetIds.map(() => '?').join(',');
      const sels = await d.prepare(`
        SELECT bs.*, e.home_team, e.away_team, e.league
        FROM bet_selections bs
        LEFT JOIN events e ON bs.event_id = e.external_event_id OR bs.event_id = CAST(e.id AS TEXT)
        WHERE bs.bet_id IN (${ph})
      `).all(...multiBetIds);
      sels.forEach(s => {
        if (!selectionsMap.has(s.bet_id)) selectionsMap.set(s.bet_id, []);
        selectionsMap.get(s.bet_id).push({ ...s, team_match: s.home_team ? `${s.home_team} vs ${s.away_team}` : 'Evento Indisponível' });
      });
    }

    const formatted = bets.map(b => ({
      ...b,
      team_match: b.type === 'multi' ? 'Aposta Múltipla' : (b.team_home ? `${b.team_home} vs ${b.team_away}` : 'Evento Indisponível'),
      league: b.league || (b.type === 'multi' ? 'Múltipla' : ''),
      selections: b.type === 'multi' ? (selectionsMap.get(b.id) || []) : undefined,
    }));

    return json(c, 200, formatted);
  } catch (err) {
    console.error('[Bets] GET error:', err);
    return json(c, 500, { error: 'Erro ao obter apostas' });
  }
});

app.post('/api/bets', async (c) => {
  try {
    const auth = requireAuth(c);
    if (!auth) return json(c, 401, { error: 'Não autenticado' });

    const body = await c.req.json().catch(() => ({}));
    const { eventId, selection, odd, stake, type, selections } = body;
    const betType = type || 'single';

    if (!stake || stake < 1) return json(c, 400, { error: 'Aposta mínima é €1' });
    if (stake > 10000) return json(c, 400, { error: 'Aposta máxima é €10.000' });
    if (!odd || odd < 1.01) return json(c, 400, { error: 'Odd inválida' });

    const d = getDb();
    const balance = await ledgerService.getBalance(auth.userId);
    if (balance < stake) return json(c, 400, { error: `Saldo insuficiente. Disponível: €${balance.toFixed(2)}` });

    const potentialWin = Math.round(stake * odd * 100) / 100;
    const betRef = `BET:${Date.now()}:${auth.userId}`;

    const betRow = await d.prepare(`
      INSERT INTO bets (user_id, type, selection, odd, stake, potential_win, status, event_id, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      RETURNING id
    `).get(auth.userId, betType, selection || 'Aposta Múltipla', odd, stake, potentialWin, eventId || null, null);

    const betId = betRow?.id;
    if (!betId) throw new Error('Falha ao criar aposta');

    if (betType === 'multi' && Array.isArray(selections) && selections.length > 0) {
      for (const sel of selections) {
        await d.prepare(`
          INSERT INTO bet_selections (bet_id, event_id, market_key, selection, odd, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(betId, sel.eventId || null, sel.marketKey || 'h2h', sel.selection || '', sel.odd || 1);
      }
    }

    await ledgerService.debit(auth.userId, stake, betRef, `Aposta #${betId}`);
    return json(c, 200, { success: true, betId, potentialWin, balance: await ledgerService.getBalance(auth.userId) });
  } catch (err) {
    console.error('[Bets] POST error:', err);
    return json(c, 400, { error: err.message || 'Erro ao colocar aposta' });
  }
});

app.post('/api/bets/:id/cashout', async (c) => {
  try {
    const auth = requireAuth(c);
    if (!auth) return json(c, 401, { error: 'Não autenticado' });

    const d = getDb();
    const id = c.req.param('id');
    const bet = await d.prepare('SELECT * FROM bets WHERE id = ? AND user_id = ?').get(id, auth.userId);
    if (!bet) return json(c, 404, { error: 'Aposta não encontrada' });
    if (bet.status !== 'pending') return json(c, 400, { error: 'Aposta não está pendente' });

    const event = bet.event_id ? await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ?').get(bet.event_id, bet.event_id) : null;
    const currentOdd = event ? (Number(event.home_odd) || bet.odd) : bet.odd;
    const cashoutValue = Math.round((bet.stake * (bet.odd / currentOdd)) * 0.9 * 100) / 100;

    if (cashoutValue < 0.5) return json(c, 400, { error: 'Valor de cashout muito baixo' });

    await d.prepare('UPDATE bets SET status = ?, result = ?, updated_at = datetime("now") WHERE id = ?').run('cashout', `cashout:${cashoutValue}`, bet.id);
    await ledgerService.credit(auth.userId, cashoutValue, `CASHOUT:${bet.id}`, `Cashout aposta #${bet.id}`);

    return json(c, 200, { success: true, cashoutValue, balance: await ledgerService.getBalance(auth.userId) });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

// GET /api/events/:id/stats — Match statistics (from API-Football) 
app.get('/api/events/:id/stats', async (c) => { 
  try { 
    const db = getDb(); 
    const id = c.req.param('id'); 
    const event = await db.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id); 
    if (!event) return json(c, 200, { statistics: [] }); 
    const apiKey = process.env.API_SPORTS_KEY; 
    if (!apiKey || event.sport !== 'soccer') return json(c, 200, { statistics: [] }); 
    const extId = String(event.external_event_id || '').replace(/^soccer_/, ''); 
    if (!extId || isNaN(Number(extId))) return json(c, 200, { statistics: [] }); 
    
    const resp = await fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${extId}`, { 
      headers: { 'x-apisports-key': apiKey } 
    }); 
    if (!resp.ok) return json(c, 200, { statistics: [] }); 
    const data = await resp.json(); 
    return json(c, 200, { statistics: data?.response || [] }); 
  } catch (err) { 
    console.error('[Sports] stats error:', err.message); 
    return json(c, 200, { statistics: [] }); 
  } 
}); 

// GET /api/events/:id/odds — Fetch fresh odds for a single event from odds-api.io 
app.get('/api/events/:id/odds', async (c) => { 
  try { 
    const db = getDb(); 
    const id = c.req.param('id'); 
    const event = await db.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id); 
    if (!event) return json(c, 404, { error: 'Evento não encontrado' }); 
    const markets = (() => { try { return typeof event.markets === 'string' ? JSON.parse(event.markets) : (event.markets || {}); } catch { return {}; } })(); 
    return json(c, 200, { markets, home_odd: event.home_odd, draw_odd: event.draw_odd, away_odd: event.away_odd }); 
  } catch (err) { 
    return json(c, 500, { error: 'Erro ao obter odds' }); 
  } 
}); 

// GET /api/events/:id/lineups — Match lineups (from API-Football) 
app.get('/api/events/:id/lineups', async (c) => { 
  try { 
    const db = getDb(); 
    const id = c.req.param('id'); 
    const event = await db.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id); 
    if (!event) return json(c, 200, { lineups: [] }); 
    const apiKey = process.env.API_SPORTS_KEY; 
    if (!apiKey || event.sport !== 'soccer') return json(c, 200, { lineups: [] }); 
    const extId = String(event.external_event_id || '').replace(/^soccer_/, ''); 
    if (!extId || isNaN(Number(extId))) return json(c, 200, { lineups: [] }); 
    
    const resp = await fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${extId}`, { 
      headers: { 'x-apisports-key': apiKey } 
    }); 
    if (!resp.ok) return json(c, 200, { lineups: [] }); 
    const data = await resp.json(); 
    return json(c, 200, { lineups: data?.response || [] }); 
  } catch (err) { 
    console.error('[Sports] lineups error:', err.message); 
    return json(c, 200, { lineups: [] }); 
  } 
}); 

// GET /api/events/:id/standings — League standings (from API-Football) 
app.get('/api/events/:id/standings', async (c) => { 
  try { 
    const db = getDb(); 
    const id = c.req.param('id'); 
    const event = await db.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id); 
    if (!event) return json(c, 200, { table: [] }); 
    const apiKey = process.env.API_SPORTS_KEY; 
    if (!apiKey || event.sport !== 'soccer') return json(c, 200, { table: [] }); 
    const extId = String(event.external_event_id || '').replace(/^soccer_/, ''); 
    
    // First fetch the fixture to get the season and league ID
    const fxResp = await fetch(`https://v3.football.api-sports.io/fixtures?id=${extId}`, { headers: { 'x-apisports-key': apiKey } }); 
    const fxData = await fxResp.json(); 
    const fx = fxData?.response?.[0];
    
    if (!fx || !fx.league || !fx.league.id || !fx.league.season) return json(c, 200, { table: [] });

    // Fetch the actual standings
    const stResp = await fetch(`https://v3.football.api-sports.io/standings?league=${fx.league.id}&season=${fx.league.season}`, { headers: { 'x-apisports-key': apiKey } });
    const stData = await stResp.json();
    
    const standings = stData?.response?.[0]?.league?.standings?.[0] || [];
    return json(c, 200, { table: standings });
  } catch (err) { 
    console.error('[Sports] standings error:', err.message); 
    return json(c, 200, { table: [] }); 
  } 
});

app.get('/api/events/media', async (c) => {
  try {
    const url = decodeURIComponent(String(c.req.query('url') || ''));
    if (!url.startsWith('http')) return c.body(null, 400);

    const allowed = ['media.api-sports.io','api-sports.io','media.api-football.com','media.api-basketball.com'];
    const host = new URL(url).hostname;
    if (!allowed.some(d => host.endsWith(d))) return c.body(null, 403);

    const fetchHeaders = { 'User-Agent': 'Bet62/1.0' };
    const apiKey = process.env.API_SPORTS_KEY;
    if (apiKey && host.includes('api-sports.io')) {
      fetchHeaders['x-apisports-key'] = apiKey;
    }
    const upstream = await fetch(url, { headers: fetchHeaders });
    if (!upstream.ok) return c.body(null, upstream.status);

    const ct = upstream.headers.get('content-type') || 'image/png';
    c.header('Content-Type', ct);
    c.header('Cache-Control', 'public, max-age=86400');
    const buf = await upstream.arrayBuffer();
    return c.body(buf);
  } catch {
    return c.body(null, 500);
  }
});

app.get('/api/events/by-sport', async (c) => {
  try {
    const d = getDb();
    const rawSport = c.req.query('sports') || c.req.query('sport') || 'all';
    const sport = normalizeSport(rawSport.split(',')[0]);
    const isAll = sport === 'all';

    const rows = await d.prepare(`
      SELECT * FROM events
      WHERE (
        (is_live = 1 AND datetime(event_date) > datetime('now', '-5 hours'))
        OR datetime(event_date) BETWEEN datetime('now', '-3 hours') AND datetime('now', '+7 days')
      )
      AND COALESCE(status, 'NS') NOT IN ('FT','AET','PEN','AWD','WO','ABD','FIN','FINAL','Finished','Match Finished','Final','Ended','AOT','AP','POST','FT_PEN','NS_CANC')
      AND market_status != 'suspended'
      ${isAll ? '' : "AND sport = ?"}
      ORDER BY
        is_live DESC,
        CASE WHEN sport = 'soccer' THEN 0 ELSE 1 END ASC,
        CASE WHEN league IN (
          'UEFA Champions League','UEFA Europa League','UEFA Europa Conference League',
          'Premier League','La Liga','Bundesliga','Serie A','Ligue 1',
          'Primeira Liga','Liga Portugal','CONMEBOL Libertadores','CONMEBOL Sudamericana',
          'NBA','NHL','NFL','MLB','Copa del Rey','FA Cup','EFL Cup','DFB Pokal','Coppa Italia','Coupe de France',
          'Copa do Brasil','Liga MX','MLS',
          'Brasileirão Série A','Brasileirao Série A','Brasileirão Serie A','Brasileirao Serie A'
        ) THEN 0 ELSE 1 END ASC,
        CASE WHEN CAST(home_odd AS REAL) > 1 THEN 0 ELSE 1 END ASC,
        event_date ASC
      LIMIT 1000
    `).all(...(isAll ? [] : [sport]));

    let filtered = rows.filter(r => {
      if (isBlocked(r.league)) return false;
      const evSport = normalizeSport(r.sport || 'soccer');
      if (evSport === 'soccer') {
        return isLeagueAllowed(r.league, r.country);
      }
      return true;
    });

    const live    = filtered.filter(r => Number(r.is_live) === 1 || LIVE_STATUSES.has(String(r.status || '').toUpperCase()));
    const pregame = filtered.filter(r => Number(r.is_live) !== 1 && !LIVE_STATUSES.has(String(r.status || '').toUpperCase()));

    const parseMarkets = (r) => {
      try { return typeof r.markets === 'string' ? JSON.parse(r.markets) : (r.markets || {}); } catch { return {}; }
    };
    const parseScore = (r) => {
      try { return typeof r.score === 'string' ? JSON.parse(r.score) : (r.score || { home: null, away: null }); } catch { return { home: null, away: null }; }
    };

    const format = (r) => {
      const markets = parseMarkets(r);
      const hO = Number(r.home_odd || 0);
      const dO = Number(r.draw_odd || 0);
      const aO = Number(r.away_odd || 0);

      if (normalizeSport(r.sport || 'soccer') === 'soccer' && !Number(r.is_live) && dO > 1.01) {
        const bttsArr = Array.isArray(markets.btts) ? markets.btts : null;
        const simOdd = bttsArr?.find(x => (x.label||'').toLowerCase().includes('sim') || (x.label||'').toLowerCase().includes('yes'));
        const apiSimOdd = Number(simOdd?.odd || simOdd?.price || 0);
        if (!bttsArr || bttsArr.length === 0 || apiSimOdd <= 0 || apiSimOdd > 2.60) {
          const derived = derivedBtts(hO, dO, aO);
          if (derived) markets.btts = derived;
        }
      }

      return {
        ...r,
        markets,
        score: parseScore(r),
        goals: parseScore(r),
        is_live: Number(r.is_live),
        home_odd: hO,
        draw_odd: dO,
        away_odd: aO,
        elapsed: Number(r.elapsed || 0),
        league_tier: leagueTier(r.league, r.country),
        suspended_markets: Number(r.is_live) === 1 ? buildSuspendedMarkets(r) : {},
      };
    };

    const liveWithOdds    = live.filter(r => Number(r.home_odd) > 0);
    const liveWithoutOdds = live.filter(r => Number(r.home_odd) <= 0);

    const finalLiveRaw = liveWithOdds.length >= 20
      ? liveWithOdds
      : [...liveWithOdds, ...liveWithoutOdds].slice(0, Math.max(liveWithOdds.length * 2, 20));

    const finalLive = finalLiveRaw.slice(0, 100).map(format);

    const soccerPregame = pregame
      .filter(r => normalizeSport(r.sport) === 'soccer')
      .sort((a, b) => {
        const aHasOdds = Number(a.home_odd) > 1 ? 0 : 1;
        const bHasOdds = Number(b.home_odd) > 1 ? 0 : 1;
        if (aHasOdds !== bHasOdds) return aHasOdds - bHasOdds;
        const ta = leagueTier(a.league, a.country);
        const tb = leagueTier(b.league, b.country);
        if (ta !== tb) return ta - tb;
        return new Date(a.event_date).getTime() - new Date(b.event_date).getTime();
      })
      .slice(0, 80);

    const basketballPregame = pregame.filter(r => normalizeSport(r.sport) === 'basketball').slice(0, 10);
    const iceHockeyPregame  = pregame.filter(r => normalizeSport(r.sport) === 'ice-hockey').slice(0, 5);
    const volleyballPregame = pregame.filter(r => normalizeSport(r.sport) === 'volleyball').slice(0, 5);
    const otherSportIds = new Set([
      ...soccerPregame.map(r => r.id),
      ...basketballPregame.map(r => r.id),
      ...iceHockeyPregame.map(r => r.id),
      ...volleyballPregame.map(r => r.id),
    ]);
    const otherPregame = pregame.filter(r => !otherSportIds.has(r.id)).slice(0, 5);

    const finalPregame = [
      ...soccerPregame,
      ...basketballPregame,
      ...iceHockeyPregame,
      ...volleyballPregame,
      ...otherPregame,
    ].map(format);

    return json(c, 200, { live: finalLive, pregame: finalPregame });
  } catch (err) {
    console.error('[Sports] by-sport error:', err);
    return json(c, 500, { error: 'Erro ao obter eventos', live: [], pregame: [] });
  }
});

app.get('/api/events/team-image', async (c) => {
  const team = String(c.req.query('team') || '').trim();
  if (!team) return json(c, 200, { url: null });
  try {
    const url = await resolveTeamImage(team);
    return json(c, 200, { url });
  } catch {
    return json(c, 200, { url: null });
  }
});

app.get('/api/events/:id/stats', async (c) => {
  try {
    const d = getDb();
    const id = c.req.param('id');
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event) return json(c, 200, { statistics: [] });

    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey || event.sport !== 'soccer') return json(c, 200, { statistics: [] });

    const extId = String(event.external_event_id || '').replace(/^soccer_/, '');
    if (!extId || isNaN(Number(extId))) return json(c, 200, { statistics: [] });

    const resp = await fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${extId}`, {
      headers: { 'x-apisports-key': apiKey }
    });
    if (!resp.ok) return json(c, 200, { statistics: [] });
    const data = await resp.json();
    return json(c, 200, { statistics: data?.response || [] });
  } catch (err) {
    console.error('[Sports] stats error:', err.message);
    return json(c, 200, { statistics: [] });
  }
});

app.get('/api/events/:id/odds', async (c) => {
  try {
    const d = getDb();
    const id = c.req.param('id');
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event) return json(c, 404, { error: 'Evento não encontrado' });

    const markets = (() => { try { return typeof event.markets === 'string' ? JSON.parse(event.markets) : (event.markets || {}); } catch { return {}; } })();
    const suspended = Number(event.is_live) === 1 ? buildSuspendedMarkets(event) : {};
    return json(c, 200, { markets, home_odd: event.home_odd, draw_odd: event.draw_odd, away_odd: event.away_odd, suspended_markets: suspended });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter odds' });
  }
});

app.get('/api/events/:id', async (c) => {
  // Handle special cases
  const id = c.req.param('id');
  if (id === 'media') return; // Handled by /media route
  if (id === 'by-sport') return; // Handled by /by-sport route
  if (id === 'team-image') return; // Handled by /team-image route

  try {
    const d = getDb();
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event) return json(c, 404, { error: 'Evento não encontrado' });
    const markets = (() => { try { return typeof event.markets === 'string' ? JSON.parse(event.markets) : (event.markets || {}); } catch { return {}; } })();
    const score = (() => { try { return typeof event.score === 'string' ? JSON.parse(event.score) : (event.score || {}); } catch { return {}; } })();
    const suspended = Number(event.is_live) === 1 ? buildSuspendedMarkets(event) : {};
    return json(c, 200, { ...event, markets, score, goals: score, suspended_markets: suspended });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter evento' });
  }
});

app.get('/api/events/:id/lineups', async (c) => {
  try {
    const d = getDb();
    const id = c.req.param('id');
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event || event.sport !== 'soccer') return json(c, 200, { lineups: [] });

    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) return json(c, 200, { lineups: [] });

    const extId = String(event.external_event_id || '').replace(/^soccer_/, '');
    const resp = await fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${extId}`, {
      headers: { 'x-apisports-key': apiKey }
    });
    const data = await resp.json();
    const lineups = (data?.response || []).map((team) => ({
      ...team,
      startXI: (team.startXI || []).map((entry) => ({
        ...entry,
        player: {
          ...entry.player,
          photo: entry.player?.photo || `https://media.api-sports.io/football/players/${entry.player?.id}.png`,
        },
      })),
      substitutes: (team.substitutes || []).map((entry) => ({
        ...entry,
        player: {
          ...entry.player,
          photo: entry.player?.photo || `https://media.api-sports.io/football/players/${entry.player?.id}.png`,
        },
      })),
    }));
    return json(c, 200, { lineups });
  } catch {
    return json(c, 200, { lineups: [] });
  }
});

app.get('/api/events/:id/standings', async (c) => {
  try {
    const d = getDb();
    const id = c.req.param('id');
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event) return json(c, 200, { table: [] });

    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey || event.sport !== 'soccer') return json(c, 200, { table: [] });

    const extId = String(event.external_event_id || '').replace(/^soccer_/, '');
    const fxResp = await fetch(`https://v3.football.api-sports.io/fixtures?id=${extId}`, { headers: { 'x-apisports-key': apiKey } });
    const fxData = await fxResp.json();
    const fx = fxData?.response?.[0];
    const leagueId = fx?.league?.id;
    const season = fx?.league?.season;
    if (!leagueId || !season) return json(c, 200, { table: [] });

    const stResp = await fetch(`https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`, { headers: { 'x-apisports-key': apiKey } });
    const stData = await stResp.json();
    const standings = stData?.response?.[0]?.league?.standings?.[0] || [];
    return json(c, 200, { table: standings });
  } catch {
    return json(c, 200, { table: [] });
  }
});

app.get('/api/events/:id/insights', async (c) => {
  try {
    const d = getDb();
    const id = c.req.param('id');
    const event = await d.prepare('SELECT * FROM events WHERE external_event_id = ? OR CAST(id AS TEXT) = ? LIMIT 1').get(id, id);
    if (!event || event.sport !== 'soccer') return json(c, 200, {});
    const apiKey = process.env.API_SPORTS_KEY;
    if (!apiKey) return json(c, 200, {});
    const extId = String(event.external_event_id || '').replace(/^soccer_/, '');
    if (!extId || isNaN(Number(extId))) return json(c, 200, {});
    const resp = await fetch(`https://v3.football.api-sports.io/predictions?fixture=${extId}`, {
      headers: { 'x-apisports-key': apiKey }
    });
    const data = await resp.json();
    const pred = data?.response?.[0] || {};
    const league = pred?.league || {};
    const teams = pred?.teams || {};
    const homeTeam = teams?.home || {};
    const awayTeam = teams?.away || {};
    const buildMetrics = (team) => ({
      avg_total_goals: team?.goals?.avg?.total ? parseFloat(team.goals.avg.total) : null,
      over_15_pct: null,
      over_25_pct: null,
      btts_pct: null,
    });
    return json(c, 200, {
      league: {
        avg_goals_per_match: league?.goals ? (parseFloat(league.goals.home) + parseFloat(league.goals.away)) / 2 : null,
        over_15_pct: null,
        over_25_pct: null,
        btts_pct: null,
      },
      home: { metrics: buildMetrics(homeTeam), last: [] },
      away: { metrics: buildMetrics(awayTeam), last: [] },
      h2h: { home_wins: null, draws: null, away_wins: null },
    });
  } catch (err) {
    return json(c, 200, {});
  }
});

app.get('/api/featured-games', (c) => {
  return c.redirect('/api/events/by-sport');
});

app.get('/api/users/profile', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const profile = await d.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(auth.userId);
    const user = await d.prepare('SELECT id, username, role, twofa_enabled FROM users WHERE id = ?').get(auth.userId);
    return json(c, 200, { ...profile, ...user, userId: auth.userId });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter perfil' });
  }
});

app.put('/api/users/profile', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { full_name, first_name, last_name, phone, country } = body;
    await d.prepare(`UPDATE user_profile SET full_name = COALESCE(?, full_name), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), country = COALESCE(?, country), updated_at = datetime('now') WHERE user_id = ?`).run(full_name, first_name, last_name, phone, country, auth.userId);
    const profile = await d.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(auth.userId);
    return json(c, 200, { success: true, profile });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao atualizar perfil' });
  }
});

app.post('/api/users/self-exclude', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { self_exclude, until } = body;
    if (typeof self_exclude !== 'boolean') return json(c, 400, { error: 'Parâmetro inválido' });

    if (!self_exclude) {
      const current = await d.prepare('SELECT self_exclude, self_exclude_until FROM user_profile WHERE user_id = ?').get(auth.userId);
      if (current?.self_exclude) {
        const u = current.self_exclude_until ? new Date(current.self_exclude_until) : null;
        if (!u || u > new Date()) {
          return json(c, 403, { error: 'Autoexclusão ativa e irreversível durante o período definido.', until: u?.toISOString() || 'PERMANENT' });
        }
      }
    }

    await d.prepare('UPDATE user_profile SET self_exclude = ?, self_exclude_until = ? WHERE user_id = ?').run(self_exclude ? 1 : 0, self_exclude && until ? until : null, auth.userId);
    return json(c, 200, { success: true, self_exclude, until });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao atualizar autoexclusão' });
  }
});

app.get('/api/users/self-exclude/history', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  return json(c, 200, { history: [] });
});

app.get('/api/users/documents', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const docs = await d.prepare('SELECT id, type, filename, mime_type, status, created_at FROM kyc_documents WHERE user_id = ?').all(auth.userId);
    return json(c, 200, docs);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter documentos' });
  }
});

app.post('/api/users/documents', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { type, filename, content, mime_type } = body;
    if (!type) return json(c, 400, { error: 'Tipo de documento obrigatório' });

    let kyc = await d.prepare('SELECT id FROM kyc_profiles WHERE user_id = ?').get(auth.userId);
    if (!kyc) {
      const kycId = randomUUID();
      await d.prepare("INSERT INTO kyc_profiles (id, user_id, status) VALUES (?, ?, 'pending')").run(kycId, auth.userId);
      kyc = { id: kycId };
    }

    const docId = randomUUID();
    await d.prepare('INSERT INTO kyc_documents (id, user_id, kyc_profile_id, type, filename, mime_type, content, status, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(docId, auth.userId, kyc.id, type, filename || null, mime_type || null, content || null, 'uploaded', null);

    return json(c, 200, { success: true, id: docId });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao enviar documento' });
  }
});

app.get('/api/users/iban', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const iban = await d.prepare('SELECT * FROM user_iban WHERE user_id = ?').get(auth.userId);
    return json(c, 200, iban || null);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter IBAN' });
  }
});

app.post('/api/users/iban', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { iban, holder_name } = body;
    if (!iban) return json(c, 400, { error: 'IBAN obrigatório' });
    await d.prepare('INSERT INTO user_iban (user_id, iban, holder_name) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET iban = excluded.iban, holder_name = excluded.holder_name').run(auth.userId, iban, holder_name || null);
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao guardar IBAN' });
  }
});

app.get('/api/users/is-operator', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const profile = await d.prepare('SELECT is_operator FROM user_profile WHERE user_id = ?').get(auth.userId);
    const user = await d.prepare('SELECT role FROM users WHERE id = ?').get(auth.userId);
    const isOp = profile?.is_operator === 1 || user?.role === 'admin' || auth.role === 'admin';
    return json(c, 200, { isOperator: isOp });
  } catch {
    return json(c, 200, { isOperator: false });
  }
});

app.post('/api/users/heartbeat', async (c) => {
  if (!requireAuth(c)) return json(c, 401, { error: 'Não autenticado' });
  return json(c, 200, { ok: true });
});

app.get('/api/users/heartbeat', async (c) => {
  if (!requireAuth(c)) return json(c, 401, { error: 'Não autenticado' });
  return json(c, 200, { ok: true });
});

app.get('/api/admin/users', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const users = await d.prepare(`
      SELECT u.id, u.username, u.role, u.created_at,
             up.email, up.first_name, up.last_name, up.country, up.kyc_status,
             up.is_operator, up.sharp_score, up.roi, up.bets_count, up.wins_count,
             up.self_exclude, kp.status as kyc_profile_status, kp.risk_level
      FROM users u
      LEFT JOIN user_profile up ON u.id = up.user_id
      LEFT JOIN kyc_profiles kp ON u.id = kp.user_id
      ORDER BY u.created_at DESC
      LIMIT 500
    `).all();
    return json(c, 200, users);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter utilizadores' });
  }
});

app.get('/api/admin/users/:userId/balance', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const balance = await ledgerService.getBalance(c.req.param('userId'));
    return json(c, 200, { balance, currency: 'EUR' });
  } catch {
    return json(c, 200, { balance: 0 });
  }
});

app.post('/api/admin/users/:userId/credit', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const { amount, description } = body;
    if (!amount || amount <= 0) return json(c, 400, { error: 'Montante inválido' });
    const ref = `ADMIN:credit:${randomUUID()}`;
    ledgerService.credit(c.req.param('userId'), amount, ref, description || 'Crédito manual admin');
    return json(c, 200, { success: true, balance: ledgerService.getBalance(c.req.param('userId')) });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

app.post('/api/admin/users/:userId/toggle-operator', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { is_operator } = body;
    await d.prepare("UPDATE user_profile SET is_operator = ? WHERE user_id = ?").run(is_operator ? 1 : 0, c.req.param('userId'));
    await d.prepare("UPDATE users SET role = ? WHERE id = ?").run(is_operator ? 'admin' : 'user', c.req.param('userId'));
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao atualizar operador' });
  }
});

app.get('/api/admin/kyc/pending', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const pending = await d.prepare(`
      SELECT kp.id as kyc_id, kp.user_id, kp.status, kp.risk_level, kp.created_at,
             u.username, up.email, up.full_name, up.country, up.created_at as registration_date
      FROM kyc_profiles kp
      JOIN users u ON kp.user_id = u.id
      LEFT JOIN user_profile up ON kp.user_id = up.user_id
      WHERE kp.status IN ('pending', 'under_review')
      ORDER BY kp.created_at ASC
    `).all();
    return json(c, 200, pending);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter KYC pendente' });
  }
});

app.post('/api/admin/kyc/decision', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { kycId, decision, notes } = body;
    if (!kycId || !['approved', 'rejected'].includes(decision)) return json(c, 400, { error: 'Parâmetros inválidos' });

    const newStatus = decision === 'approved' ? 'verified' : 'rejected';
    await d.prepare("UPDATE kyc_profiles SET status = ?, updated_at = datetime('now'), verified_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE id = ?").run(newStatus, decision, kycId);

    const kyc = await d.prepare('SELECT user_id FROM kyc_profiles WHERE id = ?').get(kycId);
    if (kyc) {
      await d.prepare("UPDATE user_profile SET kyc_status = ? WHERE user_id = ?").run(newStatus, kyc.user_id);
    }
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao processar decisão KYC' });
  }
});

app.get('/api/admin/withdrawals', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const status = c.req.query('status') || 'pending';
    const withdrawals = await d.prepare(`
      SELECT w.*, u.username, up.email, up.full_name
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN user_profile up ON w.user_id = up.user_id
      WHERE w.status = ?
      ORDER BY w.created_at ASC
      LIMIT 200
    `).all(status);
    return json(c, 200, withdrawals);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter levantamentos' });
  }
});

app.post('/api/admin/withdrawals/:id/approve', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const w = await d.prepare('SELECT * FROM withdrawals WHERE id = ?').get(c.req.param('id'));
    if (!w) return json(c, 404, { error: 'Levantamento não encontrado' });
    if (w.status !== 'pending') return json(c, 400, { error: 'Levantamento não está pendente' });

    await d.prepare("UPDATE withdrawals SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(w.id);
    await ledgerService.release(w.user_id, 0.0001, `WITHDRAW:RELEASE:${w.id}`, 'Release placeholder');
    await ledgerService.debit(w.user_id, w.amount, `WITHDRAW:PAID:${w.id}`, `Levantamento aprovado #${w.id}`);
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

app.post('/api/admin/withdrawals/:id/reject', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const w = await d.prepare('SELECT * FROM withdrawals WHERE id = ?').get(c.req.param('id'));
    if (!w) return json(c, 404, { error: 'Levantamento não encontrado' });

    await d.prepare("UPDATE withdrawals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(w.id);
    try { await ledgerService.release(w.user_id, w.amount, `WITHDRAW:REJECT:${w.id}`, 'Levantamento rejeitado'); } catch { /* empty */ }
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao rejeitar levantamento' });
  }
});

app.get('/api/admin/bets', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const status = c.req.query('status');
    const bets = await d.prepare(`
      SELECT b.*, u.username, up.email
      FROM bets b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN user_profile up ON b.user_id = up.user_id
      ${status ? 'WHERE b.status = ?' : ''}
      ORDER BY b.created_at DESC
      LIMIT 500
    `).all(...(status ? [status] : []));
    return json(c, 200, bets);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter apostas' });
  }
});

app.post('/api/admin/bets/:id/settle', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { result } = body;
    if (!['won', 'lost', 'void'].includes(result)) return json(c, 400, { error: 'Resultado inválido' });

    const bet = await d.prepare('SELECT * FROM bets WHERE id = ?').get(c.req.param('id'));
    if (!bet) return json(c, 404, { error: 'Aposta não encontrada' });
    if (bet.status !== 'pending') return json(c, 400, { error: 'Aposta não está pendente' });

    await d.prepare("UPDATE bets SET status = ?, result = ?, updated_at = datetime('now') WHERE id = ?").run(result, result, bet.id);

    if (result === 'won') {
      await ledgerService.credit(bet.user_id, bet.potential_win, `BET:WIN:${bet.id}`, `Vitória aposta #${bet.id}`);
    } else if (result === 'void') {
      await ledgerService.credit(bet.user_id, bet.stake, `BET:VOID:${bet.id}`, `Aposta anulada #${bet.id}`);
    }
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 400, { error: err.message });
  }
});

app.post('/api/admin/force-sync', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  // Ignorado/mocked pois não temos cron server a correr dentro do processo
  return json(c, 200, { status: 'sync mock started' });
});

app.get('/api/admin/stats', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const totalUsers = (await d.prepare('SELECT COUNT(*) as n FROM users').get())?.n || 0;
    const totalBets = await d.prepare('SELECT COUNT(*) as n, SUM(stake) as volume FROM bets WHERE status != "void"').get();
    const totalEvents = (await d.prepare('SELECT COUNT(*) as n FROM events WHERE is_live = 1').get())?.n || 0;
    const pendingKYC = (await d.prepare("SELECT COUNT(*) as n FROM kyc_profiles WHERE status = 'pending'").get())?.n || 0;
    const pendingWithdrawals = await d.prepare("SELECT COUNT(*) as n, SUM(amount) as total FROM withdrawals WHERE status = 'pending'").get();
    return json(c, 200, {
      totalUsers,
      totalBets: totalBets?.n || 0,
      bettingVolume: totalBets?.volume || 0,
      liveEvents: totalEvents,
      pendingKYC,
      pendingWithdrawals: pendingWithdrawals?.n || 0,
      pendingWithdrawalsAmount: pendingWithdrawals?.total || 0,
    });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter estatísticas' });
  }
});

app.get('/api/admin/events', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const d = getDb();
    const sport = c.req.query('sport');
    const events = await d.prepare(`SELECT * FROM events ${sport ? 'WHERE sport = ?' : ''} ORDER BY is_live DESC, event_date ASC LIMIT 200`).all(...(sport ? [sport] : []));
    return json(c, 200, events);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter eventos' });
  }
});

app.post('/api/admin/odds/:id', async (c) => {
  if (!isAdmin(c)) return json(c, 403, { error: 'Acesso negado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { home_odd, draw_odd, away_odd, markets } = body;
    const updates = [];
    const values = [];
    if (home_odd !== undefined) { updates.push('home_odd = ?'); values.push(home_odd); }
    if (draw_odd !== undefined) { updates.push('draw_odd = ?'); values.push(draw_odd); }
    if (away_odd !== undefined) { updates.push('away_odd = ?'); values.push(away_odd); }
    if (markets !== undefined) { updates.push('markets = ?'); values.push(JSON.stringify(markets)); }
    if (!updates.length) return json(c, 400, { error: 'Nada para atualizar' });
    updates.push("updated_at = datetime('now')");
    values.push(c.req.param('id'), c.req.param('id'));
    await d.prepare(`UPDATE events SET ${updates.join(', ')} WHERE external_event_id = ? OR CAST(id AS TEXT) = ?`).run(...values);
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao atualizar odds' });
  }
});

app.get('/api/transactions', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
    const txs = await d.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(auth.userId, limit);
    return json(c, 200, txs);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter transações' });
  }
});

app.post('/api/transactions', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const d = getDb();
    const { type, amount, status, payment_method, account_details, description } = body;
    if (!type || !amount) return json(c, 400, { error: 'Parâmetros obrigatórios em falta' });
    const ref = randomUUID();
    const row = await d.prepare(`INSERT INTO transactions (user_id, type, amount, status, payment_method, description, account_details, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(auth.userId, type, amount, status || 'pending', payment_method || null, description || null, account_details ? JSON.stringify(account_details) : null, ref);
    return json(c, 200, { success: true, id: row?.id, reference: ref });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao criar transação' });
  }
});

app.get('/api/favorites', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const favs = await d.prepare(`
      SELECT f.*, e.home_team, e.away_team, e.league, e.sport, e.event_date, e.is_live, e.home_odd, e.draw_odd, e.away_odd
      FROM user_favorites f
      LEFT JOIN events e ON f.event_id = e.id OR CAST(f.event_id AS TEXT) = e.external_event_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `).all(auth.userId);
    return json(c, 200, favs);
  } catch (err) {
    return json(c, 500, { error: 'Erro ao obter favoritos' });
  }
});

app.post('/api/favorites', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const body = await c.req.json().catch(() => ({}));
    const { eventId } = body;
    if (!eventId) return json(c, 400, { error: 'eventId obrigatório' });
    const d = getDb();
    try { await d.prepare('INSERT INTO user_favorites (user_id, event_id) VALUES (?, ?) ON CONFLICT (user_id, event_id) DO NOTHING').run(auth.userId, eventId); } catch { /* already fav */ }
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao adicionar favorito' });
  }
});

app.delete('/api/favorites/:eventId', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    await d.prepare('DELETE FROM user_favorites WHERE user_id = ? AND (event_id = ? OR CAST(event_id AS TEXT) = ?)').run(auth.userId, c.req.param('eventId'), c.req.param('eventId'));
    return json(c, 200, { success: true });
  } catch (err) {
    return json(c, 500, { error: 'Erro ao remover favorito' });
  }
});

app.get('/api/promotions', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const promos = await d.prepare("SELECT * FROM promotions WHERE (user_id = ? OR user_id IS NULL) AND used = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))").all(auth.userId);
    return json(c, 200, promos);
  } catch {
    return json(c, 200, []);
  }
});

app.get('/api/promotions/freebets', async (c) => {
  const auth = requireAuth(c);
  if (!auth) return json(c, 401, { error: 'Não autenticado' });
  try {
    const d = getDb();
    const freebets = await d.prepare("SELECT * FROM promotions WHERE (user_id = ? OR user_id IS NULL) AND type = 'freebet' AND used = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))").all(auth.userId);
    return json(c, 200, freebets);
  } catch {
    return json(c, 200, []);
  }
});

app.get('/api/debug/env', async (c) => {
  const hasJwt = Boolean(String(process.env.JWT_SECRET || '').trim());
  const hasAdmin = Boolean(String(process.env.ADMIN_TOKEN || '').trim());
  const hasCron = Boolean(String(process.env.CRON_SECRET || '').trim());
  const hasCors = Boolean(String(process.env.CORS_ORIGINS || '').trim());
  return json(c, 200, { has_jwt_secret: hasJwt, has_admin_token: hasAdmin, has_cron_secret: hasCron, has_cors_origins: hasCors, date: todayIso() });
});

import { runSportsSync, runLiveOddsRefresh } from './jobs/sportsSync.js';

function cleanupRefreshTokens() {
  const db = getDb();
  return db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1").run();
}

app.get('/api/cron/sports-sync', async (c) => {
  if (!requireCron(c)) return json(c, 401, { error: 'Unauthorized' });
  try {
    await runSportsSync(false);
    return json(c, 200, { ok: true });
  } catch (err) {
    return json(c, 500, { ok: false, error: err?.message || String(err) });
  }
});

app.get('/api/cron/sports-sync-full', async (c) => {
  if (!requireCron(c)) return json(c, 401, { error: 'Unauthorized' });
  try {
    await runSportsSync(true);
    return json(c, 200, { ok: true });
  } catch (err) {
    return json(c, 500, { ok: false, error: err?.message || String(err) });
  }
});

app.get('/api/cron/live-refresh', async (c) => {
  if (!requireCron(c)) return json(c, 401, { error: 'Unauthorized' });
  try {
    await runLiveOddsRefresh();
    return json(c, 200, { ok: true });
  } catch (err) {
    return json(c, 500, { ok: false, error: err?.message || String(err) });
  }
});

app.get('/api/cron/refresh-token-cleanup', async (c) => {
  if (!requireCron(c)) return json(c, 401, { error: 'Unauthorized' });
  try {
    await cleanupRefreshTokens();
    return json(c, 200, { ok: true });
  } catch (err) {
    return json(c, 500, { ok: false, error: err?.message || String(err) });
  }
});

let _liveRefreshScheduled = false;
function scheduleLiveRefresh() {
  if (_liveRefreshScheduled) return;
  _liveRefreshScheduled = true;
  const run = async () => {
    try {
      await runLiveOddsRefresh();
    } catch (err) {
      console.error('[LiveRefresh] error:', err?.message || err);
    }
    setTimeout(run, 60000);
  };
  setTimeout(run, 90000);
}

export default app;

// ── Seed admin user on startup (idempotent) ─────────────────────────────── 
(async () => { 
  try { 
    const db = getDb(); 
    const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get(); 
    if (!existing) { 
      const seedPassword = String(process.env.ADMIN_SEED_PASSWORD || '').trim();
      if (!seedPassword) {
        console.log('[Server] Admin seed skipped (ADMIN_SEED_PASSWORD not set)');
        return;
      }
      const id = randomUUID(); 
      const hash = await hashPassword(seedPassword); 
      db.prepare("INSERT INTO users (id, username, role) VALUES (?, 'admin', 'admin')").run(id); 
      db.prepare("INSERT INTO user_credentials (id, user_id, hashed_password) VALUES (?, ?, ?)").run(randomUUID(), id, hash); 
      db.prepare("INSERT INTO user_profile (user_id, email, first_name, last_name, full_name, is_operator) VALUES (?, 'admin@bet62.pt', 'Admin', 'Bet62', 'Admin Bet62', 1)").run(id); 
      db.prepare("INSERT INTO wallets (user_id, currency) VALUES (?, 'EUR')").run(id); 
      console.log('[Server] Admin user created: username=admin'); 
    } else { 
      db.prepare("UPDATE users SET role='admin' WHERE username='admin'").run(); 
      db.prepare("UPDATE user_profile SET is_operator=1 WHERE user_id=?").run(existing.id); 
    } 
    // Normalize existing Brazilian league names in DB (one-time migration) 
    db.prepare("UPDATE events SET league='Brasileirão Série A' WHERE sport='soccer' AND country='Brazil' AND (LOWER(league)='série a' OR LOWER(league)='serie a')").run(); 
    db.prepare("UPDATE events SET league='Brasileirão Série B' WHERE sport='soccer' AND country='Brazil' AND (LOWER(league)='série b' OR LOWER(league)='serie b')").run(); 
  } catch (e) { 
    console.error('[Server] Admin seed error:', e.message); 
  } 
})();

if (process.env.RUN_HTTP !== 'false' && !process.env.VERCEL) {
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Server is running on port ${info.port}`);
    
    // Iniciar jobs de sincronização de esportes
    setInterval(() => {
      runSportsSync().catch(err => console.error('[SportsSync Error]', err));
    }, 5 * 60 * 1000); // A cada 5 minutos

    // Rodar uma sincronização completa inicial 2 segundos após a inicialização do servidor
    setTimeout(() => {
      console.log('[SportsSync] Iniciando sincronização completa inicial...');
      runSportsSync(true).catch(err => console.error('[Initial SportsSync Error]', err));
    }, 10000);

    setInterval(async () => {
      try {
        await cleanupRefreshTokens();
        console.log('[Cron] Refresh token cleanup done');
      } catch (err) {
        console.error('[Cron] Refresh token cleanup error:', err?.message || err);
      }
    }, 24 * 60 * 60 * 1000);

    scheduleLiveRefresh();
  });
}
