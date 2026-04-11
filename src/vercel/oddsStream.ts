function toNumber(v: any): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickFixtureId(eventId: string): number {
  const s = String(eventId || '').trim();
  if (!s) return 0;
  const m = s.match(/_(\d+)$/);
  if (m?.[1]) return Number(m[1]) || 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pickOddsIoEventId(eventId: string): string {
  const s = String(eventId || '').trim();
  if (!s) return '';
  const idx = s.toLowerCase().lastIndexOf('oddsio_');
  if (idx < 0) return '';
  return s.slice(idx + 'oddsio_'.length).trim();
}

function normalizeMarketKey(name: string): 'h2h' | 'other' {
  const s = String(name || '').toLowerCase();
  if (s.includes('match winner') || s.includes('full time result') || s.includes('1x2') || s.includes('home/away')) return 'h2h';
  return 'other';
}

function normalizeH2HLabel(label: string): 'home' | 'draw' | 'away' | 'other' {
  const s = String(label || '').toLowerCase().trim();
  if (s === 'home' || s === '1' || s === 'casa') return 'home';
  if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
  if (s === 'away' || s === '2' || s === 'fora') return 'away';
  return 'other';
}

async function fetchApiSportsOdds(fixtureId: number, apiKey: string): Promise<any | null> {
  const qp = new URLSearchParams();
  qp.set('fixture', String(fixtureId));
  const url = `https://v3.football.api-sports.io/odds?${qp.toString()}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': String(apiKey) },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  return await res.json();
}

function extractH2HFromApiSports(payload: any): { home: number; draw: number; away: number; markets: Record<string, any[]> } {
  const response = Array.isArray(payload?.response) ? payload.response : [];
  const best = new Map<'home' | 'draw' | 'away', number>();

  for (const item of response) {
    const bookmakers = Array.isArray(item?.bookmakers) ? item.bookmakers : [];
    for (const bm of bookmakers) {
      const bets = Array.isArray(bm?.bets) ? bm.bets : [];
      for (const bet of bets) {
        if (normalizeMarketKey(bet?.name || bet?.id) !== 'h2h') continue;
        const values = Array.isArray(bet?.values) ? bet.values : [];
        for (const v of values) {
          const lbl = normalizeH2HLabel(v?.value ?? v?.label ?? v?.name ?? '');
          if (lbl === 'other') continue;
          const odd = toNumber(v?.odd ?? v?.price ?? 0);
          if (!(odd > 1)) continue;
          const prev = best.get(lbl);
          if (!prev || odd > prev) best.set(lbl, odd);
        }
      }
    }
  }

  const home = best.get('home') || 0;
  const draw = best.get('draw') || 0;
  const away = best.get('away') || 0;
  const h2h: any[] = [];
  if (home > 1) h2h.push({ name: 'Casa', label: 'Casa', odd: home, price: home });
  if (draw > 1) h2h.push({ name: 'Empate', label: 'Empate', odd: draw, price: draw });
  if (away > 1) h2h.push({ name: 'Fora', label: 'Fora', odd: away, price: away });
  const markets: Record<string, any[]> = {};
  if (h2h.length >= 2) markets.h2h = h2h;
  return { home, draw, away, markets };
}

async function fetchOddsApiIoOdds(eventId: string, apiKey: string, bookmakersCsv: string): Promise<any | null> {
  const books = String(bookmakersCsv || '').trim();
  const q = new URLSearchParams();
  q.set('apiKey', String(apiKey));
  q.set('eventId', String(eventId));
  if (books) q.set('bookmakers', books);
  const url = `https://api.odds-api.io/v3/odds?${q.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  return await res.json();
}

function extractH2HFromOddsApiIo(payload: any): { home: number; draw: number; away: number; markets: Record<string, any[]> } {
  const best = new Map<'home' | 'draw' | 'away', number>();

  const parseMlEntry = (o: any) => {
    const home = toNumber(o?.home ?? o?.Home ?? o?.['1'] ?? o?.one ?? 0);
    const draw = toNumber(o?.draw ?? o?.Draw ?? o?.['X'] ?? o?.x ?? 0);
    const away = toNumber(o?.away ?? o?.Away ?? o?.['2'] ?? o?.two ?? 0);
    return { home, draw, away };
  };

  const scanMarketObj = (m: any) => {
    const name = String(m?.name || m?.key || m?.type || '').toLowerCase();
    if (!(name.includes('ml') || name.includes('moneyline') || name.includes('1x2') || name.includes('h2h') || name.includes('match'))) return;
    if (Array.isArray(m?.odds) && m.odds.length > 0) {
      const o = parseMlEntry(m.odds[0]);
      if (o.home > 1) best.set('home', Math.max(best.get('home') || 0, o.home));
      if (o.draw > 1) best.set('draw', Math.max(best.get('draw') || 0, o.draw));
      if (o.away > 1) best.set('away', Math.max(best.get('away') || 0, o.away));
    }
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : Array.isArray(m?.selections) ? m.selections : null;
    if (outcomes) {
      for (const v of outcomes) {
        const lbl = normalizeH2HLabel(v?.label ?? v?.name ?? v?.value ?? '');
        if (lbl === 'other') continue;
        const odd = toNumber(v?.odd ?? v?.price ?? 0);
        if (!(odd > 1)) continue;
        best.set(lbl, Math.max(best.get(lbl) || 0, odd));
      }
    }
  };

  if (payload && typeof payload === 'object') {
    if (payload.bookmakers && typeof payload.bookmakers === 'object') {
      for (const v of Object.values(payload.bookmakers)) {
        if (!Array.isArray(v)) continue;
        for (const m of v as any[]) scanMarketObj(m);
      }
    }
    if (Array.isArray(payload.markets)) {
      for (const m of payload.markets) scanMarketObj(m);
    }
  }

  const home = best.get('home') || 0;
  const draw = best.get('draw') || 0;
  const away = best.get('away') || 0;
  const h2h: any[] = [];
  if (home > 1) h2h.push({ name: 'Casa', label: 'Casa', odd: home, price: home });
  if (draw > 1) h2h.push({ name: 'Empate', label: 'Empate', odd: draw, price: draw });
  if (away > 1) h2h.push({ name: 'Fora', label: 'Fora', odd: away, price: away });
  const markets: Record<string, any[]> = {};
  if (h2h.length >= 2) markets.h2h = h2h;
  return { home, draw, away, markets };
}

export async function oddsStreamHandler(req: any, res: any) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const id = String(url.searchParams.get('id') || '').trim();
  const fixtureId = pickFixtureId(id);
  const oddsIoId = pickOddsIoEventId(id);
  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  const oddsKey = String(process.env.ODDS_API_KEY || '').trim();
  const bookmakersCsv = String(process.env.ODDS_API_BOOKMAKERS || '').trim();

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { res.flushHeaders?.(); } catch { void 0; }

  const send = (obj: any) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { void 0; }
  };

  if (!id || (!(fixtureId > 0) && !oddsIoId)) {
    send({ type: 'error', error: 'missing_id', ts: Date.now() });
    res.end();
    return;
  }
  if (!(oddsIoId && oddsKey) && !apiKey) {
    send({ type: 'error', error: 'missing_api_key', ts: Date.now() });
    res.end();
    return;
  }

  let closed = false;
  req.on('close', () => { closed = true; });
  req.on('aborted', () => { closed = true; });

  send({ type: 'hello', id, ts: Date.now() });

  let lastHash = '';
  const startedAt = Date.now();
  const maxMs = 25_000;

  while (!closed && Date.now() - startedAt < maxMs) {
    try {
      if (oddsIoId && oddsKey) {
        const raw = await fetchOddsApiIoOdds(oddsIoId, oddsKey, bookmakersCsv);
        if (raw) {
          const out = extractH2HFromOddsApiIo(raw);
          const hash = JSON.stringify([out.home, out.draw, out.away]);
          if (hash !== lastHash) {
            lastHash = hash;
            send({
              type: 'odds',
              id,
              home_odd: out.home,
              draw_odd: out.draw,
              away_odd: out.away,
              markets: out.markets,
              provider: 'odds-api.io',
              updated_at: new Date().toISOString(),
              ts: Date.now(),
            });
          } else {
            send({ type: 'ping', ts: Date.now() });
          }
        } else {
          send({ type: 'ping', ts: Date.now() });
        }
      } else {
        const raw = await fetchApiSportsOdds(fixtureId, apiKey);
        if (raw) {
          const out = extractH2HFromApiSports(raw);
          const hash = JSON.stringify([out.home, out.draw, out.away]);
          if (hash !== lastHash) {
            lastHash = hash;
            send({
              type: 'odds',
              id,
              home_odd: out.home,
              draw_odd: out.draw,
              away_odd: out.away,
              markets: out.markets,
              provider: 'api-sports',
              updated_at: new Date().toISOString(),
              ts: Date.now(),
            });
          } else {
            send({ type: 'ping', ts: Date.now() });
          }
        } else {
          send({ type: 'ping', ts: Date.now() });
        }
      }
    } catch {
      send({ type: 'ping', ts: Date.now() });
    }

    await new Promise((r) => setTimeout(r, 1200));
  }

  send({ type: 'bye', ts: Date.now() });
  res.end();
}

