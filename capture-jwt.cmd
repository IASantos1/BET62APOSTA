@echo off
REM ==========================================================================
REM  BET62 - Captura automatica JWT demo.betby.com
REM  Uso (na raiz do projeto):    capture-jwt            (headless)
REM                               capture-jwt --headed   (abre janela)
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
node scripts\ensure-playwright-path.mjs >nul 2>&1
node capture-jwt.mjs %*
endlocal
