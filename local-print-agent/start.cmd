@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Johns Print Service.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-agent.ps1"
if errorlevel 1 (
  echo Failed to start Johns Print Service v3.
  pause
  exit /b 1
)
