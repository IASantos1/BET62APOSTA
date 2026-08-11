@echo off
REM ==========================================================================
REM  BET62 - Live events (BetBY /api/v4/live/brand)
REM  Uso (na raiz):                          live-api          (one-shot + dump json)
REM                                           live-api server   (HTTP default 8788)
REM                                           live-api server 9003
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
node scripts\ensure-playwright-path.mjs >nul 2>&1
if /i "%~1"=="server" (
  set _PORT=%2
  if "%_PORT%"=="" set _PORT=8788
  node api\live.mjs --server !_PORT!
  goto :eof
)
node api\live.mjs %*
endlocal
