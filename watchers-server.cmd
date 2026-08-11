@echo off
REM ==========================================================================
REM  BET62 - Servidor Watchers (settings / themes / auth register / embed)
REM  Uso (na raiz):                          watchers-server          default 8789
REM                                           watchers-server 9002     porta 9002
REM ==========================================================================
setlocal
cd /d "%~dp0betby-demo"
if not exist "node_modules" (
  echo ^[setup^] Instalando dependencias em betby-demo ...
  call npm.cmd install --omit=optional
)
set _PORT=%1
if "%_PORT%"=="" set _PORT=8789
node api\watchers.mjs server %_PORT%
endlocal
