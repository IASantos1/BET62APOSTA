@echo off
REM ==========================================================================
REM  BET62 - Servico JWT (renova automatico + HTTP /health /jwt /proxy)
REM  Uso (na raiz):                          jwt-service            default porta 8787
REM                                           jwt-service 9001       porta 9001
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
set _PORT=%1
if "%_PORT%"=="" set _PORT=8787
node scripts\ensure-playwright-path.mjs >nul 2>&1
node jwt-service.mjs %_PORT%
endlocal
