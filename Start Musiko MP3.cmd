@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || goto :missing
where yt-dlp >nul 2>nul || goto :missing
where ffmpeg >nul 2>nul || goto :missing
where ffprobe >nul 2>nul || goto :missing
node server.mjs
if errorlevel 1 pause
exit /b
:missing
echo Install Node.js 22+, yt-dlp, and FFmpeg first. See README.md.
pause
exit /b 1
