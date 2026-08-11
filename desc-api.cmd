@echo off
REM ==========================================================================
REM  BET62 - Event description / mercados / mini pitch
REM  Uso (na raiz):   desc-api 2672006592026779683
REM                   desc-api 2672006592026779683 --dump
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
node scripts\ensure-playwright-path.mjs >nul 2>&1
node api\descriptions.mjs %*
endlocal
