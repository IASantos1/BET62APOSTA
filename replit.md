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

### Markets Returned
- `h2h` — Resultado Final (1X2)
- `totals` — Mais/Menos Golos (Over/Under)
- `handicap` — Handicap Europeu/Asiático
- `btts` — Ambas Marcam

### Navigation
- **DESPORTO** (`/`) → shows ONLY pregame events, max 60, sorted by date
- **AO VIVO** (`/live`) → shows ONLY live events, max 120

### Bookmaker Auto-Reset
- Every 12h: switches to Bet365, Betano, Unibet, Superbet, Betfair Sportsbook
- Tracks reset time in `scripts/.last_bm_clear`

### Team Logos
- SofaScore CDN: `https://img.sofascore.com/api/v1/team/{homeId}/image` (from odds-api.io homeId)
- Falls back to team initials if logo fails to load

For the deployed CF Worker to use odds-api.io directly, set `ODDS_API_KEY` as a Cloudflare Worker secret via `wrangler secret put ODDS_API_KEY`.

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`
- Backend runs separately as Cloudflare Workers (deployed via `npm run deploy:prod`)
