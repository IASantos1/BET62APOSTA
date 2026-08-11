@echo off
REM ==========================================================================
REM  BET62 - Abre iframe.html no navegador padrao
REM  Uso (na raiz):   open-iframe
REM ==========================================================================
setlocal
set "FILE=%~dp0betby-demo\iframe.html"
start "" "%FILE%"
echo Aberto: %FILE%
endlocal
