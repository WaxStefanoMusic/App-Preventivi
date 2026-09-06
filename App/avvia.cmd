@echo off
rem ============================================================
rem  Avvio dell'app in modalita' sviluppo.
rem  Serve per un motivo preciso: Visual Studio Code imposta
rem  ELECTRON_RUN_AS_NODE=1 nel suo terminale, e con quella
rem  variabile attiva NESSUNA app Electron parte (si avvia come
rem  semplice Node e fallisce). Qui la azzeriamo.
rem ============================================================
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installazione delle dipendenze in corso, un momento...
  call npm install --no-audit --no-fund || goto :errore
  if not exist "node_modules\electron\dist\electron.exe" call node node_modules\electron\install.js
)

echo Avvio App Preventivi...
call npx electron .
goto :fine

:errore
echo.
echo Installazione non riuscita. Verifica di avere Node.js: https://nodejs.org
pause

:fine
endlocal
