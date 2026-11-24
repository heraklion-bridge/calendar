@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 and reopen this file.
  pause
  exit /b 1
)
node "%~dp0main.js"
