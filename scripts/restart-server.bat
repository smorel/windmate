@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

if "%PORT%"=="" set PORT=3000

echo Stopping process on port %PORT% (if any)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  if not "%%P"=="0" taskkill /F /PID %%P >nul 2>&1
)

echo Starting Windmate (npm start)...
call npm start

endlocal
