@echo off
REM ==========================================================================
REM  BET62 - WebSocket Watchers (live events + markets + heartbeat + reconnect)
REM  Uso (na raiz):   ws-api
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
node scripts\ensure-playwright-path.mjs >nul 2>&1
node api\websocket.mjs %*
endlocal
