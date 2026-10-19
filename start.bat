@echo off
REM Double-click to start LearnHub on Windows
cd /d "%~dp0"
where node >nul 2>nul || (echo LearnHub needs Node.js 18 or newer: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:3000
node server.js
