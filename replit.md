# BET62 - Apostas Esportivas

A Portuguese-language sports betting platform (BET62) built with React + Vite on the frontend and Cloudflare Workers on the backend.

## Architecture

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, React Router, TanStack Query, Zustand, Framer Motion
- **Backend**: Cloudflare Workers (Hono framework) with D1 SQLite database
- **Auth**: Lucia Auth with SQLite adapter
- **Payments**: Stripe and PayPal integrations
- **Odds & Stats**: Statpal.io API (soccer v2)

## Project Structure

- `src/react-app/` — Main React application (entry point: `src/react-app/main.tsx`)
- `src/worker/` — Cloudflare Worker backend (API, auth, betting engine)
- `index.html` — Root HTML entry (uses `src/react-app/main.tsx`)
- `migrations/` — D1 database migration SQL files
- `vite.config.ts` — Vite configuration (port 5000, all hosts allowed)
- `wrangler.toml` — Cloudflare Workers configuration
- `scripts/odds-proxy.mjs` — Statpal.io odds/stats proxy (port 8080)

## Development Setup

Two workflows must run simultaneously:

1. **Start worker** (`npm run worker`) — Statpal.io data proxy on port 8080. Fetches live matches + odds (one global call) and prematch odds from 22 top leagues. Implements automatic refresh every 30s for live, 120s for prematch.

2. **Start application** (`npm run dev`) — Vite dev server on port 5000 with all API traffic proxied through the local odds proxy at `http://127.0.0.1:8080`.

The proxy pipeline: Browser → Vite (5000) → odds-proxy (8080) → Statpal.io API (+ CF Worker fallback for auth/payments).

## Running the App

```bash
npm run worker      # Start Statpal odds proxy (port 8080) — required first
npm run dev         # Start frontend dev server (port 5000)
npm run build       # Build for production
npm run deploy:prod # Deploy CF Worker to production (requires CF auth)
```

## Statpal.io Integration

API key stored as `STATPAL_KEY` environment secret.
Base URL: `https://statpal.io/api/v2/soccer/`

### Live Matches
- Endpoint: `GET /api/v2/soccer/odds/live`
- Returns all live soccer matches with: odds, stats, match events, score, period, minute
- Refreshed every 30 seconds
- `status.blocked === "1"` or `status.stopped === "1"` → odds suspended

### Prematch Odds
- Endpoint: `GET /api/v2/soccer/leagues/{league_id}/odds/prematch`
- 22 top leagues fetched in parallel: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Primeira Liga, Liga Portugal 2, Eredivisie, Champions League, Europa League, Conference League, Belgium Pro League, Scotland PL, Greece Super League, Turkey Super Lig, Russia PL, Switzerland SL, Serbia Super Liga, Brazil Serie A, Argentina Primera, Tweede Divisie
- Refreshed every 120 seconds

### League Filtering (Backend)
- **Women's leagues** blocked: women, woman, feminino, damen, toppserien, wsl, nwsl, etc.
- **Youth leagues** blocked: U16–U23, under-16–23, youth, junior, juvenil, revelacao, etc.
- **Amateur leagues** blocked: amateur, amateure, amador, amatör
- **3rd division+** blocked: regionalliga, kakkonen, gamma ethniki, esiliiga, derde divisie, etc.
- **Friendly games** blocked: friendly, amistoso, amical, testspiel
- **Middle East countries** blocked (saudi arabia, qatar, uae, kuwait, bahrain, oman, jordan, iraq, syria, lebanon, palestine, yemen, iran)

### Odds Suspension (Critical Moments)
- Match-level: `status.blocked === "1"` or `status.stopped === "1"` → ALL markets suspended
- Line-level: individual line `suspended === "1"` → that specific line suspended
- Score-based: O/U line ≤ total goals scored → that line suspended (e.g. 0:1 → Mais/Menos 0.5 suspended)

### Markets Available

