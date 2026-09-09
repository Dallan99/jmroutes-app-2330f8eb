@echo off
setlocal
cd /d "%~dp0.."
if not exist ".env.local" exit /b 2
if not exist "logs" mkdir "logs"
set "BASE_CODES=ESP15,ESP16,ESP17,ESP18"
set "WRITE_BASE_CODES=ESP15,ESP16,ESP17,ESP18"
set "SYNC_INTERVAL_SECONDS=60"
rem Todos os processos compartilham um unico refresh token, com trava de arquivo.
set "JMR_SESSION_FILE_PATH=./data/jmr-session.enc"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
:loop
"C:\Program Files\nodejs\node.exe" --env-file=.env.local dist\monitoring-worker.js >> "logs\worker-DASHBOARD-GERAL.log" 2>&1
timeout /t 30 /nobreak >nul
goto loop
