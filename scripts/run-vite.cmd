@echo off
REM Start the Vite dev server (BET62 front-end) permanently
REM Run from repo root (parent of scripts folder)
setlocal
cd /d "%~dp0.."
echo [%DATE% %TIME%] Starting Vite dev server (port 5000)...
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm.cmd not found in PATH
  exit /b 1
)
call npm.cmd run dev -- --host 0.0.0.0 --port 5000 --strictPort
echo [%DATE% %TIME%] Vite exited with code=%ERRORLEVEL%
