@echo off
REM ==========================================================================
REM  BET62 - Live / Prematch (BetBY demoapi e sptpub)
REM  Uso (na raiz):
REM     live-api                             live geral demoapi + 6 primeiros
REM     live-api --prematch                  prematch geral
REM     live-api --sportId=3572968592260     live filtrando 1 esporte
REM     live-api --sptpub                    upstream sptpub (default demoapi)
REM     live-api --dump                      salva em .dumps/
REM     live-api server                      HTTP server default 8788
REM     live-api server 9003                 HTTP server porta 9003
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
  node api\live.mjs server %_PORT%
  goto :eof
)
node api\live.mjs %*
endlocal
