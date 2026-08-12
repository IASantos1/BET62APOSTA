@echo off
setlocal
cd /d "%~dp0..\betby-demo"
echo [%DATE% %TIME%] Starting jwt-service.mjs (v2 fallback resolveBestTreeId)...
node "%~dp0..\betby-demo\jwt-service.mjs"
echo [%DATE% %TIME%] jwt-service exited with code=%ERRORLEVEL%
