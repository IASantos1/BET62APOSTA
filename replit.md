# Bet62 — Sports Betting Platform

A Portuguese-language sports betting platform with live odds, pre-match events, wallet management, and payment processing.

## Stack

- **Frontend**: React 18 + Vite (port 5000)
- **Backend**: Node.js HTTP server with TypeScript/tsx (port 3000)
- **Database**: PostgreSQL (Replit built-in, schema auto-applied on startup via `ensureSchema`)
- **Payments**: Stripe + PayPal (keys required for payment flows)
- **Sports data**: SportsApiPro + StatPal (API keys configured)
- **Auth**: Lucia v2 session-based auth with cookie sessions
- **Real-time**: WebSocket live feed at `/api/live/ws`

## How to run

```
npm run dev
```

This starts both Vite (port 5000) and the backend server (port 3000) concurrently. The Vite dev server proxies `/api` requests to the backend.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` / `PG*` | Yes | Managed by Replit automatically |
| `SESSION_SECRET` | Yes | Set as Replit Secret |
| `SPORTS_API_PRO_KEY` | Yes | Sports data provider key |
| `SPORTS_PROVIDER` | Yes | Set to `sportsapipro` |
| `STRIPE_SECRET_KEY` | No* | Required for payment flows |
| `STRIPE_PUBLISHABLE_KEY` | No* | Required for payment flows |
| `STRIPE_WEBHOOK_SECRET` | No* | Required for Stripe webhooks |

*App starts without Stripe keys but payment features are disabled.

## Key directories

- `src/react-app/` — React frontend
- `server/` — Backend server (routes, services, DB)
- `server/routes/` — API route handlers
- `server/services/` — Business logic (settlement, sports data, etc.)
- `server/lib/` — DB pool, auth tables, utilities
- `migrations/` — SQL migration files (PostgreSQL/Railway path only; see `migrations/README.md`)

## Database

Schema is applied automatically on server startup via `server/lib/db.ts` → `ensureSchema()`. Do not apply the historical `migrations/*.sql` chain directly to PostgreSQL — use `npm run db:push` or let the server auto-apply on start.

## User preferences

- Keep the existing project structure and stack.
