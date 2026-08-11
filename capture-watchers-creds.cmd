@echo off
REM ==========================================================================
REM  BET62 - Captura credenciais Watchers (roomId / userIdB64 / apikey / embedUrl)
REM  Abrindo demo.betby.com de verdade via Playwright e extraindo do widget de chat
REM  Uso (raiz):   capture-watchers-creds            (headless, espera 20s)
REM                capture-watchers-creds --headed   (abre janela para o usuario)
REM                WAIT_MS=30000 capture-watchers-creds
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
node scripts\ensure-playwright-path.mjs >nul 2>&1
node capture-watchers-creds.mjs %*
echo.
echo ^[dica^] Se nao capturar o userIdB64, rode: capture-watchers-creds --headed
endlocal
