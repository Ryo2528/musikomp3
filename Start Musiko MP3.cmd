@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul || goto :missing
node start-windows.mjs
if errorlevel 1 pause
exit /b
:missing
echo Install Node.js 22 or later from https://nodejs.org/en/download and try again.
pause
exit /b 1
