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
- Fetches events list from `/v3/events` (per sport, cached 30s)
- Matches CF Worker events to odds-api.io events using team name fuzzy matching (min score 58)
- Fetches per-event odds from `/v3/odds?eventId=...&bookmakers=...` (cached 20s)
- Bookmakers: Bet365, 1xbet, Betano, 888Sport, SportingBet
- Results are injected as `home_odd`/`draw_odd`/`away_odd` on each event

For the deployed CF Worker to use odds-api.io directly, set `ODDS_API_KEY` as a Cloudflare Worker secret via `wrangler secret put ODDS_API_KEY`.

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`
- Backend runs separately as Cloudflare Workers (deployed via `npm run deploy:prod`)
