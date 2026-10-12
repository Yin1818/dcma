@echo off
cd /d "%~dp0"
start "DCMA Dashboard Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000/
