function toNumber(v: any): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractOddsFromBets(bets: any[]): { home: number; draw: number; away: number } {
  const result = { home: 0, draw: 0, away: 0 };
  if (!Array.isArray(bets)) return result;

  for (const bet of bets) {
    const name: string = String(bet?.name || '');
    const values: any[] = bet?.values || bet?.odds || [];
    const n = name.toLowerCase();
    const isMatchWinner =
      name === 'Match Winner' ||
      name === 'Home/Away' ||
      name === '1X2' ||
      name === '1x2' ||
      name === 'Match Result' ||
      name === 'Result' ||
      name === 'Fulltime Result' ||
      name === 'Full Time Result' ||
      (n.includes('winner') && !n.includes('set') && !n.includes('period') && !n.includes('quarter') && !n.includes('half'));

    if (!isMatchWinner) continue;

    for (const v of values) {
      const val = String(v?.value || v?.outcome || '').toLowerCase();
      const odd = toNumber(v?.odd ?? v?.price ?? 0);
      if (odd <= 1) continue;

      if (val === 'home' || val === 'home win' || val === 'local' || val === '1') result.home = result.home || odd;
      else if (val === 'draw' || val === 'x' || val === 'tie') result.draw = result.draw || odd;
      else if (val === 'away' || val === 'away win' || val === 'visitor' || val === 'visitors' || val === '2') result.away = result.away || odd;
    }
  }

  return result;
}

async function apiGet(url: string, apiKey: string, timeoutMs: number) {
  const res = await fetch(url, {
    headers: { 'x-apisports-key': String(apiKey) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchSoccerLiveFixtures(apiKey: string): Promise<any[]> {
  const data = await apiGet('https://v3.football.api-sports.io/fixtures?live=all', apiKey, 10_000);
  return Array.isArray(data?.response) ? data.response : [];
}

async function fetchSoccerLiveOdds(apiKey: string): Promise<Map<string, { home: number; draw: number; away: number }>> {
  const map = new Map<string, { home: number; draw: number; away: number }>();
  const data = await apiGet('https://v3.football.api-sports.io/odds/live', apiKey, 10_000);
  const resp = Array.isArray(data?.response) ? data.response : [];
  for (const entry of resp) {
    const id = String(entry?.fixture?.id || '');
    if (!id) continue;
    const oddsArr: any[] = Array.isArray(entry?.odds) ? entry.odds : [];
    const parsed = extractOddsFromBets(oddsArr);
    if (parsed.home > 0) map.set(id, parsed);
  }
  return map;
}

export async function liveStreamHandler(req: any, res: any) {
  const url = new URL(String(req.url || ''), 'http://localhost');
  const sportsParam = String(url.searchParams.get('sports') || 'all').toLowerCase().trim();
  const wantSoccer = sportsParam === 'all' || sportsParam === 'soccer' || sportsParam === 'futebol' || sportsParam === 'football';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try { res.flushHeaders?.(); } catch { void 0; }

  const send = (obj: any) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { void 0; }
  };

  const apiKey = String(process.env.API_SPORTS_KEY || '').trim();
  if (!apiKey) {
    send({ type: 'error', error: 'missing_api_sports_key', ts: Date.now() });
    res.end();
    return;
  }

  if (!wantSoccer) {
    send({ type: 'error', error: 'sport_not_supported', ts: Date.now() });
    res.end();
    return;
  }

  let closed = false;
  req.on('close', () => { closed = true; });
  req.on('aborted', () => { closed = true; });

  send({ type: 'hello', sports: sportsParam, ts: Date.now() });

  let lastHash = '';
  const startedAt = Date.now();
  const maxMs = 25_000;

  while (!closed && Date.now() - startedAt < maxMs) {
    try {
      const [fixtures, oddsMap] = await Promise.all([
        fetchSoccerLiveFixtures(apiKey),
        fetchSoccerLiveOdds(apiKey).catch(() => new Map()),
      ]);

      const updates: any[] = [];
      for (const f of fixtures) {
        const fid = String(f?.fixture?.id || '');
        if (!fid) continue;
        const id = `soccer_${fid}`;
        const goalsHome = toNumber(f?.goals?.home ?? f?.score?.fulltime?.home ?? 0);
        const goalsAway = toNumber(f?.goals?.away ?? f?.score?.fulltime?.away ?? 0);
        const statusShort = String(f?.fixture?.status?.short || f?.fixture?.status || 'LIVE').trim();
        const elapsed = toNumber(f?.fixture?.status?.elapsed ?? f?.elapsed ?? 0);
        const odds = oddsMap.get(fid);

        updates.push({
          id,
          external_event_id: id,
          is_live: 1,
          status: { short: statusShort, long: statusShort, elapsed },
          elapsed,
          goals: { home: goalsHome, away: goalsAway },
          score: { home: goalsHome, away: goalsAway },
          home_odd: odds ? odds.home : 0,
          draw_odd: odds ? odds.draw : 0,
          away_odd: odds ? odds.away : 0,
          updated_at: new Date().toISOString(),
        });
      }

      const hash = JSON.stringify(updates.map((u) => [u.id, u.goals?.home, u.goals?.away, u.elapsed, u.home_odd, u.draw_odd, u.away_odd]).slice(0, 120));
      if (hash !== lastHash) {
        lastHash = hash;
        send({ type: 'live', updates, ts: Date.now() });
      } else {
        send({ type: 'ping', ts: Date.now() });
      }
    } catch {
      send({ type: 'ping', ts: Date.now() });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  send({ type: 'bye', ts: Date.now() });
  res.end();
}

