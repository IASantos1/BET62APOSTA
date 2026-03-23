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

The frontend dev server runs at port 5000, binding to 0.0.0.0 with all hosts allowed for Replit proxy compatibility.

API calls proxy to the Cloudflare Worker backend (local port 8788). If the local worker isn't running, the app falls back to the remote deployed worker at `https://bet62apostasesportivas.bet62.workers.dev`.

## Running the App

```bash
npm run dev         # Start frontend dev server (port 5000)
npm run worker      # Start local Cloudflare Worker (port 8788)
npm run build       # Build for production
```

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`
- Backend runs separately as Cloudflare Workers (deployed via `npm run deploy:prod`)
