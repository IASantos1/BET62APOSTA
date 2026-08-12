# Scripts utilitarios BET62

## Como usar (terminal PowerShell)

### 1) BetBY jwt-service (porta 8787)
Captura JWT, proxy de requests, resolve treeId automatico v4 live/prematch.

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","scripts\run-jwt-service.cmd" -WindowStyle Normal
```
Logs:
- `betby-demo/jwt-service.out.log` (stdout)
- `betby-demo/jwt-service.err.log` (stderr)

URLs:
- `http://localhost:8787/health`            → status + cfSession + autoResolve live/prematch
- `http://localhost:8787/jwt?force=1`       → JWT + URLs bootstrap v4
- `http://localhost:8787/v4/live`           → live FULL TREE (autoResolve → treeId com + events)
- `http://localhost:8787/v4/live/0`         → live meta versions
- `http://localhost:8787/v4/live?resolve=1` → força re-resolver cache 4min
- `http://localhost:8787/v4/prematch`       → prematch FULL TREE
- `http://localhost:8787/v4/debug/live?resolve=1`     → verbose: candidatos, tentativas, scores
- `http://localhost:8787/v4/debug/prematch?resolve=1` → verbose prematch

### 2) Vite front-end BET62 (porta 5000)
React + Vite 5 + Tailwind + React Query + Zustand.

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","scripts\run-vite.cmd" -WindowStyle Normal
```
Abre no browser: `http://localhost:5000/`

### Padrao REAL v4 BetBY (nao usar paths antigos que dao 503)
✅ Certo: `/api/v4/{live|prematch}/brand/{brandId}/{lang}/{0|treeId}`
❌ Errado: `/api/v4/sports/events/{live|prematch}/list?brandId=...&lang=...` (503 access blocked)