**Live markets (Statpal IDs → canonical key):**
- `3610` → `h2h` (Resultado Final)
- `91841`/`2254` → `totals` (Mais/Menos Gols)
- `1844`/`1845` → `handicap` (Handicap)
- `12398` → `btts` (Ambas Marcam)
- `11834` → `correct_score` (Marcador Correto)
- `1849`/`2353`/`91839` → `corners_total` (Cantos)
- `2151` → `btts_second_half`
- `1836` → `second_half_h2h`
- `12395` → `goals_odd_even`
- `double_chance` — computed from h2h via inverse-probability

**Prematch markets (Statpal IDs → canonical key):**
- `1834` → `h2h` (1x2)
- `1835` → `dnb` (Empate Anula Aposta)
- `1838` → `totals` (O/U, uses `total` array with handicap lines)
- `1848` → `btts`
- `1914` → `correct_score`
- `1845` → `half_time_full_time`
- `2055` → `double_chance`

### Live Statistics (Statpal Stats Keys)
Stats object keyed 0-14: `Goal`, `Corner`, `YellowCard`, `RedCard`, `Attacks`, `DangerousAttacks`, `OnTarget`, `OffTarget`, `Posession`, `FirstHalfScore`

Returned from `/api/events/{id}/stats` in API-Football format for MatchTracker compatibility:
- `Ball Possession` (%)
- `Total Shots` (OnTarget + OffTarget)
- `Shots on Goal` (OnTarget)
- `Corner Kicks`, `Yellow Cards`, `Red Cards`

### Event IDs
All Statpal events use `sp_` prefix: `sp_{main_id}`. Cached in `_eventsById` map.

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

### Proxy Endpoints
- `GET /api/events/by-sport?*` → returns `{ live, pregame }` from Statpal cache
- `GET /api/events/{sp_id}` → returns cached event by ID
- `GET /api/events/{sp_id}/odds` → returns `{ markets, suspended }` for event
- `GET /api/events/{sp_id}/stats` → returns `{ stats, events, statsData }` for event
- `GET /api/sports` → returns soccer only
- `GET /api/events/media?url=...` → image proxy with CORS headers
- All other routes → forwarded to CF Worker (auth, payments, user data)

### Match Center (MatchTracker component)
- Collapsible section inside EventDetails for live events
- Shows: MatchHeader (sport name in PT + league), Scoreboard (full team names + score + time), Possession bar, Match Stats, Timeline
- Stats fetched from `/api/events/{id}/stats` → populated from Statpal live fixture data, converted to API-Football format
- Match events from Statpal (text-based, e.g. "4' - 1st Corner - (Team Name)")

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`
- Backend runs separately as Cloudflare Workers (deployed via `npm run deploy:prod`)

## Intro Splash Screen
- Component: `src/react-app/components/Bet62Intro.tsx`
- Shows once per browser session (sessionStorage `bet62_intro_seen` flag)
- Duration: 1.3 seconds (300ms in → 900ms hold → 1300ms done)
- Red background, white B62 circle, BET62 gold text, "APOSTAS DESPORTIVAS", bouncing dots

## UI — Market Layout (SubOddsModel)
- Redesigned with card-style panels: each market wrapped in a bordered card with title + ⓘ icon
- Labels shown OUTSIDE the red odds button (label text on the left, red button with only the price on the right)
- Tall red buttons (h-11 = 44px) with clear tabular odds value
- Totals market (goals/corners) shown as a grid table: Line | Mais | Menos columns
- Handicap market: side-by-side home/away panels divided by a vertical line

## UI — EventDetails Header
- Replaced team logos with `FootballPitchAnimation` — a 2D SVG animated football pitch
- Ball animation uses requestAnimationFrame for smooth bounce movement around the pitch
- Shows score, status badge, and timer for live events; VS for prematch
- Team names displayed bottom-left and bottom-right over the pitch

## Multi-Sport Coverage
- Statpal.io API v2 covers **soccer/football only** — no basketball, tennis, handball, etc.
- Other sports UI groups (NBA, NFL, etc.) are defined in `marketConfig.ts` for future use

## Logos Removed
- Team logos removed from: `EventCard.tsx` and `EventDetails.tsx`
