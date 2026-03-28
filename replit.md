# BET62 - Apostas Esportivas

A Portuguese-language sports betting platform (BET62) built with React + Vite on the frontend and Cloudflare Workers on the backend.

## Architecture

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, React Router, TanStack Query, Zustand, Framer Motion
- **Backend**: Cloudflare Workers (Hono framework) with D1 SQLite database
- **Auth**: Lucia Auth with SQLite adapter
- **Payments**: Stripe and PayPal integrations

## Project Structure

- `src/react-app/` — Main React application (entry point: `src/react-app/main.tsx`)
- `src/worker/` — Cloudflare Worker backend (API, auth, betting engine)
- `index.html` — Root HTML entry (uses `src/react-app/main.tsx`)
- `migrations/` — D1 database migration SQL files
- `vite.config.ts` — Vite configuration (port 5000, all hosts allowed)
- `wrangler.toml` — Cloudflare Workers configuration

## Development Setup

Two workflows must run simultaneously:

1. **Start worker** (`npm run worker`) — Odds enrichment proxy on port 8080. Forwards all requests to the deployed CF Worker and enriches `/api/events/by-sport?include=odds` responses with real odds from odds-api.io using Replit's `ODDS_API_KEY` secret. Implements stale-while-revalidate caching to handle intermittent CF Worker 1102 errors.

2. **Start application** (`npm run dev`) — Vite dev server on port 5000 with all API traffic proxied through the local odds proxy at `http://127.0.0.1:8080`.

The proxy pipeline: Browser → Vite (5000) → odds-proxy (8080) → CF Worker (remote) + odds-api.io enrichment.

## Running the App

```bash
npm run worker      # Start odds enrichment proxy (port 8080) — required first
npm run dev         # Start frontend dev server (port 5000)
npm run build       # Build for production
npm run deploy:prod # Deploy CF Worker to production (requires CF auth)
```

## odds-api.io Integration

The `scripts/odds-proxy.mjs` proxy implements the odds-api.io enrichment:

### League Filtering (Backend)
- **Women's leagues** blocked: women, woman, feminino, damen, toppserien, etc.
- **Youth leagues** blocked: U16–U23, under-16–23, youth, junior, juvenil, etc.
- **Amateur leagues** blocked: amateur, amateure, amador, amatör
- **3rd division+** blocked: regionalliga, kakkonen, gamma ethniki, esiliiga, derde divisie, etc.
- **Friendly games** blocked: friendly, amistoso, amical, testspiel
- **Middle East countries** blocked (no relevant leagues)

### Odds Requirement
- **All events MUST have odds** — events without `home_odd > 1` are filtered out
- Enrichment budget: live events + top 80 pregame candidates fetched for odds
- Limits enforced at proxy level: **live ≤ 120** events, **pregame ≤ 60** events

### Markets Returned (parseAllMarkets)
- `h2h` — Resultado Final (1X2) — category: "Mercado Raiz"
- `totals` / `goals_total` — Mais/Menos Golos — category: "Mercados de Gols"
- `handicap` / `spreads` — Handicap — category: "Mercados de Resultado"
- `btts` — Ambas Marcam — category: "Mercados de Gols"
- `double_chance` — Dupla Hipótese — category: "Mercados de Resultado"
- `first_half_h2h` / `second_half_h2h` — Intervalo — category: "Mercados Temporais"
- `first_half_totals` / `second_half_totals` — Over/Under por Período — category: "Mercados Temporais"
- `corners_total` / `cards_total` — Cantos/Cartões — category: "Mercados Estatísticos"
- `correct_score` — Resultado Exato — category: "Mercados Especiais"
- Available markets depend on bookmakers + match tier (lower leagues have fewer markets)

### SubOddsModel Tab Logic
- **Category-based system** fires ONLY when API returns markets from 2+ distinct categories
- **Static MARKET_GROUPS fallback** used when only 1 category present (e.g., only h2h)
  - Ensures computed fallback markets (Double Chance from h2h inverse-probability calc) always appear
  - MARKET_GROUPS defines: Mercado Raiz, Mercados de Resultado, Mercados de Gols, Mercados Temporais, Mercados Estatísticos, Mercados de Jogadores, Mercados Especiais
- **Tab filtering**: only tabs with actual content (≥1 market with data) are shown in the tab bar
- `double_chance` fallback: always computed from h2h odds via inverse-probability method → shows in "Mercados de Resultado"

### Navigation
- **DESPORTO** (`/`) → shows ONLY pregame events, max 60, sorted by date
- **AO VIVO** (`/live`) → shows ONLY live events, max 120

### Bookmaker Auto-Reset
- Every 12h: switches to Bet365, Betano, Unibet, Superbet, Betfair Sportsbook
- Tracks reset time in `scripts/.last_bm_clear`

### Live Scores & Clock
- API-Football (`/v3/fixtures?live=all`) fetched every 60s with `API_SPORTS_KEY`
- 337+ live fixtures matched to events by team name → `elapsed` (minutes) + `goals` (score)
- `goals: {home, away}` returned on every live event
- `elapsed: N` returned (match minute, from API-Football)
- `timer: "N"` returned as string for EventCard/EventDetails display
- BannerCarousel shows `N – M · elapsed'` for live events

### Team Logos
- API-Football logos proxied via `/api/events/media?url=...` (server-side, bypasses 403)
- Proxy fetches image with browser User-Agent + Referer header
- Logos cached 24h (`cache-control: public, max-age=86400`)
- Falls back to SofaScore CDN for non-soccer or unmatched events

### EventDetails
- **localFoundEvent**: looks up event in `live` + `pregame` (direct) + `upcomingEvents` from useSportsEvents hook
- Searching `pregame` directly avoids race condition with `useUpcomingCache` async state update
- Waits for `eventsLoading: false` (main fetch complete) before trying API fallback
- Avoids "Evento não encontrado" — finds event from local state instantly for both live and pregame events
- Falls back to proxy `/api/events/{id}` → CF Worker if not in local list
- Odds endpoint returns `{ markets: { [key]: { category, outcomes } }, suspended }`
- SubOddsModel uses static MARKET_GROUPS (+ computed fallbacks) to show multiple tabs always

### Match Center (MatchTracker component)
- Collapsible section inside EventDetails for live events
- Shows: MatchHeader (sport name in PT + league), Scoreboard (full team names + score + time), Possession bar, Match Stats, Timeline
- Sport names translated to Portuguese: soccer→Futebol, basketball→Basquetebol, tennis→Ténis, etc.
- Scoreboard uses full team names (`homeName`/`awayName`) with word-wrap (no truncation)
- Animation (animated ball field) removed — replaced with possession bar from real API-Football stats
- Stats fetched from `/api/events/{id}/stats` → populated from API-Football live fixture data

### Proxy Event Cache
- `_eventsById` map: populated on every `buildFromOddsApi` / `enrichList` cycle
- Numeric IDs (odds-api.io): matched by regex `/api/events/(\d+)/`
- CF Worker IDs (`soccer_XXXXXXX`): forwarded to CF Worker directly

For the deployed CF Worker to use odds-api.io directly, set `ODDS_API_KEY` as a Cloudflare Worker secret via `wrangler secret put ODDS_API_KEY`.

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`
- Backend runs separately as Cloudflare Workers (deployed via `npm run deploy:prod`)
