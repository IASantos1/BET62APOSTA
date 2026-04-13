# Bet62 - Sports Betting Platform 
## Project Overview 
Bet62 is a Portuguese-language sports betting platform. It uses a React 18 + Vite 5 frontend with a Node.js backend running entirely locally with better-sqlite3 (SQLite). 

## Architecture 
### Frontend (port 5000) 
- **Framework**: React 18 + Vite 5 
- **Styling**: TailwindCSS 3 
- **State Management**: Zustand + React Query 
- **Port**: 5000 (Replit webview) 
- **Entry**: `src/main.tsx` → `src/App.tsx` 

### Backend (port 3001) — `backend/src/` 
- **Runtime**: Node.js 20+ (Hono framework) 
- **Database**: better-sqlite3 (SQLite at `backend/data/bet.db`) 
- **Auth**: JWT (jsonwebtoken) + bcryptjs 
- **Cron**: Custom intervals (sports sync every 5 min) 
- **Entry**: `backend/src/index.js` 
- **Key files**: 
  - `backend/src/db.js` — SQLite schema (users, wallets, bets, events, KYC, etc.) 
  - `backend/src/services/ledger.js` — Double-entry ledger (credit/debit/hold/release) 
  - `backend/src/services/auth.js` — JWT token management 
  - `backend/src/index.js` — Main routing and Server-Sent Events (SSE) logic 
  - `backend/src/jobs/sportsSync.js` — API-Sports + odds-api.io sync 

## Development Setup 
### Workflows 
Both workflows must run simultaneously. The Vite dev server proxies all `/api/*` requests to the Node backend on port 3001. 

```bash 
npm run dev       # Frontend (port 5000) 
npm run server    # Backend (port 3001) 
``` 

### API Proxy 
Configured in `vite.config.ts`: 
- `/api/live/ws` → `wss://bet62apostasesportivas.bet62.workers.dev` (Legacy WebSocket) 
- `/api/*` → `http://localhost:3001` (Node.js backend) 

The frontend uses relative URLs in dev mode (resolved in `src/react-app/utils/api.ts`) so all API calls go through the Vite proxy.